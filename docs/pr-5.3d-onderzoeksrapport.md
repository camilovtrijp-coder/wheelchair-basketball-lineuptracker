# PR 5.3d — onderzoeksrapport offline-write-hang (issue #27)

Status: **issue #27 blijft een harde OPEN gate**. PR #36 is niet merge-ready en
niet "ready for review" totdat dit rapport en de acties eronder zijn
opgevolgd. Dit document vervangt geen testcode — het legt vast wat er
empirisch is vastgesteld, zodat een volgende sessie/reviewer niet opnieuw
vanaf nul hoeft te onderzoeken.

Basis: exact head `fa0ccf9298072cab3dcee05a3bd8424fc2760461` (commit
"docs(test): vervolgonderzoek multi-tab cache-manager lost offline-reload-hang
niet op"). Alle diagnostiek hieronder is uitgevoerd tegen die basis, met de
schrijfcontractwijziging uit dit vervolgonderzoek er bovenop (zie §D).

## A. Verified root cause

**Het schrijfcontract dat `setDoc()`'s eigen promise awaitte (het
oorspronkelijke `write()` in `FirestoreSettingsRepository`/
`FirestoreRosterRepository`) was een reëel ontwerpprobleem, maar was NIET de
enige, en uiteindelijk niet de dominante, oorzaak van de waargenomen hang.**

Na het herzien van dat contract (zie §D) bleef test 3 falen — niet meer op de
reload-hang, maar op een eerdere stap: de sync-status-indicator bleef op
`lokaal-beschikbaar` staan in plaats van naar `wacht-op-synchronisatie` te
gaan. Directe instrumentatie (tijdelijke `console.log` in `write()`,
`read()`/`getDocFromCache()` en de `onSnapshot`-callback van
`FirestoreSettingsRepository`, verwijderd na onderzoek — zie git-historie van
dit bestand voor de sessie-log) legde het volgende, herhaalbare patroon bloot:

1. Vóór elke write: `getDocFromCache()` op het settings-document werkt
   gewoon, ook terwijl al offline (bewezen via een `settings-refresh`-klik
   vóór de write).
2. `write()` roept `setDoc()` aan (fire-and-forget, contract uit §D). De
   aanroep zelf keert meteen terug (geen await-blokkade meer).
3. **Na die `setDoc()`-aanroep reageert noch een volgende
   `getDocFromCache()`-aanroep op PRECIES datzelfde document, noch de actieve
   `onSnapshot`-listener op datzelfde document, ooit nog — getest met
   herhaalde pogingen op +0ms, +100ms, +500ms, +1.5s, +3s, +8s, +15s en +25s.
   Geen van deze operaties resolvet, rejecteert, of logt een fout; ze hangen
   permanent binnen het testvenster.**
4. **Tegelijkertijd blijft een lezing van een ANDER document (roster,
   getriggerd via de `roster-refresh`-knop) op dezelfde Firestore-client
   gewoon normaal werken** — dat sluit een client-brede AsyncQueue-deadlock
   uit. Het probleem is specifiek gekoppeld aan een document met een
   openstaande, nog niet bevestigde lokale mutatie.

Deze bevinding is getrianguleerd langs drie onafhankelijke assen, telkens met
hetzelfde resultaat:

- **Offline-mechanisme:** zowel Playwright's `context.setOffline(true)`
  (CDP-niveau) als een expliciete `route.abort('internetdisconnected')` op de
  emulatorpoort (127.0.0.1:8080) geven dezelfde hang. Dit sluit uit dat het
  specifiek aan CDP's "hangende requests i.p.v. snel falende" ligt — een
  actief afgebroken verbinding geeft hetzelfde resultaat als een emulerende
  offline-modus.
- **Cachemodus:** zowel `persistentLocalCache` (met `persistentSingleTabManager`,
  de productiekeuze) als `memoryLocalCache` (geen IndexedDB, geen Web Locks)
  geven dezelfde hang. Dit sluit de eerdere hypothese uit dat
  `persistentSingleTabManager`/Web Locks in headless Chromium de
  boosdoener zijn (die hypothese stond nog als vermoeden in
  `firebaseClient.ts`'s commentaar en in het vorige testcommentaar).
- **Long-polling-modus:** zowel `experimentalForceLongPolling: true` als
  `experimentalAutoDetectLongPolling: true` geven dezelfde hang.

**Conclusie:** dit is geen Playwright/CDP-artefact, geen Web-Locks/
persistentie-kwestie, en geen gevolg van het (inmiddels gecorrigeerde)
"wacht op setDoc()"-schrijfcontract. Het lijkt een fundamenteel gedrag van de
Firestore JS SDK (getest: de versie die dit project via `firebase/firestore`
gebruikt) tegen de **Firestore Emulator Suite**: zodra een document een
lokale, nog niet aan de server bevestigde mutatie heeft terwijl de
netwerkverbinding wegvalt, lijkt de lokale-view-berekening voor DAT
specifieke document (zowel puntlezingen als de listener) vast te lopen,
onafhankelijk van cachepersistentie en long-polling-configuratie.

**Nog NIET vastgesteld:** of dit ook optreedt tegen een echte Firestore-
backend (productie, geen emulator) en/of op een echt mobiel apparaat met een
reële netwerkonderbreking (in plaats van CDP-emulatie of een geforceerde
`route.abort`). Dat is precies de resterende open vraag — zie §C en de
handmatige protocol in §F.

## B. Test-harness issues found

- De oorspronkelijke test 3 (vóór dit vervolgonderzoek) reload'de direct na
  de save-klik, zonder te bevestigen dat de write al lokaal was toegepast.
  Dat maakte de oorspronkelijke hang-waarneming een race: onduidelijk of de
  hang kwam van "reload met een write die nog niet eens geregistreerd was"
  of van iets fundamentelers. Gecorrigeerd door test 3 te herschrijven naar
  het 8-stappenprotocol (zie testbestand) dat expliciet wacht tot de
  sync-status-indicator `wacht-op-synchronisatie` toont vóórdat er geherload
  wordt.
- De preview-server (`npm run preview:e2e`) serveert een vooraf gebouwde
  `dist/`; broncodewijzigingen zonder `npm run build` ertussen worden
  stilzwijgend genegeerd door de e2e-suite. Tijdens dit onderzoek leverde dat
  een vals-negatieve diagnostische run op (geen enkele `console.log`
  verscheen, ook niet de al langer bestaande code) totdat dit werd
  opgemerkt. Geen code-actie nodig, maar het is de moeite waard dit als
  vaste stap te onthouden bij toekomstige diagnostiek: **altijd `npm run
  build` vóór een e2e-auth-run wanneer `src/` net gewijzigd is.**
- Playwright's sandbox-lokale `executablePath`-workaround
  (`/opt/pw-browsers/chromium`, nodig omdat de geïnstalleerde
  `@playwright/test`-versie een nieuwere Chromium-build verwacht dan wat in
  deze sandbox voorgeïnstalleerd staat) is uitsluitend lokaal gebruikt tijdens
  testruns en NIET gecommit — `playwright.config.ts`/`playwright.auth.config.ts`
  staan weer op hun originele, ongewijzigde inhoud.

## C. Actual product behavior

Voor de gebruiker vertaalt dit zich naar: **een offline wijziging die wordt
opgeslagen terwijl de verbinding wegvalt, laat de UI voor dát specifieke veld
(hier: teamnaam-instellingen) permanent op de oude sync-status-indicatorwaarde
staan** — de indicator bevriest op `lokaal-beschikbaar` in plaats van door te
schakelen naar `wacht-op-synchronisatie`. Belangrijker: bij een page-reload
terwijl deze mutatie nog in de wachtrij staat, hangt de app onbepaald op
`LoadingScreen`, omdat de nieuwe Firestore-clientinstantie na reload dezelfde
persistente mutatiequeue moet verwerken en daarbij tegen hetzelfde probleem
aanloopt bij het lezen van dát document (zie App.tsx's bounded-timeout-
diagnostiek: deze zou specifiek `settings-read`/`settings-listener` als
"stalled" rapporteren in dat scenario).

Dit is een reëel, gebruiker-zichtbaar defect zolang het ook buiten de
emulator/CDP-testomgeving optreedt. Zonder bevestiging op een echt apparaat
kan niet worden vastgesteld of dit een testomgeving-specifiek verschijnsel is
(bijvoorbeeld: de Firestore-emulator handelt streamfouten anders af dan de
productiebackend) of een reëel productrisico.

## D. Doorgevoerde fix (schrijfcontract)

Onafhankelijk van bovenstaande — en hoe dan ook correct, ongeacht de uitkomst
van het emulator/apparaat-onderzoek — is het volgende schrijfcontract
doorgevoerd:

- `FirestoreSettingsRepository.write()`/`FirestoreRosterRepository.write()`
  awaiten niet langer `setDoc()`'s eigen promise (die pas na
  serverbevestiging resolvet en offline onbeperkt pending kan blijven).
  `write()` retourneert nu meteen `{ ok: true, syncState:
  {status:'wacht-op-synchronisatie', ...}, settled }`, waarbij `settled` een
  NOOIT-REJECTEND `Promise<{ok, error?}>` is dat de uiteindelijke
  serverbevestiging/-afwijzing draagt (`domain/syncState.ts`).
- `useSyncStatus.saveSettings`/`saveRoster` volgen dat `settled`-Promise
  apart (niet ge-awaite door de aanroeper) om een échte afwijzing na
  reconnect alsnog als `actie-nodig` te registreren, zonder dat een
  onbehandelde promise-rejectie kan ontstaan.
- `migrateLocalStorageToCloud` (eenmalige v1→cloud-import) awaitet wél
  `settled`, omdat die actie een definitieve bevestiging nodig heeft
  voordat de v1-data als "geïmporteerd" wordt gemarkeerd.
- Alle 209 unit tests zijn hierop aangepast en slagen.

Dit is een noodzakelijke correctie (het oorspronkelijke "wacht op setDoc()"
contract was een reëel ontwerpprobleem), maar lost het in §A beschreven
verschijnsel niet op — dat zit dieper dan ons eigen schrijfcontract.

## E. Remaining open gate

Issue #27 blijft OPEN. Concreet:

- Test 3 in
  `v2/tests/e2e-auth/offline-reload-cache-write-second-client.spec.ts` faalt
  bewust en zichtbaar (GEEN `test.fail()`) op de
  `wacht-op-synchronisatie`-assertie, met een commentaarblok dat naar dit
  rapport verwijst.
- Bevestigd herhaalbaar: 2/2 headless runs en 1/1 headed run (via
  `xvfb-run`) geven exact dezelfde faalstap.
- PR 5.3 / issue #27 mogen pas als voltooid gemarkeerd worden wanneer test 3
  volledig groen is ZONDER `test.fail()`, of wanneer een alternatieve,
  eveneens volledig groene aanpak (zie §G) is geverifieerd — inclusief
  bevestiging op minstens één echt mobiel apparaat volgens het protocol in
  §F.

## F. Handmatig reproductieprotocol — echt mobiel apparaat

Kan niet zelf worden uitgevoerd vanuit deze omgeving (geen fysiek apparaat
beschikbaar). Voor een mens met een telefoon/tablet en toegang tot een
gedeployde/lokaal bereikbare buildomgeving:

1. Bouw de app (`npm run build` in `v2/`) en serveer `dist/` op een adres dat
   het mobiele apparaat kan bereiken (bijv. `vite preview --host` op hetzelfde
   Wi-Fi-netwerk, of een tijdelijke Netlify/staging-deploy tegen een échte
   Firebase-projectconfiguratie — niet de emulator, om de
   emulator-vs-productie-vraag uit §A mee te beantwoorden).
2. Open de app op het mobiele apparaat, log in als een teamlid met "vertrouwd
   apparaat" (bijv. de seed-gebruiker of een test-account op het echte
   project), open het team zodat settings/roster gecachet raken.
3. Zet het apparaat in **vliegtuigmodus** (niet alleen Wi-Fi uit — dat is
   dichter bij een reële "verbinding weg"-situatie dan CDP-emulatie of
   `route.abort` in een testrunner).
4. Wijzig de teamnaam in de instellingen en sla op.
5. Observeer de syncstatus-indicator: verwacht `Wacht op synchronisatie`
   (NL) / `Pending sync` (EN). **Noteer of dit al dan niet gebeurt, en of het
   uiteindelijk (na hoeveel seconden?) alsnog verschijnt.**
6. Herlaad de pagina (pull-to-refresh of browser-herlaad) terwijl nog in
   vliegtuigmodus. **Noteer of de app blijft hangen op het laadscherm, en zo
   ja: verschijnt na verloop van tijd een diagnostische melding over welke
   stap vaststeekt (App.tsx's `stalledSteps`/`LoadingScreen`'s
   `data-testid="loading-stalled"`, zichtbaar als tekst op het scherm)?**
7. Zet vliegtuigmodus weer uit. Noteer of/wanneer de indicator naar
   `Gesynchroniseerd` (NL) / `Synced` (EN) springt.
8. Log op een tweede apparaat/browser in als een ander teamlid met
   dezelfde context en controleer of de nieuwe teamnaam daar verschijnt.
9. Herhaal stap 3–7 minstens twee keer (verschillende netwerktype: Wi-Fi-uit
   vs. vliegtuigmodus vs. daadwerkelijk buiten bereik) om te zien of het
   resultaat consistent is of varieert per manier van "offline gaan" — dat is
   exact de as die dit onderzoek binnen de emulator al verkende (CDP
   `setOffline` vs. `route.abort`) en die op een echt apparaat niet
   automatisch hetzelfde hoeft te zijn.

Rapporteer de bevindingen (per stap: verwacht vs. waargenomen, met
schermafbeeldingen/video indien mogelijk) terug voordat een besluit over §G
wordt genomen.

## G. Voorwaardelijk vervolg (NIET nu uitvoeren)

Alleen als het herziene schrijfcontract (§D) én de verbeterde test (8-staps-
protocol) **ook op een echt apparaat** (protocol §F) blijven falen op
hetzelfde patroon (document met pending write wordt onleesbaar/niet meer
ge-update terwijl offline), is een architecturaal zwaardere oplossing nodig:
een eigen, app-owned IndexedDB-outbox met idempotente operatie-ID's, die
schrijfoperaties zelf beheert in plaats van te vertrouwen op Firestore's
eigen offline-mutatiequeue voor de duur dat een document "in transit" is.
Dat vereist een aparte ADR (niet stilzwijgend binnen deze PR
geïmplementeerd) en een eigen ontwerpronde. Tot de uitkomst van §F bekend is,
wordt dat traject NIET gestart.
