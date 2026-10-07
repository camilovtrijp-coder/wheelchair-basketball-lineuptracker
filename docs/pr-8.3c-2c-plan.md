# Ontwerpnotitie PR 8.3c-2c-i — UI voor "organisatie verlaten" en "account verwijderen"

Bovenop 2b-iii. Bron: `docs/pr-8.3c-2b-plan.md` §B.6, §B.9, §B.11, §B.12, §C.4, §F (R6),
§I (B7); besluitrecord `docs/pr-8.3c-besluitvoorstel.md` §4.3/§4.4. **Niet in 2c-i:**
overdracht-UI (2c-ii, incl. B9), e2e-auth en axe (2d), Rules, CSV, statistiek, nieuwe
`localStorage`-sleutels.

## 1. Huidige werking

- `createAccountServices(db, auth)` bestaat, maar niets roept hem aan. De twee
  coördinatoren hebben elk een eigen slot (`LeaveOrganizationCoordinator` per
  organisatie, `AccountDeletionCoordinator` over zijn drie methoden).
- `AuthGate` volgt de memberships live; zonder gekozen context springt de afgeleide
  state (geen-organisaties ↔ contextwisselaar) mee. Na `deleteUser` wordt `authUser`
  `null` en verdwijnt elk scherm (ook `App`) ten gunste van `LoginScreen`.
- `App` heeft een eigen `lang`-state; `AuthGate` ook. Een taalwissel in `App` bereikte
  `AuthGate` (en dus `SessionBar`) tot nu toe niet.
- `NoOrganizationsScreen` wist `bootstrapOrgId` alleen bij succes (R6).

## 2. Plaatsing in de UI (bestaande patronen, geen nieuwe navigatie)

- **Flowstate in `AuthGate`** (hook `useAccountFlow`), dialoog `AccountFlowDialog` in elke
  tak van `AuthGate` op een vaste plek ná het scherm. Een membership-snapshot, een
  contextwissel of `authUser = null` unmount wel het scherm, niet de flow. De
  coördinatoraanroep start uitsluitend vanuit een gebruikersactie in de hook, nooit
  vanuit een mount-effect (een remount roept dus niets opnieuw aan).
- **Ingang 1:** nieuw `AccountPanel` op het tabblad Instellingen in `App` (zelfde plek en
  vorm als `ExportPanel`/`DeletionPanel`), alleen in cloudmodus. Owner: geen
  verlaatknop maar de blokkade-uitleg (overdracht volgt in 2c-ii). Andere rollen en
  team-only: knop "Organisatie verlaten…". Iedereen: "Account verwijderen…".
- **Ingang 2:** `NoOrganizationsScreen` krijgt een sectie "Account verwijderen" (de
  hervatting "Firestore leeg, Auth aanwezig", §B.4).
- **Eén slot:** `AccountActionGate` (application) omhult beide coördinatoren met één
  synchroon slot; een tweede actie terwijl er één loopt geeft `in-progress` zonder
  coördinatoraanroep. De hook opent bovendien geen tweede flow zolang er één open is.
- **Taal:** `App` meldt zijn taal via een nieuwe optionele prop `onLangChange`; zo
  spreken dialoog en `SessionBar` de taal die de gebruiker ziet.

## 3. Uitkomst → tekstsleutel

`organisatie verlaten` (`leave()`), alle sleutels `leaveOrg*`:

| Uitkomst | Sleutel(s) | Opnieuw |
| --- | --- | --- |
| `ok` | `leaveOrgOk`; + `leaveOrgOkInvitationsUnchecked` als `invitationsChecked=false`; + `leaveOrgOkDeletionPending` als `organizationDeletionPending` | nee (Sluiten → context wissen, abonnement opnieuw) |
| `not-signed-in` | `leaveOrgNotSignedIn` | nee |
| `in-progress` | `accountActionBusy` | ja |
| `offline` | `leaveOrgOffline` + `accountNothingChanged` | ja |
| `failed/timeout`, `failed/read-failed` | `leaveOrgFailedTimeout`, `leaveOrgFailedRead` + `accountNothingChanged` | ja |
| `not-a-member` | `leaveOrgNotAMember` + `accountNothingChanged` | nee |
| `denied/<reden>` (7 redenen) | `leaveOrgDenied{OwnerSole,OwnerAwaitingRemoval({count}),CreatorNeedsOwner,Unsupported,Missing,AwaitingDeletion,DeletionFailed}` + `accountNothingChanged` | nee |
| `blocked/local-unsynced-work` | `leaveOrgBlockedLocalWork({count})` + `accountNothingChanged` | nee |
| `incomplete/<stage>` | `leaveOrgIncomplete` + `accountStage*` + `accountStepError*` (indien `error`) | ja (hervat) |

`account verwijderen`, alle sleutels `accountDelete*`:

| Methode → uitkomst | Weergave |
| --- | --- |
| assess → `ready-to-clear` | plan: per organisatie `accountDeleteClass*` (11 klassen) + `accountDeleteInvitations({count})` + `accountDeleteReadyIntro`; knop Doorgaan |
| assess/clear → `needs-action` | zelfde plan, `accountDeleteBlockedTitle` (+ `accountDeletePlanChanged` na clear); géén Doorgaan |
| assess → `ready-for-auth-deletion` | `accountDeleteAuthOnly`; knop Doorgaan (direct naar `deleteAuthAccount`) |
| `not-signed-in` / `email-not-verified` / `offline` / `failed(read-failed|timeout)` | `accountDeleteNotSignedIn` / `accountDeleteEmailNotVerified` (+ knop bevestigingsmail) / `accountDeleteOffline` / `accountDeleteFailedRead|Timeout` |
| `in-progress` | `accountActionBusy` |
| `auth-state-unknown` (alle drie) | `accountDeleteAuthStateUnknown` |
| clear/delete → `reauth-failed/<reden>` | in het wachtwoorddialoog: `accountDeleteWrongPassword` / `TooManyRequests` / `ReauthNetwork` / `ReauthOther` |
| clear → `ready-for-auth-deletion` | direct `deleteAuthAccount` met hetzelfde wachtwoord (één handeling) |
| clear/delete → `incomplete/<stage>` | `accountDeleteIncomplete` (+ `accountStage*`, `accountStepError*`); bij `final-gate` met `remaining`: `accountDeleteIncompleteFinalGate({members},{teams},{invitations})`; Opnieuw = opnieuw beoordelen |
| delete → `firestore-cleared-auth-present/<reden>` | `accountDeleteClearedAuthPresent` ("je account bestaat nog") + `accountDeleteReason{RecentLogin,Network,Other}`; Opnieuw = wachtwoord → `deleteAuthAccount` |
| delete → `deleted` | B7, daarna `accountDeleteDeleted` (+ `accountDeleteLocalWipeFailed` als het wissen gooit) |

"Account verwijderd" verschijnt uitsluitend bij `deleted`.

## 4. B7 na `deleted`

`wipeLocalFirebaseData()` beëindigt de Firestore-instantie en wist haar
IndexedDB-persistentie (cache met organisatiedata en e-mailadressen); het raakt geen
`localStorage`. Daarna `initFirebase(vertrouwd?)`, zoals `handleSignOut()` na het wissen,
zodat een volgende login in dezelfde sessie werkt, en de bestaande selectedContext-pointer
wissen (wat "Terug naar wisselaar" ook doet). **Nooit `clearLocalDeviceData()`**: die wist
ook lokale-modusdata (instellingen, spelerslijst, v1-wedstrijden).

## 5. Dialooggedrag

- Eén `role="dialog"`/`aria-modal` met `useFocusTrap` (focus in bij openen, Tab cyclet,
  terug naar de openende knop bij sluiten als die nog bestaat). Bij elke stapwissel gaat de
  focus naar het eerste focusbare element van de nieuwe stap.
- Escape en backdrop sluiten, behalve tijdens een lopende aanroep (dan is niets te
  sluiten; knoppen uit, zoals `DeletionConfirmDialog`).
- **Wachtwoord:** `type="password"`, `autocomplete="current-password"`, alleen in de
  lokale state van het dialoog; bij versturen meteen leeggemaakt en uitsluitend als
  argument doorgegeven. Nooit in de hookstate, een uitkomst, een log of storage.
- **Bevestiging:** verlaten is een gewone bevestiging (terugkomen kan met een nieuwe
  uitnodiging). Accountverwijdering vraagt het wachtwoord (reauth, B2): dat is sterker dan
  een getypte tekst. Getypte bevestiging blijft voor "andere eigenaar verwijderen" (B9, 2c-ii).

## 6. R6-fix (NoOrganizationsScreen)

**Afwijking, ter bevestiging door de eigenaar:** de maker kan `createdAt` niet lezen (zonder
membership weigert `isOrgMember` de read van `organizations/{orgId}`), en een tijdstempel
lokaal bewaren vraagt een nieuwe sleutel of een ander waardeformaat (verboden zonder
besluit). Daarom: geeft de **hervatting** (`bootstrapOrgId` was al gezet) `permission-denied`,
dan wist het scherm `bootstrapOrgId`, toont `onboardingResumeExpired` en maakt de volgende
klik een nieuwe organisatie. Binnen de 7 dagen geeft de hervatting geen
`permission-denied` (bestaand membership → `ok`, anders slaagt de bootstrap); de andere
oorzaken (organisatie bestaat niet, niet de maker) zijn evengoed permanent. Een netwerkfout
(`unavailable`) wist niets. Gevolg: hooguit een extra weesorganisatie zonder lid (runbook).

## 7. Risico's

- **Opslag:** geen nieuwe sleutel; alleen het al bestaande `bootstrapOrgId` (R6) en de
  selectedContext-pointer worden gewist. B7-test borgt dat `clearLocalDeviceData` niet
  wordt aangeroepen.
- **CSV/statistiek:** geen raakvlak.
- **Offline:** beide flows zijn online-acties; offline geeft een melding zonder write en
  het dialoog blijft sluitbaar, dus lokale wedstrijden spelen gaat gewoon door. Onbevestigd
  lokaal werk blokkeert (probe).
- **Vertalingen:** alle teksten NL+EN, pariteitstest; mappingtest per uitkomst in beide talen.
- **Rest:** de membership-lijst in `AuthGate` vergeet een verlaten organisatie pas na een
  nieuw abonnement; daarom start Sluiten na `ok` het abonnement opnieuw. Focusherstel als de
  openende knop is verdwenen (na verlaten) en axe zijn 2d. Een contextvergrendeling door een
  wedstrijd in opzet met cloudclaim wordt na een geslaagd vertrek niet apart gerespecteerd
  (de probe blokkeert alleen een gestarte wedstrijd of open afronding).

## 8. 2c-ii — overdracht-UI (B9)

Bovenop de 2b-iii-fix (#110). Bron: ontwerp `docs/pr-8.3c-2b-plan.md` §B.8/§C.3/§I (B9),
besluitrecord §4.2. **Niet in 2c-ii:** e2e-auth, axe en echte-browserfocus (2d), Rules, CSV,
statistiek, nieuwe `localStorage`-sleutels, wissen van org-sleutels na `deleted` (R7).

- **Huidige werking:** `OwnershipTransferCoordinator` heeft een eigen slot over `promote` en
  `completeTransfer`; niets roept hem aan. Owners zien in `AccountPanel` alleen de
  blokkade-uitleg (doodlopend). `organizationNameFor` valt terug op de ruwe organisatie-ID.
- **Eén slot:** `AccountActionGate` krijgt `listTransferCandidates`, `promote` en
  `completeTransfer` achter hetzelfde slot als `leave`/`assess`/`clear`/`deleteAuth` (ook de
  read-only lijst, zoals `assess`). Flowstate in dezelfde `useAccountFlow` (`kind: 'transfer'`,
  `mode: 'promote' | 'remove-owner'`); aanroepen alleen vanuit een klik, nooit bij mount.
- **Plaatsing:** in `AccountPanel`, **alleen voor owners**, onder de blokkade-uitleg (die nu
  naar de knop verwijst): "Eigendom overdragen…" en "Andere eigenaar verwijderen…". Andere
  rollen en team-only zien geen van beide. De owner-sole-teksten in het verlaatdialoog en in
  het verwijderplan krijgen een knop "Eigendom overdragen…" die de afgeronde flow vervangt
  door de overdrachtsflow voor die organisatie (`switchToTransfer`, nooit tijdens een aanroep).
- **Flow A:** klik → `listTransferCandidates` → lijst van `candidates` (e-mailadres + rol;
  een leeg adres krijgt een neutraal label, nooit uid of org-ID; testid's op index) →
  kiezen → bevestiging (B wordt mede-eigenaar; jij blijft eigenaar tot B jou verwijdert; tot
  dan kun je niet vertrekken of je account verwijderen) → `promote` → bij `ok` "wacht op
  bevestiging door de nieuwe eigenaar". Gewone bevestiging: promoveren is terug te draaien
  (B kan A niet verwijderen zonder eigen handeling, en A blijft owner).
- **Flow B:** klik → `listTransferCandidates` → lijst van uitsluitend `otherOwners` → kiezen
  → **getypte bevestiging van het e-mailadres** van die owner (er is geen naamveld in
  `TransferMember`; het adres komt uit de serverlezing) → `completeTransfer`. Beleid, zoals
  `DeletionConfirmDialog`: knop uit tot de invoer klopt, invoer getrimd; **afwijking:** zonder
  hoofdlettergevoeligheid (`isSameEmailAddress`, dezelfde vergelijking als het intrekken;
  een adres heeft geen betekenisvolle hoofdletters). Spaties binnenin tellen mee. De hook
  controleert de tekst nogmaals (een gedispatchte klik omzeilt niets). "Opnieuw" na een
  hervatbare uitkomst vraagt geen nieuwe invoer (zelfde doel, al bevestigd in deze flow).
- **Netwerk:** elke stap is online; offline zegt de tekst dat overdragen online moet en dat
  wedstrijden op dit apparaat gewoon door kunnen.

| Methode → uitkomst | Sleutel(s) (`transfer*`, NL+EN) | Opnieuw |
| --- | --- | --- |
| lijst → `ok` | lijst; leeg: `transferNoCandidates` / `transferNoOtherOwners` | — |
| alle → `not-signed-in` | `transferNotSignedIn` | nee |
| alle → `in-progress` | `accountActionBusy` | ja |
| alle → `offline` | `transferOffline` + `accountNothingChanged` | ja |
| alle → `failed/read-failed`, `failed/timeout` | `transferFailedRead` / `transferFailedTimeout` + `accountNothingChanged` | ja |
| alle → `denied/{not-a-member,not-owner}` | `transferDeniedNotAMember` / `transferDeniedNotOwner` + `accountNothingChanged` | nee |
| promote/complete → `denied/self` | `transferDeniedSelf` + `accountNothingChanged` | nee |
| complete → `denied/target-not-owner` | `transferDeniedTargetNotOwner` + `accountNothingChanged` | nee |
| promote → `ok/promoted`, `ok/already-owner` | `transferPromoteOk` / `transferPromoteAlreadyOwner` + `transferPromoteAwaiting` | nee |
| promote → `not-found` | `transferPromoteNotFound` + `accountNothingChanged` | nee |
| promote → `rejected/{target-changed,permission-denied}` | `transferRejectedTargetChanged` / `transferRejectedPermission` + `accountNothingChanged` | nee |
| promote → `timeout`, `failed/write-failed` | `transferPromoteTimeout` / `transferPromoteFailedWrite` | ja |
| complete → `ok` | `transferCompleteOk` + `transferCompleteCounts`; + `transferCompleteSkippedMalformed` als > 0; + `transferCompleteAlreadyGone` | nee |
| complete → `not-found` | `transferCompleteNotFound` ("al afgerond") | nee |
| complete → `rejected/<reden>/<stage>` | `transferRejectedTargetChanged` / `transferRejectedPermission` + `transferStage*` + `transferCompletePartial` | nee |
| complete → `incomplete/<stage>` | `transferCompleteIncomplete` + `transferStage*` + `transferStepError*`/`accountStepError*` | ja (hervat) |
| een gooiende poort | lijst: `transferFailedRead`; promote: `transferPromoteFailedWrite`; complete: `transferCompleteIncomplete` | ja |

`rejected` bij `completeTransfer` meldt altijd "er kan al iets zijn ingetrokken of
verwijderd" (ook bij `invitations`: intrekkingen vóór de fout worden niet teruggedraaid).

**Kleine punten uit de review van 2c-i:** `organizationNameFor` geeft zonder bekende naam
`accountOrganizationNameUnknown` in plaats van de ID; `accountDeletePasswordDesc` zegt al in
beide talen dat het onomkeerbaar is (vastgezet in een test); threat model §7 krijgt R7 en een
aanvulling op R6.

**Risico's:** *opslag* — geen nieuwe sleutel, niets gewist; *CSV/statistiek* — geen raakvlak;
*offline* — alleen online, het dialoog blijft sluitbaar en spelen gaat door; *vertalingen* —
pariteitstest plus mappingtest per uitkomst in beide talen. *Rest:* de lijst is een momentopname
(de coördinator leest bij promote/complete opnieuw van de server); twee owners die elkaar
tegelijk verwijderen geeft één `rejected/permission-denied` (2b-iii-fix); R2 (re-bootstrap van
een verwijderde maker binnen 7 dagen) blijft; focus en axe in een echte browser zijn 2d.
