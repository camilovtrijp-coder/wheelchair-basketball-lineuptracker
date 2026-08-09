# PR 5.4 — Onderzoeksrapport multi-organisatie- en twee-apparatenpilot

Status: 5.4a (#37) en 5.4b (#40) zijn gemerged; 5.4c (#41) sluit het rapport en de §17-administratie af.
Basis: `main` op `ceb8dc0` (mergecommit van #40). De uiteindelijke mergegate is groene CI op de exacte head van #41.
Datum: 9 augustus 2026.

## A. Scope en locked-in beslissingen

PR 5.4 realiseert de multi-organisatie- en twee-apparatenpilot uit `docs/IMPLEMENTATION_PLAN.md` §10. De drie opeenvolgende sub-PR's zijn:

- **5.4a (#37, `494b4d9`)** — UI-rolgrenzen en listener-foutdetectie;
- **5.4b (#40, `ceb8dc0`)** — veldpatches, last-write-wins, actualiteit en vier twee-apparatenscenario's;
- **5.4c (#41)** — ontbrekend eindbewijs, dit rapport en de §17-correctie.

De zeven beslissingen uit `docs/pr-5.4-plan.md` §E blijven gelden:

1. hetzelfde veld volgt Firestore last-write-wins; verschillende settingsvelden worden afzonderlijk gepatcht;
2. de mobiele combinatie “offline write + reload met pending write” blijft een harde handmatige 5.5-gate;
3. UI-rolgrenzen gebruiken de bestaande `canWrite`-prop, zonder nieuwe autorisatielaag;
4. mobiele validatie is handmatig; WebKit-CI valt buiten 5.4;
5. 5.4 gebruikt een reproduceerbare emulatorproxy voor verbruik, werkelijke stagingcijfers horen bij 5.5;
6. issue #28 is al gesloten in PR #29; #41 corrigeert alleen de resterende roadmapverwijzingen;
7. stale-listener-signalering is in #37 afgehandeld; bredere multi-write-queue-semantiek blijft getriggerde vervolgscope.

Opslagkeys, CSV, statistieklogica, productie-infrastructuur en deployment zijn niet gewijzigd.

## B. Scenario-bevindingen

| Scenario                                                | Verwacht                                                                                                     | Waargenomen                                                                                      | Testbewijs                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Rolgrenzen, 5 rollen × 2 panels                         | Owner/admin/coach mogen schrijven; scorer/viewer zijn read-only                                              | Alle 10 combinaties groen                                                                        | `v2/tests/e2e-auth/role-matrix-ui.spec.ts:1-140`                                                                              |
| Listenerfout na initiële load                           | Niet-blokkerende melding; herstel bij nieuwe emit; pre-load-fout blijft een harde offline-state              | Alle drie paden bewezen                                                                          | `v2/tests/unit/AppListenerError.spec.tsx:150-203`                                                                             |
| Twee apparaten, hetzelfde team                          | B ontvangt A's wijziging zonder reload                                                                       | B convergeert naar A en de vaste seedtimestamp uit 2000 verandert naar de nieuwe servertimestamp | `v2/tests/e2e-auth/two-devices-same-context.spec.ts:9-41`                                                                     |
| Beide apparaten wisselen door 2 organisaties en 3 teams | Elk apparaat bezoekt A/team 1, A/team 2, B/team 3 en keert terug                                             | Beide onafhankelijke browsercontexten tonen in elke stap het juiste team                         | `v2/tests/e2e-auth/two-devices-context-switch-three-teams.spec.ts:1-41`                                                       |
| Twee apparaten, verschillende organisaties              | Parallelle writes blijven organisatiespecifiek                                                               | Beide documenten behouden uitsluitend hun eigen wijziging                                        | `v2/tests/e2e-auth/two-devices-different-orgs.spec.ts:4-39`                                                                   |
| Bewust conflict op hetzelfde veld                       | Eén serverwaarde wint; beide clients convergeren; geen `actie-nodig`                                         | Winnaar mag Alpha of Beta zijn en wordt op beide clients gelijk                                  | `v2/tests/e2e-auth/deliberate-conflict.spec.ts:10-50`                                                                         |
| Gelijktijdige niet-conflicterende velden                | A's `teamName` en B's `tag1Label` blijven beide behouden                                                     | Beide clients zien de gecombineerde waarde                                                       | `v2/tests/e2e-auth/concurrent-non-conflicting-writes.spec.ts:10-49`                                                           |
| Membership ingetrokken rond een queued write            | Reconnect weigert de write; lokaal herstel blijft beschikbaar; serverwaarde blijft intact                    | Browser- en Rules-bewijs blijven groen in iedere CI-run                                          | `firebase-spike/tests/e2e/revoked-while-offline.spec.ts:51-158`; `firebase/tests/rules/offline-revocation-node.spec.ts:62-91` |
| Actualiteit en cachebron                                | NL/EN-labels, geen timestamp zonder waarde, cachebron zichtbaar wanneer minstens één bron uit cache komt     | Unit- en e2e-bewijs groen                                                                        | `v2/tests/unit/LastModified.spec.tsx:9-25`; `v2/tests/unit/SyncStatusIndicator.spec.tsx:29-37`                                |
| Repository-writecontract                                | Bestaand document krijgt veldpatch; nieuw document volledige write; afgewezen create wordt volledig herhaald | Alle positieve en herstelpaden groen                                                             | `v2/tests/unit/FirestoreSettingsRepository.spec.ts:127-197`                                                                   |
| Late schrijfuitkomsten                                  | Dismiss/unmount/nieuwere save worden niet door een oude settled-uitkomst teruggedraaid                       | Generatieteller- en lifecycletests groen                                                         | `v2/tests/unit/useSyncStatus.spec.ts:302-412`                                                                                 |

Na toevoeging van het ontbrekende contextwisselbewijs bestaat de auth-e2e-suite uit 39 tests: 24 bestaande basisgevallen, 10 rolmatrixgevallen en 5 twee-apparatengevallen. De overige regressieoppervlakken blijven 229 v2-unit-tests, 33 bestaande v2-e2e-tests, 25 firebase convertertests, 67 firebase Rules-tests en 45 spike-Rules-tests plus 3 spike-e2e-tests.

### Verbruik binnen de 5.4-meetgrens

`firebase/tests/rules/pilot-reads-writes-accounting.spec.ts` voert de vier write-intensieve pilotscenario's tegen de Emulator Suite uit en telt de expliciete clientoperaties:

| Pilotflow                              | Client-reads |  Writes |
| -------------------------------------- | -----------: | ------: |
| Live-deliver, hetzelfde team           |            3 |       1 |
| Parallel in verschillende organisaties |            4 |       2 |
| Bewust conflict                        |            4 |       2 |
| Niet-conflicterende veldpatches        |            4 |       2 |
| **Totaal volledige run**               |       **15** |   **7** |
| **Extrapolatie 100 volledige runs**    |    **1.500** | **700** |

Dit is bewust een reproduceerbare emulatorproxy en geen factuurmeting. Rules-interne `get()`/`exists()`-reads, listener-reconnects en eventueel door de SDK samengevoegde listener-events zijn niet als billable usage uit de emulator uit te lezen. Daarom is de extrapolatie een ondergrens; werkelijke stagingmeting blijft expliciet onderdeel van 5.5.

## C. Open punten — verplicht overgedragen aan PR 5.5

1. handmatige iOS/Android-validatie van offline schrijven en herladen met een pending write, via echte OS-netwerkonderbreking;
2. werkelijke Firestore-verbruiksmeting op het stagingproject, inclusief Rules-reads en listenergedrag;
3. expliciete multi-write-queue-/mergesemantiek zodra multi-tabgebruik of Fase 6 PR 6.2 dit activeert.

Deze punten zijn open en worden niet als door 5.4 bewezen gepresenteerd.

## D. Cross-references

- issue #27: gesloten op verkleinde scope in PR #36; mobiel + echte Firebase blijft hierboven als 5.5-gate staan;
- issue #28: gesloten in PR #29 via het collectionGroup-querycontract en het `uid`-veld;
- §J-triggercriteria: al aanwezig in `docs/pr-5.3d-onderzoeksrapport.md:430-461`;
- §17: #41 corrigeert Fase 4, PR 4.4 en Fase 5 en gebruikt de echte PR-nummers #37, #40 en #41.
