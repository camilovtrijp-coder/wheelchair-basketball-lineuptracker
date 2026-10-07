export const LANG_STORAGE_KEY = 'lineup-tracker-lang';

export const SUPPORTED_LANGS = ['nl', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = 'nl';

const nl = {
  switchToEn: 'Schakel naar Engels',
  switchToNl: 'Schakel naar Nederlands',

  appNameFallback: 'Lineup Tracker',
  settingsTitle: 'Instellingen',
  settingsOpen: '⚙ Instellingen',
  settingsSectionClub: 'Club',
  settingsSectionMatch: 'Wedstrijd',
  settingsSectionClass: 'Classificatie',
  teamNameLabel: 'Teamnaam',
  logoLabel: 'Logo',
  logoChooseBtn: 'Logo kiezen',
  logoRemoveBtn: 'Logo verwijderen',
  primaryColorLabel: 'Primaire kleur',
  accentColorLabel: 'Accentkleur (tegenstander)',
  quarterCountLabel: 'Aantal periodes',
  quarterLabel: 'Kwart',
  periodLabelLabel: 'Naam periode',
  useClassLimitLabel: 'Classificatiesysteem gebruiken',
  toggleTag1Default: 'Categorie 1',
  tag1LabelLabel: 'Label categorie 1',
  tag1LabelHint: 'bijv. Vrouw',
  toggleTag2Default: 'Categorie 2',
  tag2LabelLabel: 'Label categorie 2',
  tag2LabelHint: 'bijv. Jeugd/U19',
  classBaseLimitSettingLabel: 'Basis classificatie (standaardwaarde)',
  maxBonusLabel: 'Maximale bonus',
  bonusTag1OnlyLabel: 'Bonus bij categorie 1',
  bonusTag2OnlyLabel: 'Bonus bij categorie 2',
  bonusBothLabel: 'Bonus bij beide categorieën',
  classLimitExplain:
    'Dit systeem beperkt de totale classificatie van de 5 spelers op de vloer, met een bonus voor twee optionele categorieën - oorspronkelijk bedacht als categorie 1 = Vrouw en categorie 2 = Jeugd/U19, om gemixte en jonge line-ups te stimuleren. Je kunt de labels en bonuswaarden hieronder naar wens aanpassen.',
  customColorBtn: 'Aangepast',
  saveBtn: 'Opslaan',
  settingsResetBtn: 'Standaardinstellingen herstellen',
  logoTooLargeError: 'Logo is te groot (max 500 KB). Kies een kleinere afbeelding.',
  settingsSaveError: 'Opslaan is mislukt. Controleer de opslagruimte van je browser.',
  saveSuccessMessage: 'Opgeslagen ✓',

  rosterTitle: 'Team',
  rosterIntro:
    'Beheer hier je spelerslijst: rugnummer, naam en — als je het classificatiesysteem gebruikt (instellingen) — een classificatiewaarde en categorieën.',
  playerNrLabel: 'Rugnummer',
  playerNameLabel: 'Naam',
  playerClassLabel: 'Klasse',
  addPlayerBtn: '+ Speler toevoegen',
  removePlayerBtn: 'Verwijderen',
  confirmDeletePlayer: 'Deze speler definitief verwijderen? Dit kan niet ongedaan worden gemaakt.',
  dupNumberWarningLabel: '⚠ Dubbel rugnummer:',
  rosterSaveError: 'Opslaan is mislukt. Controleer de opslagruimte van je browser.',

  gameTitle: 'Wedstrijd',
  preGameIntro:
    'Kies wie er meedoet en wie start. Spelersgegevens (naam, rugnummer, classificatie) pas je aan op Team.',
  noPlayersYet: 'Nog geen spelers. Voeg ze toe via Team.',
  goToTeamBtn: 'Naar Team →',
  participateToggle: 'Meedoen',
  toggleStart: 'Start',
  noStarters: 'Geen starters gekozen — automatisch de 5 laagste rugnummers.',
  startersChosenSuffix: 'gekozen als starter',
  teamOpponent: 'Tegenstander',
  opponentPlaceholder: 'Optioneel',
  competitionLabel: 'Competitie/toernooi',
  competitionPlaceholder: 'Optioneel',
  classLimitLabel: 'Basis classificatie',
  classLimitHint: '(basis + bonus)',
  clockDownLabel: 'Wedstrijdklok telt af',
  clockDownHint: '(10:00 → 0:00)',
  startNeedFive: 'Minimaal 5 spelers met een naam nodig',
  startFixDup: 'Los dubbele rugnummers op',
  startNeedFiveParticipating: 'Minimaal 5 deelnemende spelers nodig',
  startChooseFive: 'Kies precies 5 starters (of 0 voor automatisch)',
  startGameBtn: 'Start wedstrijd',
  gameSaveError: 'Opslaan is mislukt. Controleer de opslagruimte van je browser.',
  gameReadOnly: 'Alleen-lezen',
  claimPendingBtn: 'Wedstrijd claimen…',
  claimBlockedOffline: 'Geen verbinding — kan de wedstrijd niet claimen voor je begint.',
  claimBlockedAlreadyClaimed: 'Deze wedstrijd wordt al door een ander apparaat gescoord.',
  claimBlockedStaleRevision: 'De wedstrijd is net gewijzigd. Probeer opnieuw.',
  claimBlockedRoleDenied: 'Je hebt geen rechten om deze wedstrijd te claimen.',
  claimBlockedGameCompleted: 'Deze wedstrijd is al afgerond.',
  claimBlockedUnknown: 'Claimen is mislukt. Probeer opnieuw.',
  claimRetryBtn: 'Opnieuw proberen',
  // 8.1b (docs/pr-8.1-plan.md §C 8.1b): pre-game PWA-/offline-gereedheids-
  // meldingen in GameSetupPanel, één per PwaReadinessStatus-deelstatus —
  // nooit een generieke "kan niet starten" (werk 3). Alleen
  // pwaReadinessBroken blokkeert daadwerkelijk het starten (werk 2/4); de
  // andere drie zijn puur informatief.
  pwaReadinessUnsupported:
    'Geen offline-ondersteuning gedetecteerd op dit apparaat. Alleen-lokaal gebruik werkt gewoon.',
  pwaReadinessRegistering: 'De app wordt nog offline-klaar gemaakt. Probeer het zo opnieuw.',
  pwaReadinessUpdatePending:
    'Er staat een update klaar. Overweeg die vóór de wedstrijd bij te werken.',
  // 8.1c (docs/pr-8.1-plan.md §C 8.1c werk 2): dezelfde `broken`-deelstatus
  // dekt nu ook het gedegradeerde pad waarin zowel de module- als de
  // classic-SW-registratie op dit apparaat zijn mislukt (geen nieuwe,
  // aparte deelstatus nodig — zie `domain/pwa/pwaReadiness.ts`'s eigen
  // commentaar). Tekst expliciet gemaakt: offline-gebruik is op dit
  // apparaat niet gegarandeerd (i.p.v. alleen "check mislukt"), zodat de
  // scorer begrijpt dat dit apparaatspecifiek is — alleen-lokaal
  // roster-/instellingengebruik blijft buiten wedstrijdstart gewoon
  // werken.
  pwaReadinessBroken:
    'Offline-gebruik is op dit apparaat niet gegarandeerd. Probeer opnieuw voordat je start.',
  contextSwitchLockedWhileTracking:
    'Je kunt niet van team wisselen terwijl er een wedstrijd loopt. Rond de wedstrijd eerst af.',
  contextSwitchLockedDismiss: 'Oké',
  viewerActiveScorerNotice:
    'Alleen-lezen: een ander apparaat scoort nu deze wedstrijd. Je bediening is uitgeschakeld.',
  viewerFreshnessServer: 'live',
  viewerFreshnessCache: 'uit cache, mogelijk niet actueel',
  viewerFreshnessError: 'verbinding verbroken — laatst bekende stand',
  takeoverOpenBtn: 'Overnemen…',
  takeoverConfirmTitle: 'Wedstrijd overnemen?',
  takeoverConfirmDesc:
    'Je wordt de nieuwe schrijver voor deze wedstrijd. Het andere apparaat kan vanaf dat moment niets meer opslaan totdat het zelf opnieuw overneemt.',
  takeoverCurrentWriterLabel: 'Huidige schrijver',
  takeoverCurrentWriterUnknown: 'onbekend',
  takeoverLastActivityLabel: 'Laatste serveractiviteit',
  takeoverLastActivityUnknown: 'nog nooit',
  takeoverPendingActionsWarning:
    'Dit apparaat heeft nog {count} niet-gesynchroniseerde actie(s). Na overname worden die opnieuw geprobeerd; ze gaan niet verloren.',
  takeoverConfirmBtn: 'Ja, overnemen',
  takeoverCancelBtn: 'Annuleren',
  takeoverInProgress: 'Overnemen…',
  takeoverBlockedOffline: 'Geen verbinding — kan de wedstrijd nu niet overnemen.',
  takeoverBlockedAlreadyClaimed:
    'Een ander apparaat nam de wedstrijd net al over. Probeer opnieuw.',
  takeoverBlockedStaleRevision: 'De wedstrijd is net gewijzigd. Probeer opnieuw.',
  takeoverBlockedRoleDenied: 'Je hebt geen rechten om deze wedstrijd over te nemen.',
  takeoverBlockedGameCompleted: 'Deze wedstrijd is al afgerond.',
  takeoverBlockedUnknown: 'Overnemen is mislukt. Probeer opnieuw.',
  actionNeededExportGameActionsBtn: 'Exporteer niet-gesynchroniseerde acties',
  v1MigrationTitle: 'Oude actieve wedstrijd gevonden',
  v1MigrationDesc:
    'Deze wedstrijd stond nog klaar van vóór de update. Controleer of onderstaand team klopt voordat je hem overneemt.',
  v1MigrationTargetLabel: 'Overnemen naar',
  v1MigrationScoreLabel: 'Huidige stand',
  v1MigrationSwitchHint:
    'Niet het juiste team? Wissel eerst van team via de knop rechtsboven — bevestig hier pas als dit team klopt.',
  v1MigrationConfirmBtn: 'Ja, dit is het juiste team — overnemen',

  teamFallbackLabel: 'Team',
  segmentDeltaLabel: 'segment:',
  correctMinus1Btn: '−1 corrigeren',
  onCourtLabel: 'Op de vloer (5)',
  tooManyClassPointsPrefix: '⚠ Te veel classificatiepunten op het veld',
  swapChosenSuffix: ' gekozen — tik de speler om mee te ruilen.',
  swapHint:
    'Wisselen? Tik een speler (vloer óf bank), dan de ander. Meerdere wissels achter elkaar kan.',
  swapDoneBtn: '✓ Klaar met wisselen — kloktijd',
  cancelBtn: 'Annuleer',
  benchLabel: 'Bank',
  segmentCardTitle: 'Segment vastleggen',
  beginLabel: 'Begin',
  endLabel: 'Eind',
  minutesUnitLabel: 'minuten',
  secondsUnitLabel: 'seconden',
  scoreSelectLabel: 'Score {team}',
  segDurationValidPrefix: 'Speeltijd dit segment:',
  endAfterBegin: 'Eind moet ná begin liggen.',
  saveSegmentBtnPrefix: 'Segment opslaan',
  needFiveOnCourt: 'Er moeten precies 5 spelers op de vloer staan.',
  segmentsTitlePrefix: 'Segmenten',
  tapToEdit: 'Tik om te bewerken',
  lineupStandingPrefix: 'Deze opstelling staat al',
  swapConfirmTitle: 'Wissel(s) — kloktijd?',
  swapConfirmDesc:
    'Het segment tot nu toe wordt afgesloten met de opstelling van vóór deze wissel(s), op het tijdstip hieronder. Daarna gaat het nieuwe segment verder met de huidige opstelling.',
  timeLabel: 'Tijd',
  segSoFarPrefix: 'Segment tot nu toe:',
  timeAfterSegStart: 'Tijd mag niet vóór het begin van dit segment liggen.',
  backBtn: 'Terug',
  confirmBtn: 'Bevestigen',
  editSegmentTitle: 'Segment bewerken',
  lineupChosenSuffix: 'gekozen',
  deleteBtn: 'Verwijderen',
  confirmDeleteSegment: 'Dit segment verwijderen? De score wordt automatisch herberekend.',
  pointsForLabel: 'Punten voor',
  pointsAgainstLabel: 'Punten tegen',
  segDurationPlainPrefix: 'Speeltijd:',
  lineupLabel: 'Lineup',

  finishGameBtn: 'Wedstrijd afronden',
  confirmFinishGame:
    'Wedstrijd afronden? Dit kan niet ongedaan worden gemaakt: de wedstrijd komt onveranderlijk in de historie te staan.',
  historyTitle: 'Historie',
  historyEmpty: 'Nog geen afgeronde wedstrijden.',
  historyCloudReadError:
    'De cloudhistorie kon niet geladen worden. De hieronder getoonde wedstrijden zijn mogelijk onvolledig (alleen lokaal beschikbaar); probeer het later opnieuw.',
  confirmDeleteGame: 'Deze wedstrijd definitief verwijderen? Dit kan niet ongedaan worden gemaakt.',
  deleteBlockedPendingSync:
    'Deze wedstrijd is nog niet naar de cloud gesynchroniseerd. Wacht tot de synchronisatie is voltooid en probeer het daarna opnieuw.',
  historyDeleteError:
    'Verwijderen is niet gelukt. Controleer je verbinding en probeer het opnieuw.',
  historyTombstoneNoticeSingular:
    '1 afgeronde wedstrijd is verwijderd door een teamgenoot op een ander apparaat.',
  historyTombstoneNoticePlural:
    '{count} afgeronde wedstrijden zijn verwijderd door een teamgenoot op een ander apparaat.',
  historyTombstoneDismissBtn: 'Negeren',
  exportShareBtn: 'Exporteren/Delen',
  // PR 6.4: Stats-tab. Strings gespiegeld van v1 (index.html
  // `stats[A-Z]*`-verten) zodat een vertaler beide talen tegelijk kan
  // beoordelen. NL = primary, EN = secondary.
  statsTitle: 'Statistieken',
  statsNoData: 'Nog geen wedstrijddata. Speel en rond een wedstrijd af om hier stats te zien.',
  statsNoCombos: 'Geen combinaties gevonden met dit filter.',
  statsReadError:
    'Kon de wedstrijdhistorie niet lezen. Probeer het later opnieuw of herlaad het tabblad.',
  statsPartialSingular: '1 segment bevat onbekende spelersreferenties en is overgeslagen.',
  statsPartialPlural:
    '{count} segmenten bevatten onbekende spelersreferenties en zijn overgeslagen.',
  statsCurrentGame: 'Huidige wedstrijd',
  statsPer10: 'Per 10 min',
  statsGamesBtn: 'Wedstrijden',
  statsFilterBtn: 'Filter spelers',
  statsGamesTitle: 'Filter op wedstrijd',
  statsFilterTitle: 'Filter spelers',
  statsFilterHint: '✓ = moet op de vloer staan · ✗ = moet op de bank staan · — = geen filter',
  statsComboSizeLabel: 'Aantal spelers in combinatie',
  statsSortToggleAsc: 'Sorteer +/- ↑',
  statsSortToggleDesc: 'Sorteer +/- ↓',
  statsColTime: 'Tijd',
  statsColPts: 'Pnt',
  statsColOpp: 'Teg',
  statsColOn: 'Met hen',
  statsColOff: 'Zonder hen',
  statsClearBtn: 'Wis filter',
  statsDoneBtn: 'Klaar',

  // PR 6.5: Trends-tab. Strings gespiegeld van v1 (index.html
  // `trends[A-Z]*`-vertalingen). NL = primary, EN = secondary.
  trendsTitle: 'Trends',
  trendsMinLabel: 'MIN',
  trendsPmLabel: '+/-',
  trendsPmChartLabel: '+/- per wedstrijd',
  trendsMinChartLabel: 'Minuten per wedstrijd',
  trendsNoData: 'Nog geen wedstrijddata. Speel en rond een wedstrijd af om hier trends te zien.',
  trendsSortLabel: 'Sorteer',
  trendsSortNr: 'Nr',
  trendsShowGames: 'Toon {n} wedstrijden',
  trendsHideGames: 'Verberg wedstrijden',
  trendsProvisional: 'Voorlopig',

  // PR 6.6: back-up, import en lokale migratie. Strings gespiegeld van v1
  // (index.html `backup*`/`importBackup*`-vertalingen) waar mogelijk. NL =
  // primary, EN = secondary.
  backupTitle: 'Back-up',
  diagnosticsTitle: 'Technische diagnose',
  diagnosticsDesc:
    'Bewaar maximaal 50 technische statuscodes in het geheugen van dit tabblad om problemen te onderzoeken.',
  diagnosticsPrivacy:
    'Bevat geen spelersgegevens, e-mailadressen, organisatie-, team- of wedstrijd-ID’s en wordt nooit automatisch verzonden.',
  diagnosticsCount: '{count} diagnosegebeurtenis(sen) in deze sessie.',
  diagnosticsDownloadBtn: '⬇ Download diagnose',
  diagnosticsClearBtn: 'Wis diagnose',
  backupDesc:
    'Bewaar een kopie van dit team (spelers, instellingen, wedstrijdgeschiedenis) — handig bij een nieuw toestel of gewiste browseropslag. Oudere back-ups van deze app blijven importeerbaar.',
  backupExportBtn: '⬇ Exporteer back-up',
  backupImportBtn: '⬆ Importeer back-up',
  importBackupInvalid: 'Dit bestand lijkt geen geldige Lineup Tracker-back-up te zijn.',
  importBackupInvalidData:
    'De back-up bevat ongeldige data: {details}. De huidige gegevens zijn niet aangepast.',
  importBackupInvalidDataAndMore: ' (en {n} andere fouten)',
  validationNoRecognizableData: 'De back-up bevat geen herkenbare data.',
  backupPreviewTitle: 'Back-up controleren',
  backupPreviewTarget: 'Doelteam: {org} / {team}',
  backupSectionSettings: 'Instellingen',
  backupSectionRoster: 'Team',
  backupSectionActiveGame: 'Actieve wedstrijd',
  backupSectionCompletedGames: 'Wedstrijdhistorie',
  backupSectionLang: 'Taalvoorkeur',
  backupEffectReplace: 'wordt vervangen',
  backupEffectClear: 'wordt geleegd',
  backupEffectUnchanged: 'blijft ongewijzigd',
  backupPreviewNotPresent: 'niet aanwezig in de back-up',
  backupDestinationLocal: 'lokaal',
  backupDestinationCloud: 'cloud',
  backupConfirmBtn: 'Bevestig import',
  backupCancelBtn: 'Annuleren',
  backupRestoreDownloading:
    'Er wordt eerst automatisch een herstelback-up van de huidige gegevens gedownload…',
  backupImportSuccess: 'Import gelukt. De pagina toont de nieuwe gegevens.',
  backupImportFailed:
    'Import mislukt bij "{section}". Eerder geschreven onderdelen zijn teruggedraaid; er is niets gedeeltelijk aangepast. De zojuist gedownloade herstelback-up bevat de gegevens van vóór deze poging.',

  // PR 7.4c: bulkmigratie-UI (docs/pr-7.4-plan.md §C 7.4c) — inventariseren →
  // preview → herstelback-up → sterke bevestiging → voortgang →
  // readback/resultaat → retry/export. Alleen zichtbaar voor
  // organizationOwner/organizationAdmin/coach (canBulkMigrate()); een
  // scorer/viewer krijgt dit blok nooit gerenderd, geen alleen-lezen variant.
  migrationTitle: 'Bestaande lokale gegevens naar de cloud',
  migrationDesc:
    'Kopieer instellingen, team en afgeronde wedstrijden die nu alleen lokaal op dit apparaat staan naar de cloud voor dit team. Je lokale gegevens blijven ongewijzigd bewaard — dit is geen verhuizing, maar een kopie.',
  migrationStartBtn: 'Migratie voorbereiden',
  migrationBuildingPreview: 'Lokale gegevens en cloudstatus worden ingelezen…',
  migrationErrorGeneric: 'Inlezen is mislukt. Probeer het opnieuw.',
  migrationDeniedCorruptTitle: 'Lokale gegevens zijn niet leesbaar',
  migrationDeniedCorruptDesc:
    'Er is een probleem gevonden in de lokale gegevens. Er is niets naar de cloud geschreven. Maak eerst een back-up (tabblad Instellingen) en controleer de foutmelding hieronder.',
  migrationPreviewTitle: 'Migratie controleren',
  migrationPreviewTarget: 'Doelteam: {org} / {team}',
  migrationSectionSettings: 'Instellingen',
  migrationSectionRoster: 'Team',
  migrationSectionCompletedGames: 'Wedstrijdhistorie',
  migrationLocalLabel: 'lokaal',
  migrationCloudLabel: 'cloud',
  migrationActionCreate: 'wordt aangemaakt',
  migrationActionAlreadyPresent: 'al gelijk aanwezig — geen write nodig',
  migrationActionConflict: 'conflict — cloudversie wijkt af, wordt nooit overschreven',
  migrationTrackingGameTitle: 'Actieve wedstrijd',
  migrationTrackingGameNone: 'Geen actieve wedstrijd op dit apparaat.',
  migrationTrackingGameExcludedTracking:
    "Deze wedstrijd wordt getrackt en gaat NIET mee met deze bulkmigratie. Neem 'm apart over via het overnamescherm bij Wedstrijd (writerclaim), zodat er eerst één geldige schrijver is.",
  migrationTrackingGameNeedsDecision:
    'Deze wedstrijd staat in opzetfase en gaat NIET automatisch mee — dat vereist een aparte beslissing, buiten deze bulkmigratie.',
  migrationRequiredWritesLabel: 'Deze migratie schrijft {n} onderdeel/onderdelen naar de cloud.',
  migrationWarningsTitle: 'Waarschuwingen',
  migrationNextToBackupBtn: 'Volgende: herstelback-up',
  migrationCancelBtn: 'Annuleren',
  migrationBackupTitle: 'Herstelback-up',
  migrationBackupDesc:
    "Download eerst een herstelback-up van je huidige lokale gegevens. Deze is nodig om terug te kunnen vallen — je kunt 'm later gewoon importeren via de back-upfunctie.",
  migrationBackupDownloadBtn: '⬇ Download herstelback-up',
  migrationBackupConfirmLabel: 'Ik heb de herstelback-up gedownload en bewaard',
  migrationBackupNextBtn: 'Volgende: bevestigen',
  migrationConfirmTitle: 'Migratie bevestigen',
  migrationConfirmDesc:
    'Dit voegt {n} onderdeel/onderdelen toe aan de cloud voor {team}. Je lokale gegevens blijven ongewijzigd staan. Dit is geen automatische verwijdering en kan niet met één klik worden teruggedraaid.',
  migrationConfirmBtn: 'Bevestig migratie',
  migrationConfirmInProgress: 'Bezig…',
  migrationBlockedExistingRun:
    'Er loopt al een niet-afgeronde migratie voor dit team. Rond die eerst af of probeer het later opnieuw.',
  migrationRunningTitle: 'Migratie loopt',
  migrationRunningStatus: 'Bezig met schrijven naar de cloud…',
  migrationItemStatusPending: 'wacht',
  migrationItemStatusConfirmed: 'bevestigd',
  migrationItemStatusConflict: 'conflict',
  migrationItemStatusFailed: 'mislukt',
  migrationItemStatusCompensated: 'teruggedraaid',
  migrationItemStatusCompensationFailed: 'terugdraaien mislukt',
  migrationResultCompletedTitle: 'Migratie voltooid',
  migrationResultCompletedDesc:
    'Alle onderdelen zijn bevestigd in de cloud. Je lokale gegevens zijn niet gewijzigd of verwijderd.',
  migrationResultActionNeededTitle: 'Actie nodig',
  migrationResultActionNeededDesc:
    'Niet alles kon worden bevestigd. Gebruik hieronder "Opnieuw proberen" (hervat vanaf het laatste checkpoint) of exporteer de vastzittende onderdelen.',
  migrationResultCompensationFailedTitle: 'Terugdraaien mislukt',
  migrationResultCompensationFailedDesc:
    'Een eerder geschreven onderdeel kon niet worden teruggedraaid. Exporteer de details en probeer het later opnieuw.',
  migrationResultPausedTitle: 'Migratie onderbroken',
  migrationResultPausedDesc:
    'Nog niet alle onderdelen zijn verwerkt. Ga verder met opnieuw proberen.',
  migrationRetryBtn: 'Opnieuw proberen',
  migrationExportBtn: '⬇ Exporteer vastzittende onderdelen',
  migrationCloseBtn: 'Sluiten',

  // PR 8.3b deel 2/2 (docs/pr-8.3-plan.md §C 8.3b werk 4): owner-only
  // organisatie-exportpaneel. Bouwt zelf GEEN nieuwe domeinlogica — roept
  // uitsluitend `OrganizationExportCoordinator.run()` aan en toont de
  // resulterende `OrganizationExportV1`. Alleen zichtbaar voor
  // `canExportOrganization()` (organizationOwner); admin/coach/scorer/viewer
  // krijgen dit blok nooit gerenderd, geen alleen-lezen variant.
  exportTitle: 'Volledige organisatie-export',
  exportDesc:
    'Download een volledige, versieerbare kopie van deze organisatie: alle teams, instellingen, rosters, wedstrijden en ledenlijsten. Dit is een momentopname voor eigen beheer/dataportabiliteit, geen automatische back-up.',
  exportStartBtn: 'Export voorbereiden',
  exportBuilding: 'Organisatiegegevens worden ingelezen…',
  exportErrorGeneric: 'Inlezen is mislukt. Probeer het opnieuw.',
  exportErrorNotFound: 'Deze organisatie is niet gevonden.',
  exportErrorRoundtrip:
    'De export kon niet worden geverifieerd en is daarom niet aangeboden als bestand. Probeer het opnieuw.',
  exportPreviewTitle: 'Export controleren',
  exportPreviewTarget: 'Organisatie: {org} ({id})',
  exportPreviewTeamsTitle: 'Teams in deze export',
  exportPreviewCountsTitle: 'Aantallen',
  exportCountOrganizationMembers: 'Organisatieleden',
  exportCountInvitations: 'Uitnodigingen',
  exportCountTeams: 'Teams',
  exportCountTeamMembers: 'Teamleden',
  exportCountSettingsDocuments: 'Instellingendocumenten',
  exportCountRosterPlayers: 'Spelers',
  exportCountGames: 'Actieve wedstrijden',
  exportCountGameActions: 'Wedstrijdacties',
  exportCountCompletedGames: 'Afgeronde wedstrijden',
  exportCountMigrationRuns: 'Migratieruns',
  exportSensitiveWarningTitle: 'Let op: gevoelige inhoud',
  exportSensitiveWarningDesc:
    'Dit bestand bevat e-mailadressen en overige persoonsgegevens van organisatie- en teamleden. Bewaar en deel het bestand alleen zoals je met andere persoonsgegevens zou omgaan.',
  exportDownloadBtn: '⬇ Download organisatie-export',
  exportDownloadedLabel: 'Export gedownload.',
  exportCloseBtn: 'Sluiten',

  cloudImportPrompt:
    'Kopieer je lokale gegevens eenmalig naar de cloud. De cloud-versie wordt dan leidend; je lokale kopie blijft bewaard.',
  cloudImportButton: 'Eenmalig naar cloud kopiëren',
  cloudImportSuccess: 'Kopiëren naar cloud gelukt.',
  cloudImportError: 'Kopiëren naar cloud mislukt. Probeer het opnieuw.',
  cloudImportAlreadyDone: 'Deze gegevens zijn al naar de cloud gekopieerd.',

  authLoadingTitle: 'Bezig met laden…',
  authEmailLabel: 'E-mailadres',
  authPasswordLabel: 'Wachtwoord',
  authLoginTitle: 'Inloggen',
  authLoginBtn: 'Inloggen',
  authSignupTitle: 'Account aanmaken',
  authSignupBtn: 'Account aanmaken',
  authSwitchToSignupPrompt: 'Nog geen account?',
  authSwitchToSignupBtn: 'Account aanmaken',
  authSwitchToLoginPrompt: 'Al een account?',
  authSwitchToLoginBtn: 'Inloggen',
  authSignOutBtn: 'Uitloggen',
  authInvalidCredentialError: 'Onjuist e-mailadres of wachtwoord.',
  authEmailInUseError: 'Er bestaat al een account voor dit e-mailadres.',
  authWeakPasswordError: 'Kies een wachtwoord van minstens 6 tekens.',
  authInvalidEmailError: 'Vul een geldig e-mailadres in.',
  authGenericError: 'Er ging iets mis. Probeer het opnieuw.',

  trustedDevicePromptTitle: 'Is dit een vertrouwd apparaat?',
  trustedDevicePromptBody:
    'Op een vertrouwd apparaat (bijv. je eigen telefoon of laptop) blijven gegevens lokaal beschikbaar, ook offline. Op een gedeeld apparaat (bijv. een clubtablet) worden je gegevens bij het uitloggen automatisch gewist.',
  trustedDeviceYesBtn: 'Ja, vertrouwd apparaat',
  trustedDeviceNoBtn: 'Nee, gedeeld apparaat',

  trustedDeviceSettingLabel: 'Dit is een vertrouwd apparaat',
  trustedDeviceSettingHint:
    'Zet uit voor een gedeeld apparaat (bijv. een clubtablet) — je gegevens worden dan bij uitloggen automatisch gewist. Uitzetten wist meteen de lokaal opgeslagen gegevens op dit apparaat.',
  trustedDeviceRevokeConfirmTitle: 'Apparaat als gedeeld markeren?',
  trustedDeviceRevokeConfirmBody:
    'Dit wist meteen de lokaal opgeslagen roster-, wedstrijd- en instellingengegevens op dit apparaat. Bij uitloggen gebeurt dat voortaan automatisch.',
  trustedDeviceRevokeConfirmBtn: 'Ja, markeer als gedeeld apparaat',
  trustedDeviceRevokeCancelBtn: 'Annuleren',

  onboardingFreshSignupTitle: 'Welkom! Maak je eerste organisatie aan',
  onboardingFreshSignupBody:
    'Je hebt nog geen organisatie. Maak er hieronder één aan om te beginnen — je wordt automatisch eigenaar.',
  onboardingLostMembershipsTitle: 'Geen toegang tot een organisatie',
  onboardingLostMembershipsBody:
    'Je hebt momenteel geen toegang meer tot een organisatie. Vraag een beheerder om je opnieuw uit te nodigen, of maak hieronder een nieuwe organisatie aan.',
  onboardingOrgNameLabel: 'Naam organisatie',
  onboardingTeamNameLabel: 'Naam eerste team',
  onboardingCreateBtn: 'Organisatie aanmaken',

  contextSwitcherTitle: 'Kies een organisatie en team',
  contextSwitcherSwitchBtn: 'Wissel van organisatie/team',
  contextSwitcherTeamsLoading: 'Teams laden…',
  stateUncachedOfflineTitle: 'Geen verbinding',
  stateUncachedOfflineBody:
    'Er is nog geen lokale kopie van je organisaties op dit apparaat. Ga online om verder te gaan.',
  stateContextRevokedTitle: 'Geen toegang meer',
  stateContextRevokedBody: 'Je toegang tot deze organisatie of dit team is ingetrokken.',
  stateContextRevokedBackBtn: 'Terug naar organisatie-overzicht',

  authVerifyEmailTitle: 'Bevestig je e-mailadres',
  authVerifyEmailBody:
    'We hebben een bevestigingslink naar je e-mailadres gestuurd. Bevestig je e-mailadres om deze uitnodiging te accepteren.',
  authResendVerificationBtn: 'Verificatiemail opnieuw versturen',
  authResendVerificationSuccess: 'Verificatiemail verstuurd. Controleer je inbox.',
  authResendVerificationError:
    'Versturen van de verificatiemail is mislukt. Probeer het later opnieuw.',

  invitationLoginHint:
    'Log in of maak een account aan met het e-mailadres waarop je bent uitgenodigd.',
  invitationNotFoundTitle: 'Uitnodiging niet gevonden',
  invitationNotFoundBody:
    'Deze uitnodiging bestaat niet (meer), of je hebt er geen toegang toe met dit account.',
  invitationRevokedTitle: 'Uitnodiging ingetrokken',
  invitationRevokedBody:
    'Deze uitnodiging is ingetrokken. Vraag de beheerder om een nieuwe uitnodiging.',
  invitationAcceptTitle: 'Uitnodiging accepteren',
  invitationPendingBody: 'Je bent uitgenodigd met rol:',
  invitationAcceptBtn: 'Uitnodiging accepteren',
  invitationClaimTitle: 'Lidmaatschap voltooien',
  invitationAcceptedBody:
    'Uitnodiging geaccepteerd. Voltooi je lidmaatschap om toegang te krijgen.',
  invitationClaimBtn: 'Lidmaatschap voltooien',
  invitationAlreadyClaimedTitle: 'Al voltooid',
  invitationAlreadyClaimedBody: 'Deze uitnodiging is al gebruikt. Log in om toegang te krijgen.',
  invitationDismissBtn: 'Doorgaan',

  syncStatusLocal: 'Lokaal beschikbaar',
  syncStatusPending: 'Wacht op synchronisatie',
  syncStatusSynced: 'Gesynchroniseerd',
  syncStatusActionNeeded: 'Actie nodig',
  syncStatusFromCache: 'uit cache',
  lastModifiedLabel: 'Laatst gewijzigd',
  actionNeededTitle: 'Actie nodig',
  actionNeededRetryBtn: 'Opnieuw proberen',
  actionNeededDismissBtn: 'Negeren',
  actionNeededExportBtn: 'Exporteren',

  // PR 5.4a: rol-grens in de UI. Getoond door SettingsPanel/RosterPanel wanneer
  // canWrite=false (scorer/viewer, of een cloud-fail-open default). Bewust kort:
  // de disabled-knoppen + deze mededeling zijn het hele signaal.
  settingsReadOnly: 'Alleen-lezen — je rol geeft geen bewerkrechten voor deze gegevens.',
  rosterReadOnly: 'Alleen-lezen — je rol geeft geen bewerkrechten voor deze gegevens.',
  // Niet-blokkerende indicator wanneer een settings-/roster-listener na de
  // initiële load faalt. De data blijft de laatst geziene waarde; de
  // gebruiker kan handmatig refreshen.
  listenerErrorIndicator: 'Verbinding met cloud weggevallen',

  // 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 3): update-beschikbaar-banner —
  // eigen, aparte UI-locatie (zie ui/pwa/PwaUpdateBanner.tsx), niet via
  // actionNeeded*.
  pwaUpdateAvailable: 'Er is een nieuwe versie beschikbaar. Wordt zo automatisch bijgewerkt.',
  pwaUpdateAvailableLocked:
    'Er is een nieuwe versie beschikbaar. Bijwerken wacht tot de wedstrijd is afgerond.',
  pwaUpdateReloading: 'Wordt bijgewerkt…',
  pwaUpdateConfirmBtn: 'Nu bijwerken',
  // Herstelbaar foutscenario (mislukte SW-install/blijvend uitblijvende
  // controllerchange) — zie ui/sync/PwaActionNeededPanel.tsx.
  pwaActionNeededTitle: 'Update mislukt',
  pwaActionNeededMessage:
    'Bijwerken van de app is niet gelukt. Je kunt gewoon doorgaan met de huidige versie.',

  // PR 8.3c-1c: owner-only verwijderverzoek, opruimoverzicht en melding voor alle leden (NL).
  deletionTitle: 'Organisatie verwijderen',
  deletionDesc:
    'Vraag verwijdering van deze organisatie aan. Dit is geen directe verwijdering: de organisatie wordt handmatig door de beheerder verwijderd, ten vroegste na een wachttijd van 7 dagen waarin je kunt annuleren.',
  deletionStartBtn: 'Verwijdering bekijken',
  deletionLoading: 'Organisatie wordt gecontroleerd…',
  deletionCloseBtn: 'Sluiten',
  deletionErrorGeneric: 'Controleren is mislukt. Probeer het opnieuw.',
  deletionErrorNotFound: 'Deze organisatie is niet gevonden.',
  deletionErrorDenied: 'Alleen de eigenaar van de organisatie kan verwijdering aanvragen.',
  deletionErrorRoundtrip:
    'De export kon niet worden geverifieerd, dus er is geen verzoek ingediend. Probeer het opnieuw.',
  deletionBlockersTitle: 'Verwijdering is nu niet mogelijk',
  deletionBlockerRecentGame:
    'Team {team}: wedstrijd {game} is de afgelopen 24 uur gebruikt. Rond de wedstrijd af en wacht tot er 24 uur geen activiteit is geweest.',
  deletionBlockerMigrationRun:
    'Team {team}: migratierun {run} is niet afgerond. Rond de migratie af, of vraag de beheerder om hulp.',
  deletionStaleTitle: 'Onafgeronde wedstrijden',
  deletionStaleDesc:
    'Onafgeronde wedstrijden zonder recente activiteit: {count}. Ze worden met de organisatie verwijderd (ze staan wel in de export).',
  deletionStaleAck: 'Ik weet dat deze onafgeronde wedstrijden mee verwijderd worden.',
  deletionNeedsAck: 'Bevestig eerst dat de onafgeronde wedstrijden mee verwijderd mogen worden.',
  deletionTeamOnlyNote:
    'Aantal leden dat alleen via een team toegang heeft: {count}. Zij zien de melding over deze verwijdering niet; informeer hen zelf.',
  deletionCleanupTitle: 'Opruimoverzicht',
  deletionCleanupDesc:
    'Wat volgens de bewaartermijnen opgeruimd kan worden. Alleen aantallen; er wordt niets automatisch verwijderd.',
  deletionCleanupTombstones: 'Verwijderde wedstrijden ouder dan 90 dagen (te wissen)',
  deletionCleanupInvitationsPending: 'Verlopen uitnodigingen (ouder dan 30 dagen)',
  deletionCleanupInvitationsAccepted:
    'Vastgelopen geaccepteerde uitnodigingen (ouder dan 30 dagen)',
  deletionCleanupInvitationsClaimed: 'Gebruikte uitnodigingen (ouder dan 30 dagen)',
  deletionCleanupInvitationsRevoked: 'Ingetrokken uitnodigingen (ouder dan 30 dagen)',
  deletionCleanupAbandonedGames: 'Verlaten onafgeronde wedstrijden (ouder dan 180 dagen)',
  deletionCleanupMigrationRuns: 'Afgeronde migratieruns ouder dan 90 dagen',
  deletionRequestBtn: 'Verwijderverzoek indienen…',
  deletionConfirmTitle: 'Verwijdering aanvragen?',
  deletionConfirmDesc:
    'Er wordt een volledige export van deze organisatie gemaakt en een verwijderverzoek ingediend. De beheerder verwijdert de organisatie handmatig, ten vroegste na 7 dagen. Tot dan kun je annuleren. Verwijderen kan niet ongedaan worden gemaakt.',
  deletionConfirmTypeLabel: 'Typ de naam van de organisatie ter bevestiging: {org}',
  deletionConfirmBtn: 'Verwijdering aanvragen',
  deletionConfirmInProgress: 'Bezig…',
  deletionConfirmBackBtn: 'Terug',
  deletionStatusRequested:
    'Verwijderverzoek ingediend op {date}. De organisatie wordt handmatig door de beheerder verwijderd. Je krijgt hier de uitvoeringsstatus te zien.',
  deletionStatusExecuting:
    'De beheerder is bezig met het verwijderen van deze organisatie (verzoek van {date}).',
  deletionStatusFailed:
    'Het verwijderen is onderbroken en wordt door de beheerder hervat (verzoek van {date}). De organisatie is nog niet verwijderd.',
  deletionStatusCompleted: 'Dit verwijderverzoek is afgerond.',
  deletionStatusCancelled:
    'Het vorige verwijderverzoek is geannuleerd. Je kunt opnieuw een verzoek indienen.',
  deletionCancelRequestBtn: 'Verzoek annuleren…',
  deletionCancelTitle: 'Verwijderverzoek annuleren?',
  deletionCancelDesc: 'De organisatie blijft bestaan. Je kunt later opnieuw een verzoek indienen.',
  deletionCancelConfirmBtn: 'Verzoek annuleren',
  deletionSubmittedTitle: 'Verzoek ingediend',
  deletionExportDownloadBtn: 'Export downloaden',
  deletionExportDownloadedLabel: 'Export gedownload.',
  deletionExportOnlyNow:
    'Download het bestand nu: het is alleen op dit scherm beschikbaar. Je kunt later altijd een nieuwe export maken met Volledige organisatie-export.',
  deletionExportSensitive:
    'De export bevat e-mailadressen van leden en spelersgegevens. Bewaar het bestand veilig.',
  deletionErrorClockBehind:
    'De klok van dit apparaat loopt achter op het vorige verzoek. Controleer de tijd van je apparaat en probeer het opnieuw.',
  deletionErrorRejected:
    'Het verzoek is geweigerd. Mogelijk is je rol gewijzigd of is het verzoek al bijgewerkt. De status is opnieuw opgehaald; probeer het zo nodig nogmaals.',
  deletionErrorTimeout:
    'Geen antwoord van de server. Het verzoek kan alsnog worden verwerkt; controleer de status hieronder.',
  deletionErrorReadback:
    'Het verzoek is verstuurd maar kon niet worden teruggelezen. De status is opnieuw opgehaald; controleer hem hieronder.',
  deletionErrorNotSignedIn: 'Je bent niet ingelogd. Log opnieuw in.',
  deletionAlreadyOpen: 'Er is al een verwijderverzoek. De status is bijgewerkt.',
  deletionBannerRequested:
    'Let op: de verwijdering van deze organisatie is aangevraagd op {date}. De organisatie wordt door de beheerder verwijderd.',
  deletionBannerExecuting: 'Let op: deze organisatie wordt op dit moment verwijderd.',
  deletionBannerFailed:
    'Let op: het verwijderen van deze organisatie is aangevraagd en nog niet afgerond.',

  // PR 8.3c-2c-i: organisatie verlaten en account verwijderen (docs/pr-8.3c-2c-plan.md §3).
  accountPanelTitle: 'Account en lidmaatschap',
  accountActionBusy: 'Er loopt al een accountactie. Wacht tot die klaar is en probeer het opnieuw.',
  accountNothingChanged: 'Er is niets gewijzigd.',
  accountCloseBtn: 'Sluiten',
  accountBackBtn: 'Terug',
  accountRetryBtn: 'Opnieuw proberen',
  accountStageTeamMembers: 'Gestopt bij: je teamtoegang verwijderen.',
  accountStageInvitations: 'Gestopt bij: je uitnodigingen verwijderen.',
  accountStagePerOrgCheck: 'Gestopt bij: de controle per organisatie.',
  accountStageOrganizationMember: 'Gestopt bij: je lidmaatschap verwijderen.',
  accountStageFinalCheck: 'Gestopt bij: de eindcontrole.',
  accountStageFinalGate: 'Gestopt bij: de laatste controle vóór het verwijderen van je account.',
  accountStepErrorRejected: 'De server weigerde een stap; mogelijk is je rol intussen gewijzigd.',
  accountStepErrorTimeout: 'De server antwoordde niet op tijd.',
  accountStepErrorOffline: 'De verbinding met de server viel weg.',
  accountStepErrorNotSignedIn: 'Je bent niet meer ingelogd.',
  accountStepErrorFailed: 'Er ging iets mis bij de server.',
  accountStepErrorReadFailed: 'Je gegevens konden niet worden gelezen.',
  accountStepErrorEmailNotVerified: 'Je e-mailadres is niet bevestigd.',

  leaveOrgDesc:
    'Verlaat {org} als je er niet meer bij hoort. Je verliest dan op al je apparaten de toegang tot de teams van deze organisatie.',
  leaveOrgStartBtn: 'Organisatie verlaten…',
  leaveOrgOwnerNote:
    'Als eigenaar kun je {org} niet zelf verlaten. Draag eerst het eigendom over met "Eigendom overdragen…" hieronder: het andere lid wordt mede-eigenaar en verwijdert jou daarna. Of vraag verwijdering van de organisatie aan.',
  leaveOrgConfirmTitle: 'Organisatie {org} verlaten?',
  leaveOrgConfirmDesc:
    'Je lidmaatschap, je toegang tot de teams en je openstaande uitnodigingen voor deze organisatie worden verwijderd. Wedstrijden die op dit apparaat staan, blijven staan. Terugkomen kan alleen met een nieuwe uitnodiging.',
  leaveOrgConfirmBtn: 'Organisatie verlaten',
  leaveOrgInProgress: 'Bezig met verlaten…',
  leaveOrgOk: 'Je hebt {org} verlaten.',
  leaveOrgOkInvitationsUnchecked:
    'Je e-mailadres is niet bevestigd, daarom konden je uitnodigingen voor deze organisatie niet worden gecontroleerd. Een openstaande uitnodiging kan nog bestaan; vraag een eigenaar of beheerder die in te trekken.',
  leaveOrgOkDeletionPending: 'Voor deze organisatie loopt een verwijderverzoek.',
  leaveOrgNotSignedIn: 'Je bent niet (meer) ingelogd. Log opnieuw in en probeer het nog eens.',
  leaveOrgOffline:
    'Geen verbinding met de server. Verlaten kan alleen online; probeer het opnieuw zodra je verbinding hebt.',
  leaveOrgFailedTimeout: 'De server antwoordde niet op tijd. Probeer het opnieuw.',
  leaveOrgFailedRead: 'Je lidmaatschap kon niet worden gecontroleerd. Probeer het later opnieuw.',
  leaveOrgNotAMember: 'Je bent geen lid (meer) van deze organisatie.',
  leaveOrgDeniedOwnerSole:
    'Je bent de enige eigenaar van deze organisatie en kunt haar daarom niet verlaten. Draag eerst het eigendom over met "Eigendom overdragen…", of vraag verwijdering van de organisatie aan.',
  leaveOrgDeniedOwnerAwaitingRemoval:
    'Je bent eigenaar en kunt je eigen lidmaatschap niet verwijderen. Dit wacht op bevestiging door de nieuwe eigenaar: een andere eigenaar (aantal: {count}) moet jou verwijderen via "Andere eigenaar verwijderen…".',
  leaveOrgDeniedCreatorNeedsOwner:
    'Jij hebt deze organisatie aangemaakt. Daarom kun je niet zelf vertrekken: vraag een eigenaar of beheerder om je lidmaatschap te verwijderen.',
  leaveOrgDeniedUnsupported:
    'Bij deze organisatie ontbreken gegevens die nodig zijn om te vertrekken. Vraag een eigenaar om je lidmaatschap te verwijderen, of neem contact op met de beheerder van de app.',
  leaveOrgDeniedMissing:
    'Deze organisatie bestaat niet meer, maar je lidmaatschap nog wel. Neem contact op met de beheerder van de app.',
  leaveOrgDeniedAwaitingDeletion:
    'Er loopt een verwijderverzoek voor deze organisatie. Als eigenaar wacht je tot dat is uitgevoerd.',
  leaveOrgDeniedDeletionFailed:
    'Het verwijderen van deze organisatie is vastgelopen. Neem contact op met de beheerder van de app.',
  leaveOrgBlockedLocalWork:
    'Op dit apparaat staat wedstrijdwerk voor deze organisatie dat nog niet met de server is gesynchroniseerd (aantal: {count}). Rond dat eerst af en laat het synchroniseren; anders gaat het verloren.',
  leaveOrgIncomplete:
    'Verlaten is niet helemaal gelukt; je bent mogelijk nog lid. Probeer het opnieuw: het gaat verder waar het bleef.',

  accountDeleteDesc:
    'Verwijder je account met al je lidmaatschappen en uitnodigingen in de cloud. Wedstrijden en instellingen die alleen op dit apparaat staan, blijven staan.',
  accountDeleteStartBtn: 'Account verwijderen…',
  accountDeleteNoOrgHint: 'Wil je dit account niet meer gebruiken? Je kunt het hier verwijderen.',
  accountDeleteTitle: 'Account verwijderen',
  accountDeleteChecking: 'Je account wordt gecontroleerd…',
  accountDeletePlanIntro: 'Dit gebeurt per organisatie:',
  accountDeleteClassLeave: 'Je verlaat deze organisatie.',
  accountDeleteClassLeaveTeamOnly: 'Je teamtoegang in deze organisatie wordt verwijderd.',
  accountDeleteClassInvitationsOnly: 'Je uitnodigingen voor deze organisatie worden verwijderd.',
  accountDeleteClassOwnerSole:
    'Geblokkeerd: je bent de enige eigenaar. Draag eerst het eigendom over met "Eigendom overdragen…", of vraag verwijdering van de organisatie aan.',
  accountDeleteClassOwnerAwaitingRemoval:
    'Geblokkeerd: je bent eigenaar en wacht op bevestiging door de nieuwe eigenaar. Een andere eigenaar (aantal: {count}) moet jou verwijderen via "Andere eigenaar verwijderen…".',
  accountDeleteClassCreatorNeedsOwner:
    'Geblokkeerd: jij hebt deze organisatie aangemaakt. Een eigenaar of beheerder moet je lidmaatschap verwijderen.',
  accountDeleteClassAwaitingDeletion:
    'Geblokkeerd: er loopt een verwijderverzoek voor deze organisatie. Wacht tot het is uitgevoerd.',
  accountDeleteClassDeletionFailed:
    'Geblokkeerd: het verwijderen van deze organisatie is vastgelopen. Neem contact op met de beheerder van de app.',
  accountDeleteClassUnsupported:
    'Geblokkeerd: bij deze organisatie ontbreken gegevens. Vraag een eigenaar om je lidmaatschap te verwijderen.',
  accountDeleteClassMissing:
    'Geblokkeerd: deze organisatie bestaat niet meer, maar je lidmaatschap nog wel. Neem contact op met de beheerder van de app.',
  accountDeleteClassLocalWork:
    'Geblokkeerd: op dit apparaat staat wedstrijdwerk dat nog niet is gesynchroniseerd (aantal: {count}). Rond dat eerst af en laat het synchroniseren.',
  accountDeleteInvitations: 'Uitnodigingen op je e-mailadres die worden verwijderd: {count}',
  accountDeleteBlockedTitle:
    'Je account kan nog niet worden verwijderd. Los eerst de geblokkeerde punten op; er is niets gewijzigd.',
  accountDeletePlanChanged: 'De situatie is intussen veranderd. Het plan is bijgewerkt.',
  accountDeleteReadyIntro:
    'Daarna wordt je account zelf verwijderd. Dit kan niet ongedaan worden gemaakt.',
  accountDeleteAuthOnly:
    'Er staan geen lidmaatschappen of uitnodigingen meer van je in de cloud; alleen je account bestaat nog. Je kunt het nu verwijderen.',
  accountDeleteContinueBtn: 'Doorgaan',
  accountDeleteRecheckBtn: 'Opnieuw controleren',
  accountDeletePasswordTitle: 'Bevestig met je wachtwoord',
  accountDeletePasswordDesc:
    'Voer je wachtwoord in om je account definitief te verwijderen. Dit kan niet ongedaan worden gemaakt.',
  accountDeletePasswordLabel: 'Wachtwoord',
  accountDeleteConfirmBtn: 'Account definitief verwijderen',
  accountDeleteInProgress: 'Bezig met verwijderen…',
  accountDeleteWrongPassword: 'Het wachtwoord klopt niet. Probeer het opnieuw.',
  accountDeleteTooManyRequests: 'Te veel pogingen. Wacht even en probeer het later opnieuw.',
  accountDeleteReauthNetwork:
    'Geen verbinding bij het controleren van je wachtwoord. Probeer het opnieuw zodra je verbinding hebt.',
  accountDeleteReauthOther: 'Je wachtwoord kon niet worden gecontroleerd. Probeer het opnieuw.',
  accountDeleteNotSignedIn: 'Je bent niet (meer) ingelogd. Log opnieuw in en probeer het nog eens.',
  accountDeleteEmailNotVerified:
    'Bevestig eerst je e-mailadres. Zonder bevestigd adres kunnen je uitnodigingen niet worden gecontroleerd. Open de link in je e-mail en controleer daarna opnieuw.',
  accountDeleteResendVerificationBtn: 'Bevestigingsmail opnieuw sturen',
  accountDeleteVerificationSent: 'De bevestigingsmail is verstuurd.',
  accountDeleteVerificationFailed: 'De bevestigingsmail kon niet worden verstuurd.',
  accountDeleteOffline:
    'Geen verbinding met de server. Account verwijderen kan alleen online; probeer het opnieuw zodra je verbinding hebt.',
  accountDeleteFailedTimeout: 'De server antwoordde niet op tijd. Probeer het opnieuw.',
  accountDeleteFailedRead:
    'Je gegevens konden niet worden gecontroleerd. Probeer het later opnieuw.',
  accountDeleteAuthStateUnknown:
    'Het is niet zeker of je account is verwijderd. Log opnieuw in: lukt dat niet meer, dan is je account verwijderd; lukt het wel, start dan opnieuw.',
  accountDeleteIncomplete:
    'Het opruimen is niet helemaal gelukt. Je account bestaat nog. Probeer het opnieuw: het gaat verder waar het bleef.',
  accountDeleteIncompleteFinalGate:
    'Bij de laatste controle stonden er nog gegevens van je in de cloud (lidmaatschappen: {members}, teamtoegang: {teams}, uitnodigingen: {invitations}). Misschien ben je net opnieuw uitgenodigd. Je account bestaat nog; controleer opnieuw.',
  accountDeleteClearedAuthPresent:
    'Je lidmaatschappen en uitnodigingen in de cloud zijn verwijderd, maar je account bestaat nog. Probeer het opnieuw om je account te verwijderen.',
  accountDeleteReasonRecentLogin: 'Firebase vraagt om een recentere aanmelding.',
  accountDeleteReasonNetwork: 'De verbinding viel weg.',
  accountDeleteReasonOther: 'De server gaf een onverwachte fout.',
  accountDeleteDeleted:
    'Je account is verwijderd. De clouddata in de cache van deze browser is gewist. Gegevens die alleen op dit apparaat stonden, zoals lokale wedstrijden en instellingen, zijn niet gewist.',
  accountDeleteLocalWipeFailed:
    'De clouddata in de cache van deze browser kon niet volledig worden gewist. Wis de browsergegevens als je dit apparaat met anderen deelt.',
  onboardingResumeExpired:
    'De organisatie die je eerder begon aan te maken, kan niet meer worden afgerond. Klik opnieuw op "Organisatie aanmaken" om een nieuwe organisatie aan te maken.',
  accountOrganizationNameUnknown: 'Organisatie (naam onbekend)',
  transferStartBtn: 'Eigendom overdragen…',
  transferRemoveOwnerStartBtn: 'Andere eigenaar verwijderen…',
  transferPanelDesc:
    'Draag het eigendom van {org} over aan een ander lid. Dat lid wordt mede-eigenaar en rondt de overdracht zelf af door jou als eigenaar te verwijderen. Dit kan alleen online.',
  transferRemoveOwnerDesc:
    'Heeft een andere eigenaar het eigendom aan jou overgedragen? Rond de overdracht dan af door die eigenaar te verwijderen. Dit kan alleen online.',
  transferPromoteTitle: 'Eigendom van {org} overdragen',
  transferRemoveOwnerTitle: 'Andere eigenaar van {org} verwijderen',
  transferLoading: 'De leden worden van de server gelezen…',
  transferChooseIntro: 'Kies wie mede-eigenaar wordt:',
  transferRemoveOwnerChooseIntro: 'Kies welke andere eigenaar je verwijdert:',
  transferNoCandidates:
    'Er is geen ander lid om het eigendom aan over te dragen. Nodig eerst iemand uit voor deze organisatie.',
  transferNoOtherOwners: 'Er is geen andere eigenaar in deze organisatie.',
  transferMemberNoEmail: 'Lid zonder bekend e-mailadres',
  transferRoleOwner: 'Eigenaar',
  transferRoleAdmin: 'Beheerder',
  transferRoleCoach: 'Coach',
  transferRoleScorer: 'Scorer',
  transferRoleViewer: 'Meekijker',
  transferPromoteConfirmDesc:
    '{member} wordt mede-eigenaar van {org} en krijgt alle rechten van een eigenaar, ook het recht om jou daarna als eigenaar te verwijderen via "Andere eigenaar verwijderen…". Jij blijft eigenaar tot {member} dat doet. Tot dan kun je {org} niet verlaten en je account niet verwijderen.',
  transferPromoteConfirmBtn: 'Mede-eigenaar maken',
  transferPromoteInProgress: 'Bezig met overdragen…',
  transferRemoveOwnerConfirmDesc:
    'Je verwijdert {member} als eigenaar uit {org}: de openstaande uitnodigingen van {member} worden ingetrokken en de teamtoegang en het lidmaatschap verwijderd. Doe dit alleen als {member} het eigendom aan jou wil overdragen of jullie dit hebben afgesproken. Dit kan niet ongedaan worden gemaakt; terugkomen kan alleen met een nieuwe uitnodiging.',
  transferRemoveOwnerTypeLabel: 'Typ het e-mailadres {member} om te bevestigen',
  transferRemoveOwnerMismatch: 'Dit komt niet overeen met het e-mailadres van de gekozen eigenaar.',
  transferRemoveOwnerConfirmBtn: 'Eigenaar verwijderen',
  transferRemoveOwnerInProgress: 'Bezig met verwijderen…',
  transferBackToListBtn: 'Terug naar de lijst',
  transferNotSignedIn: 'Je bent niet (meer) ingelogd. Log opnieuw in en probeer het nog eens.',
  transferOffline:
    'Geen verbinding met de server. Eigendom overdragen kan alleen online; probeer het opnieuw zodra je verbinding hebt. Wedstrijden op dit apparaat kun je gewoon blijven bijhouden.',
  transferFailedRead:
    'De leden van deze organisatie konden niet worden gelezen. Probeer het later opnieuw.',
  transferFailedTimeout: 'De server antwoordde niet op tijd. Probeer het opnieuw.',
  transferDeniedNotAMember: 'Je bent geen lid (meer) van deze organisatie.',
  transferDeniedNotOwner:
    'Volgens de server ben je geen eigenaar (meer) van deze organisatie. Alleen een eigenaar kan het eigendom overdragen of een andere eigenaar verwijderen.',
  transferDeniedSelf: 'Je kunt jezelf hier niet kiezen.',
  transferDeniedTargetNotOwner:
    '{member} is geen eigenaar (meer). Hier kan alleen een andere eigenaar worden verwijderd.',
  transferPromoteOk: '{member} is nu mede-eigenaar van {org}.',
  transferPromoteAlreadyOwner: '{member} was al eigenaar van {org}.',
  transferPromoteAwaiting:
    'Wacht op bevestiging door de nieuwe eigenaar: {member} moet zelf inloggen en jou via "Andere eigenaar verwijderen…" als eigenaar verwijderen. Pas dan is de overdracht af. Tot die tijd blijf jij eigenaar en kun je {org} niet verlaten of je account verwijderen.',
  transferPromoteNotFound: '{member} is geen lid meer van deze organisatie.',
  transferRejectedTargetChanged:
    'De rol van {member} is intussen gewijzigd; de actie is gestopt. Open de lijst opnieuw.',
  transferRejectedPermission:
    'De server weigerde de wijziging. Mogelijk ben je zelf geen eigenaar meer, bijvoorbeeld omdat een andere eigenaar jou tegelijk verwijderde.',
  transferPromoteTimeout:
    'De server antwoordde niet op tijd. De promotie van {member} kan later alsnog doorkomen. Probeer het opnieuw: dat controleert eerst de actuele stand.',
  transferPromoteFailedWrite:
    'De promotie van {member} is mogelijk niet gelukt. Probeer het opnieuw: dat controleert eerst de actuele stand.',
  transferCompleteOk: '{member} is verwijderd als eigenaar van {org}. De overdracht is afgerond.',
  transferCompleteCounts:
    'Ingetrokken uitnodigingen: {invitations}. Verwijderde teamtoegang: {teams}.',
  transferCompleteSkippedMalformed:
    'Uitnodigingen in deze organisatie zonder leesbaar e-mailadres of met een onbekende status, overgeslagen: {count}. Niemand kan ze accepteren; laat ze door de beheerder van de app opruimen.',
  transferCompleteAlreadyGone: 'Het lidmaatschap van {member} was al verwijderd.',
  transferCompleteNotFound:
    '{member} is geen lid meer van deze organisatie: de overdracht is al afgerond. Er is niets gewijzigd.',
  transferCompletePartial:
    'Er kunnen al uitnodigingen van {member} zijn ingetrokken of teamtoegang zijn verwijderd; dat wordt niet teruggedraaid. Het lidmaatschap van {member} staat nog.',
  transferCompleteIncomplete:
    'Het verwijderen van {member} is niet helemaal gelukt; {member} is mogelijk nog eigenaar. Probeer het opnieuw: het gaat verder waar het bleef.',
  transferStageInvitations:
    'Gestopt bij: het intrekken van de openstaande uitnodigingen van de andere eigenaar.',
  transferStageTeamMembers:
    'Gestopt bij: het verwijderen van de teamtoegang van de andere eigenaar.',
  transferStagePreRemovalCheck:
    'Gestopt bij: de controle vóór het verwijderen van het lidmaatschap.',
  transferStageOrganizationMember:
    'Gestopt bij: het verwijderen van het lidmaatschap van de andere eigenaar.',
  transferStageFinalCheck: 'Gestopt bij: de eindcontrole.',
  transferStepErrorRoleChanged: 'De rol was intussen gewijzigd.',
  transferStepErrorNotFound: 'Het lid werd niet (meer) gevonden.',
  transferStepErrorSelf: 'Het doel was je eigen account.',
} as const;

const en = {
  switchToEn: 'Switch to English',
  switchToNl: 'Switch to Dutch',

  appNameFallback: 'Lineup Tracker',
  settingsTitle: 'Settings',
  settingsOpen: '⚙ Settings',
  settingsSectionClub: 'Club',
  settingsSectionMatch: 'Match',
  settingsSectionClass: 'Classification',
  teamNameLabel: 'Team name',
  logoLabel: 'Logo',
  logoChooseBtn: 'Choose logo',
  logoRemoveBtn: 'Remove logo',
  primaryColorLabel: 'Primary color',
  accentColorLabel: 'Accent color (opponent)',
  quarterCountLabel: 'Number of periods',
  quarterLabel: 'Quarter',
  periodLabelLabel: 'Period name',
  useClassLimitLabel: 'Use classification system',
  toggleTag1Default: 'Category 1',
  tag1LabelLabel: 'Category 1 label',
  tag1LabelHint: 'e.g. Female',
  toggleTag2Default: 'Category 2',
  tag2LabelLabel: 'Category 2 label',
  tag2LabelHint: 'e.g. Youth/U19',
  classBaseLimitSettingLabel: 'Base classification (default value)',
  maxBonusLabel: 'Max bonus',
  bonusTag1OnlyLabel: 'Bonus for category 1',
  bonusTag2OnlyLabel: 'Bonus for category 2',
  bonusBothLabel: 'Bonus for both categories',
  classLimitExplain:
    'This system caps the total classification of the 5 players on court, with a bonus for two optional categories - originally conceived as category 1 = Female and category 2 = Youth/U19, to encourage mixed and young lineups. You can adjust the labels and bonus values below as you like.',
  customColorBtn: 'Custom',
  saveBtn: 'Save',
  settingsResetBtn: 'Reset to defaults',
  logoTooLargeError: 'Logo is too large (max 500 KB). Choose a smaller image.',
  settingsSaveError: "Saving failed. Check your browser's storage space.",
  saveSuccessMessage: 'Saved ✓',

  rosterTitle: 'Team',
  rosterIntro:
    'Manage your player roster here: shirt number, name and — if you use the classification system (settings) — a classification value and categories.',
  playerNrLabel: 'Shirt number',
  playerNameLabel: 'Name',
  playerClassLabel: 'Class',
  addPlayerBtn: '+ Add player',
  removePlayerBtn: 'Remove',
  confirmDeletePlayer: 'Permanently delete this player? This cannot be undone.',
  dupNumberWarningLabel: '⚠ Duplicate shirt number:',
  rosterSaveError: "Saving failed. Check your browser's storage space.",

  gameTitle: 'Game',
  preGameIntro:
    "Choose who's playing and who starts. Edit player details (name, shirt number, classification) on the Roster tab.",
  noPlayersYet: 'No players yet. Add them on the Roster tab.',
  goToTeamBtn: 'Go to Roster →',
  participateToggle: 'Play',
  toggleStart: 'Start',
  noStarters: 'No starters chosen — the 5 lowest shirt numbers start automatically.',
  startersChosenSuffix: 'chosen as starter',
  teamOpponent: 'Opponent',
  opponentPlaceholder: 'Optional',
  competitionLabel: 'Competition/tournament',
  competitionPlaceholder: 'Optional',
  classLimitLabel: 'Base classification',
  classLimitHint: '(base + bonus)',
  clockDownLabel: 'Game clock counts down',
  clockDownHint: '(10:00 → 0:00)',
  startNeedFive: 'At least 5 named players needed',
  startFixDup: 'Fix duplicate shirt numbers',
  startNeedFiveParticipating: 'At least 5 participating players needed',
  startChooseFive: 'Choose exactly 5 starters (or 0 for automatic)',
  startGameBtn: 'Start match',
  gameSaveError: "Saving failed. Check your browser's storage space.",
  gameReadOnly: 'Read-only',
  claimPendingBtn: 'Claiming match…',
  claimBlockedOffline: "No connection — can't claim the match before you start.",
  claimBlockedAlreadyClaimed: 'This match is already being scored on another device.',
  claimBlockedStaleRevision: 'The match was just changed. Try again.',
  claimBlockedRoleDenied: "You don't have permission to claim this match.",
  claimBlockedGameCompleted: 'This match has already been finished.',
  claimBlockedUnknown: 'Claiming failed. Try again.',
  claimRetryBtn: 'Try again',
  pwaReadinessUnsupported: 'No offline support detected on this device. Local-only use works fine.',
  pwaReadinessRegistering: 'The app is still getting ready for offline use. Try again shortly.',
  pwaReadinessUpdatePending: 'An update is ready. Consider updating before the game starts.',
  pwaReadinessBroken: 'Offline use is not guaranteed on this device. Try again before starting.',
  contextSwitchLockedWhileTracking:
    "You can't switch teams while a match is in progress. Finish the match first.",
  contextSwitchLockedDismiss: 'OK',
  viewerActiveScorerNotice:
    'Read-only: another device is scoring this match right now. Your controls are disabled.',
  viewerFreshnessServer: 'live',
  viewerFreshnessCache: 'from cache, may be out of date',
  viewerFreshnessError: 'connection lost — showing last known state',
  takeoverOpenBtn: 'Take over…',
  takeoverConfirmTitle: 'Take over this match?',
  takeoverConfirmDesc:
    "You become the new scorer for this match. The other device won't be able to save anything from that moment on, until it takes over again itself.",
  takeoverCurrentWriterLabel: 'Current scorer',
  takeoverCurrentWriterUnknown: 'unknown',
  takeoverLastActivityLabel: 'Last server activity',
  takeoverLastActivityUnknown: 'never yet',
  takeoverPendingActionsWarning:
    'This device still has {count} unsynced action(s). After taking over, those will be retried automatically — they are not lost.',
  takeoverConfirmBtn: 'Yes, take over',
  takeoverCancelBtn: 'Cancel',
  takeoverInProgress: 'Taking over…',
  takeoverBlockedOffline: "No connection — can't take over the match right now.",
  takeoverBlockedAlreadyClaimed: 'Another device just took over the match. Try again.',
  takeoverBlockedStaleRevision: 'The match was just changed. Try again.',
  takeoverBlockedRoleDenied: "You don't have permission to take over this match.",
  takeoverBlockedGameCompleted: 'This match has already been finished.',
  takeoverBlockedUnknown: 'Taking over failed. Try again.',
  actionNeededExportGameActionsBtn: 'Export unsynced actions',
  v1MigrationTitle: 'Old active game found',
  v1MigrationDesc:
    'This game was still in progress from before the update. Check that the team below is correct before taking it over.',
  v1MigrationTargetLabel: 'Take over into',
  v1MigrationScoreLabel: 'Current score',
  v1MigrationSwitchHint:
    'Wrong team? Switch teams using the button in the top right first — only confirm here once this team is correct.',
  v1MigrationConfirmBtn: 'Yes, this is the right team — take over',

  teamFallbackLabel: 'Team',
  segmentDeltaLabel: 'segment:',
  correctMinus1Btn: '−1 correct',
  onCourtLabel: 'On court (5)',
  tooManyClassPointsPrefix: '⚠ Too many classification points on court',
  swapChosenSuffix: ' selected — tap a player to swap with.',
  swapHint:
    'Substituting? Tap a player (court or bench), then the other. Multiple substitutions in a row are fine.',
  swapDoneBtn: '✓ Done substituting — clock time',
  cancelBtn: 'Cancel',
  benchLabel: 'Bench',
  segmentCardTitle: 'Record segment',
  beginLabel: 'Start',
  endLabel: 'End',
  minutesUnitLabel: 'minutes',
  secondsUnitLabel: 'seconds',
  scoreSelectLabel: 'Score {team}',
  segDurationValidPrefix: 'Playing time this segment:',
  endAfterBegin: 'End must be after start.',
  saveSegmentBtnPrefix: 'Save segment',
  needFiveOnCourt: 'There must be exactly 5 players on court.',
  segmentsTitlePrefix: 'Segments',
  tapToEdit: 'Tap to edit',
  lineupStandingPrefix: 'This lineup is already',
  swapConfirmTitle: 'Substitution(s) — clock time?',
  swapConfirmDesc:
    'The segment so far will be closed with the lineup from before this/these substitution(s), at the time below. The new segment then continues with the current lineup.',
  timeLabel: 'Time',
  segSoFarPrefix: 'Segment so far:',
  timeAfterSegStart: "Time can't be before the start of this segment.",
  backBtn: 'Back',
  confirmBtn: 'Confirm',
  editSegmentTitle: 'Edit segment',
  lineupChosenSuffix: 'chosen',
  deleteBtn: 'Delete',
  confirmDeleteSegment: 'Delete this segment? The score will be recalculated automatically.',
  pointsForLabel: 'Points for',
  pointsAgainstLabel: 'Points against',
  segDurationPlainPrefix: 'Playing time:',
  lineupLabel: 'Lineup',

  finishGameBtn: 'Finish game',
  confirmFinishGame:
    'Finish this game? This cannot be undone: the game becomes an immutable history entry.',
  historyTitle: 'History',
  historyEmpty: 'No finished games yet.',
  historyCloudReadError:
    "The cloud history couldn't be loaded. Games shown below may be incomplete (local-only); try again later.",
  confirmDeleteGame: 'Permanently delete this game? This cannot be undone.',
  deleteBlockedPendingSync:
    "This game hasn't synced to the cloud yet. Wait for sync to complete and try again.",
  historyDeleteError: 'Deleting failed. Check your connection and try again.',
  historyTombstoneNoticeSingular: '1 finished game was deleted by a teammate on another device.',
  historyTombstoneNoticePlural:
    '{count} finished games were deleted by a teammate on another device.',
  historyTombstoneDismissBtn: 'Dismiss',
  exportShareBtn: 'Export/Share',

  // PR 6.4: Stats-tab. See NL block for rationale; v1 parity.
  statsTitle: 'Stats',
  statsNoData: 'No match data yet. Play and finish a match to see stats here.',
  statsNoCombos: 'No combinations found with this filter.',
  statsReadError: "Couldn't read the match history. Try again later or reload the tab.",
  statsPartialSingular: '1 segment contains unknown player references and was skipped.',
  statsPartialPlural: '{count} segments contain unknown player references and were skipped.',
  statsCurrentGame: 'Current match',
  statsPer10: 'Per 10 min',
  statsGamesBtn: 'Games',
  statsFilterBtn: 'Filter players',
  statsGamesTitle: 'Filter by game',
  statsFilterTitle: 'Filter players',
  statsFilterHint: '✓ = must be on court · ✗ = must be on bench · — = no filter',
  statsComboSizeLabel: 'Players in combination',
  statsSortToggleAsc: 'Sort +/- ↑',
  statsSortToggleDesc: 'Sort +/- ↓',
  statsColTime: 'Time',
  statsColPts: 'Pts',
  statsColOpp: 'Opp',
  statsColOn: 'With them',
  statsColOff: 'Without them',
  statsClearBtn: 'Clear filter',
  statsDoneBtn: 'Done',

  // PR 6.5: Trends tab. See NL block for rationale; v1 parity.
  trendsTitle: 'Trends',
  trendsMinLabel: 'MIN',
  trendsPmLabel: '+/-',
  trendsPmChartLabel: '+/- per game',
  trendsMinChartLabel: 'Minutes per game',
  trendsNoData: 'No match data yet. Play and finish a match to see trends here.',
  trendsSortLabel: 'Sort',
  trendsSortNr: 'No.',
  trendsShowGames: 'Show {n} games',
  trendsHideGames: 'Hide games',
  trendsProvisional: 'Provisional',

  // PR 6.6: backup, import and local migration. See NL block for rationale; v1 parity.
  backupTitle: 'Backup',
  diagnosticsTitle: 'Technical diagnostics',
  diagnosticsDesc:
    'Keeps up to 50 technical status codes in this tab’s memory to help investigate problems.',
  diagnosticsPrivacy:
    'Contains no player data, email addresses, organization, team or game IDs and is never sent automatically.',
  diagnosticsCount: '{count} diagnostic event(s) in this session.',
  diagnosticsDownloadBtn: '⬇ Download diagnostics',
  diagnosticsClearBtn: 'Clear diagnostics',
  backupDesc:
    'Keep a copy of this team (players, settings, match history) — handy for a new device or a cleared browser storage. Older backups from this app remain importable.',
  backupExportBtn: '⬇ Export backup',
  backupImportBtn: '⬆ Import backup',
  importBackupInvalid: "This file doesn't look like a valid Lineup Tracker backup.",
  importBackupInvalidData:
    'The backup contains invalid data: {details}. Your current data was not modified.',
  importBackupInvalidDataAndMore: ' (and {n} more errors)',
  validationNoRecognizableData: 'The backup contains no recognizable data.',
  backupPreviewTitle: 'Review backup',
  backupPreviewTarget: 'Target team: {org} / {team}',
  backupSectionSettings: 'Settings',
  backupSectionRoster: 'Team',
  backupSectionActiveGame: 'Active match',
  backupSectionCompletedGames: 'Match history',
  backupSectionLang: 'Language preference',
  backupEffectReplace: 'will be replaced',
  backupEffectClear: 'will be cleared',
  backupEffectUnchanged: 'stays unchanged',
  backupPreviewNotPresent: 'not present in the backup',
  backupDestinationLocal: 'local',
  backupDestinationCloud: 'cloud',
  backupConfirmBtn: 'Confirm import',
  backupCancelBtn: 'Cancel',
  backupRestoreDownloading:
    'A recovery backup of the current data is downloaded automatically first…',
  backupImportSuccess: 'Import succeeded. The page shows the new data.',
  backupImportFailed:
    'Import failed at "{section}". Previously written parts were rolled back; nothing was left partially changed. The recovery backup just downloaded contains the data from before this attempt.',

  // PR 7.4c: bulk migration UI — mirrors the NL block above key-for-key.
  migrationTitle: 'Move existing local data to the cloud',
  migrationDesc:
    'Copy settings, team and completed games that currently only exist locally on this device to the cloud for this team. Your local data stays unchanged — this is a copy, not a move.',
  migrationStartBtn: 'Prepare migration',
  migrationBuildingPreview: 'Reading local data and cloud status…',
  migrationErrorGeneric: 'Reading failed. Please try again.',
  migrationDeniedCorruptTitle: 'Local data could not be read',
  migrationDeniedCorruptDesc:
    'A problem was found in the local data. Nothing was written to the cloud. Make a backup first (Settings tab) and check the error below.',
  migrationPreviewTitle: 'Review migration',
  migrationPreviewTarget: 'Target team: {org} / {team}',
  migrationSectionSettings: 'Settings',
  migrationSectionRoster: 'Team',
  migrationSectionCompletedGames: 'Match history',
  migrationLocalLabel: 'local',
  migrationCloudLabel: 'cloud',
  migrationActionCreate: 'will be created',
  migrationActionAlreadyPresent: 'already identical — no write needed',
  migrationActionConflict: 'conflict — cloud version differs, never overwritten',
  migrationTrackingGameTitle: 'Active match',
  migrationTrackingGameNone: 'No active match on this device.',
  migrationTrackingGameExcludedTracking:
    'This match is being tracked and is NOT included in this bulk migration. Take it over separately via the match takeover screen (writer claim), so a single valid writer exists first.',
  migrationTrackingGameNeedsDecision:
    'This match is in setup phase and is NOT included automatically — that needs a separate decision outside this bulk migration.',
  migrationRequiredWritesLabel: 'This migration will write {n} item(s) to the cloud.',
  migrationWarningsTitle: 'Warnings',
  migrationNextToBackupBtn: 'Next: recovery backup',
  migrationCancelBtn: 'Cancel',
  migrationBackupTitle: 'Recovery backup',
  migrationBackupDesc:
    'Download a recovery backup of your current local data first. You need this to fall back — you can import it later via the regular backup feature.',
  migrationBackupDownloadBtn: '⬇ Download recovery backup',
  migrationBackupConfirmLabel: 'I downloaded and kept the recovery backup',
  migrationBackupNextBtn: 'Next: confirm',
  migrationConfirmTitle: 'Confirm migration',
  migrationConfirmDesc:
    'This adds {n} item(s) to the cloud for {team}. Your local data stays unchanged. This is not an automatic deletion and cannot be undone with a single click.',
  migrationConfirmBtn: 'Confirm migration',
  migrationConfirmInProgress: 'Working…',
  migrationBlockedExistingRun:
    'A migration for this team is already in progress. Finish it first or try again later.',
  migrationRunningTitle: 'Migration in progress',
  migrationRunningStatus: 'Writing to the cloud…',
  migrationItemStatusPending: 'pending',
  migrationItemStatusConfirmed: 'confirmed',
  migrationItemStatusConflict: 'conflict',
  migrationItemStatusFailed: 'failed',
  migrationItemStatusCompensated: 'rolled back',
  migrationItemStatusCompensationFailed: 'rollback failed',
  migrationResultCompletedTitle: 'Migration completed',
  migrationResultCompletedDesc:
    'All items are confirmed in the cloud. Your local data was not changed or removed.',
  migrationResultActionNeededTitle: 'Action needed',
  migrationResultActionNeededDesc:
    'Not everything could be confirmed. Use "Retry" below (resumes from the last checkpoint) or export the stuck items.',
  migrationResultCompensationFailedTitle: 'Rollback failed',
  migrationResultCompensationFailedDesc:
    'A previously written item could not be rolled back. Export the details and try again later.',
  migrationResultPausedTitle: 'Migration paused',
  migrationResultPausedDesc: 'Not all items have been processed yet. Continue with retry.',
  migrationRetryBtn: 'Retry',
  migrationExportBtn: '⬇ Export stuck items',
  migrationCloseBtn: 'Close',

  // PR 8.3b part 2/2: owner-only organization export panel — mirrors the NL
  // block above key-for-key.
  exportTitle: 'Full organization export',
  exportDesc:
    'Download a complete, versioned copy of this organization: all teams, settings, rosters, matches and member lists. This is a point-in-time snapshot for your own portability/control, not an automatic backup.',
  exportStartBtn: 'Prepare export',
  exportBuilding: 'Reading organization data…',
  exportErrorGeneric: 'Reading failed. Please try again.',
  exportErrorNotFound: 'This organization was not found.',
  exportErrorRoundtrip:
    'The export could not be verified, so no file was offered. Please try again.',
  exportPreviewTitle: 'Review export',
  exportPreviewTarget: 'Organization: {org} ({id})',
  exportPreviewTeamsTitle: 'Teams in this export',
  exportPreviewCountsTitle: 'Counts',
  exportCountOrganizationMembers: 'Organization members',
  exportCountInvitations: 'Invitations',
  exportCountTeams: 'Teams',
  exportCountTeamMembers: 'Team members',
  exportCountSettingsDocuments: 'Settings documents',
  exportCountRosterPlayers: 'Players',
  exportCountGames: 'Active matches',
  exportCountGameActions: 'Match actions',
  exportCountCompletedGames: 'Completed matches',
  exportCountMigrationRuns: 'Migration runs',
  exportSensitiveWarningTitle: 'Note: sensitive content',
  exportSensitiveWarningDesc:
    'This file contains email addresses and other personal data of organization and team members. Store and share it only as you would other personal data.',
  exportDownloadBtn: '⬇ Download organization export',
  exportDownloadedLabel: 'Export downloaded.',
  exportCloseBtn: 'Close',

  cloudImportPrompt:
    'Copy your local data to the cloud once. The cloud version becomes the source of truth; your local copy is kept as a fallback.',
  cloudImportButton: 'Copy to cloud once',
  cloudImportSuccess: 'Copy to cloud succeeded.',
  cloudImportError: 'Copy to cloud failed. Please try again.',
  cloudImportAlreadyDone: 'This data has already been copied to the cloud.',

  authLoadingTitle: 'Loading…',
  authEmailLabel: 'Email address',
  authPasswordLabel: 'Password',
  authLoginTitle: 'Log in',
  authLoginBtn: 'Log in',
  authSignupTitle: 'Create account',
  authSignupBtn: 'Create account',
  authSwitchToSignupPrompt: "Don't have an account yet?",
  authSwitchToSignupBtn: 'Create one',
  authSwitchToLoginPrompt: 'Already have an account?',
  authSwitchToLoginBtn: 'Log in',
  authSignOutBtn: 'Log out',
  authInvalidCredentialError: 'Incorrect email address or password.',
  authEmailInUseError: 'An account already exists for this email address.',
  authWeakPasswordError: 'Choose a password of at least 6 characters.',
  authInvalidEmailError: 'Enter a valid email address.',
  authGenericError: 'Something went wrong. Please try again.',

  trustedDevicePromptTitle: 'Is this a trusted device?',
  trustedDevicePromptBody:
    'On a trusted device (e.g. your own phone or laptop), data stays available locally, even offline. On a shared device (e.g. a club tablet), your data is automatically wiped when you log out.',
  trustedDeviceYesBtn: 'Yes, trusted device',
  trustedDeviceNoBtn: 'No, shared device',

  trustedDeviceSettingLabel: 'This is a trusted device',
  trustedDeviceSettingHint:
    'Turn off for a shared device (e.g. a club tablet) — your data will then be automatically wiped on log out. Turning it off wipes the locally stored data on this device immediately.',
  trustedDeviceRevokeConfirmTitle: 'Mark device as shared?',
  trustedDeviceRevokeConfirmBody:
    'This immediately wipes the locally stored roster, game and settings data on this device. It will happen automatically on log out from now on.',
  trustedDeviceRevokeConfirmBtn: 'Yes, mark as shared device',
  trustedDeviceRevokeCancelBtn: 'Cancel',

  onboardingFreshSignupTitle: 'Welcome! Create your first organization',
  onboardingFreshSignupBody:
    "You don't have an organization yet. Create one below to get started — you'll automatically become the owner.",
  onboardingLostMembershipsTitle: 'No access to an organization',
  onboardingLostMembershipsBody:
    "You currently don't have access to any organization. Ask an admin to invite you again, or create a new organization below.",
  onboardingOrgNameLabel: 'Organization name',
  onboardingTeamNameLabel: 'First team name',
  onboardingCreateBtn: 'Create organization',

  contextSwitcherTitle: 'Choose an organization and team',
  contextSwitcherSwitchBtn: 'Switch organization/team',
  contextSwitcherTeamsLoading: 'Loading teams…',
  stateUncachedOfflineTitle: 'No connection',
  stateUncachedOfflineBody:
    "There isn't a local copy of your organizations on this device yet. Go online to continue.",
  stateContextRevokedTitle: 'No longer have access',
  stateContextRevokedBody: 'Your access to this organization or team has been revoked.',
  stateContextRevokedBackBtn: 'Back to organization overview',

  authVerifyEmailTitle: 'Verify your email address',
  authVerifyEmailBody:
    "We've sent a verification link to your email address. Verify it to accept this invitation.",
  authResendVerificationBtn: 'Resend verification email',
  authResendVerificationSuccess: 'Verification email sent. Check your inbox.',
  authResendVerificationError: 'Failed to send the verification email. Please try again later.',

  invitationLoginHint: 'Log in or create an account with the email address you were invited with.',
  invitationNotFoundTitle: 'Invitation not found',
  invitationNotFoundBody:
    "This invitation doesn't exist (anymore), or you don't have access to it with this account.",
  invitationRevokedTitle: 'Invitation revoked',
  invitationRevokedBody: 'This invitation has been revoked. Ask your admin for a new invitation.',
  invitationAcceptTitle: 'Accept invitation',
  invitationPendingBody: "You've been invited with role:",
  invitationAcceptBtn: 'Accept invitation',
  invitationClaimTitle: 'Complete membership',
  invitationAcceptedBody: 'Invitation accepted. Complete your membership to get access.',
  invitationClaimBtn: 'Complete membership',
  invitationAlreadyClaimedTitle: 'Already completed',
  invitationAlreadyClaimedBody: 'This invitation has already been used. Log in to get access.',
  invitationDismissBtn: 'Continue',

  syncStatusLocal: 'Available locally',
  syncStatusPending: 'Waiting to sync',
  syncStatusSynced: 'Synced',
  syncStatusActionNeeded: 'Action needed',
  syncStatusFromCache: 'from cache',
  lastModifiedLabel: 'Last modified',
  actionNeededTitle: 'Action needed',
  actionNeededRetryBtn: 'Retry',
  actionNeededDismissBtn: 'Dismiss',
  actionNeededExportBtn: 'Export',

  // PR 5.4a: role-gate read-only indicator and non-blocking cloud-connection-lost
  // signal. See NL block for full rationale.
  settingsReadOnly: "Read-only — your role doesn't have edit permission for this data.",
  rosterReadOnly: "Read-only — your role doesn't have edit permission for this data.",
  listenerErrorIndicator: 'Cloud connection lost',

  pwaUpdateAvailable: 'A new version is available. It will update automatically shortly.',
  pwaUpdateAvailableLocked: 'A new version is available. It will update once the game has ended.',
  pwaUpdateReloading: 'Updating…',
  pwaUpdateConfirmBtn: 'Update now',
  pwaActionNeededTitle: 'Update failed',
  pwaActionNeededMessage: 'Updating the app failed. You can keep using the current version.',

  // PR 8.3c-1c: owner-only deletion request, cleanup overview and notice for all members (EN, mirrors NL key-for-key).
  deletionTitle: 'Delete organization',
  deletionDesc:
    'Request deletion of this organization. This is not an immediate deletion: the administrator deletes the organization manually, after a waiting period of at least 7 days in which you can cancel.',
  deletionStartBtn: 'Review deletion',
  deletionLoading: 'Checking the organization…',
  deletionCloseBtn: 'Close',
  deletionErrorGeneric: 'Checking failed. Please try again.',
  deletionErrorNotFound: 'This organization was not found.',
  deletionErrorDenied: 'Only the organization owner can request deletion.',
  deletionErrorRoundtrip:
    'The export could not be verified, so no request was submitted. Please try again.',
  deletionBlockersTitle: 'Deletion is not possible right now',
  deletionBlockerRecentGame:
    'Team {team}: match {game} was used in the last 24 hours. Finish the match and wait until there has been no activity for 24 hours.',
  deletionBlockerMigrationRun:
    'Team {team}: migration run {run} is not finished. Finish the migration, or ask the administrator for help.',
  deletionStaleTitle: 'Unfinished matches',
  deletionStaleDesc:
    'Unfinished matches without recent activity: {count}. They are deleted together with the organization (they are included in the export).',
  deletionStaleAck: 'I understand these unfinished matches will be deleted too.',
  deletionNeedsAck: 'First confirm that the unfinished matches may be deleted too.',
  deletionTeamOnlyNote:
    'Number of members who only have access through a team: {count}. They will not see the notice about this deletion; inform them yourself.',
  deletionCleanupTitle: 'Cleanup overview',
  deletionCleanupDesc:
    'What can be cleaned up according to the retention periods. Counts only; nothing is deleted automatically.',
  deletionCleanupTombstones: 'Deleted matches older than 90 days (to be wiped)',
  deletionCleanupInvitationsPending: 'Expired invitations (older than 30 days)',
  deletionCleanupInvitationsAccepted: 'Stuck accepted invitations (older than 30 days)',
  deletionCleanupInvitationsClaimed: 'Used invitations (older than 30 days)',
  deletionCleanupInvitationsRevoked: 'Revoked invitations (older than 30 days)',
  deletionCleanupAbandonedGames: 'Abandoned unfinished matches (older than 180 days)',
  deletionCleanupMigrationRuns: 'Finished migration runs older than 90 days',
  deletionRequestBtn: 'Submit deletion request…',
  deletionConfirmTitle: 'Request deletion?',
  deletionConfirmDesc:
    'A full export of this organization is made and a deletion request is submitted. The administrator deletes the organization manually, after at least 7 days. Until then you can cancel. Deletion cannot be undone.',
  deletionConfirmTypeLabel: 'Type the organization name to confirm: {org}',
  deletionConfirmBtn: 'Request deletion',
  deletionConfirmInProgress: 'Working…',
  deletionConfirmBackBtn: 'Back',
  deletionStatusRequested:
    'Deletion request submitted on {date}. The organization will be deleted manually by the administrator. You will see the execution status here.',
  deletionStatusExecuting: 'The administrator is deleting this organization (request from {date}).',
  deletionStatusFailed:
    'Deletion was interrupted and will be resumed by the administrator (request from {date}). The organization has not been deleted yet.',
  deletionStatusCompleted: 'This deletion request has been completed.',
  deletionStatusCancelled:
    'The previous deletion request was cancelled. You can submit a new request.',
  deletionCancelRequestBtn: 'Cancel request…',
  deletionCancelTitle: 'Cancel deletion request?',
  deletionCancelDesc: 'The organization stays. You can submit a new request later.',
  deletionCancelConfirmBtn: 'Cancel request',
  deletionSubmittedTitle: 'Request submitted',
  deletionExportDownloadBtn: 'Download export',
  deletionExportDownloadedLabel: 'Export downloaded.',
  deletionExportOnlyNow:
    'Download the file now: it is only available on this screen. You can always make a new export later with Full organization export.',
  deletionExportSensitive:
    'The export contains member email addresses and player data. Store the file securely.',
  deletionErrorClockBehind:
    'This device clock is behind the previous request. Check your device time and try again.',
  deletionErrorRejected:
    'The request was rejected. Your role may have changed or the request was already updated. The status was fetched again; try again if needed.',
  deletionErrorTimeout:
    'No response from the server. The request may still be processed; check the status below.',
  deletionErrorReadback:
    'The request was sent but could not be read back. The status was fetched again; check it below.',
  deletionErrorNotSignedIn: 'You are not signed in. Sign in again.',
  deletionAlreadyOpen: 'A deletion request already exists. The status has been updated.',
  deletionBannerRequested:
    'Note: deletion of this organization was requested on {date}. The organization will be deleted by the administrator.',
  deletionBannerExecuting: 'Note: this organization is being deleted right now.',
  deletionBannerFailed:
    'Note: deletion of this organization has been requested and is not finished yet.',

  // PR 8.3c-2c-i: leave organization and delete account (docs/pr-8.3c-2c-plan.md §3).
  accountPanelTitle: 'Account and membership',
  accountActionBusy:
    'Another account action is already running. Wait until it finishes and try again.',
  accountNothingChanged: 'Nothing was changed.',
  accountCloseBtn: 'Close',
  accountBackBtn: 'Back',
  accountRetryBtn: 'Try again',
  accountStageTeamMembers: 'Stopped at: removing your team access.',
  accountStageInvitations: 'Stopped at: removing your invitations.',
  accountStagePerOrgCheck: 'Stopped at: the per-organization check.',
  accountStageOrganizationMember: 'Stopped at: removing your membership.',
  accountStageFinalCheck: 'Stopped at: the final check.',
  accountStageFinalGate: 'Stopped at: the last check before deleting your account.',
  accountStepErrorRejected:
    'The server rejected a step; your role may have changed in the meantime.',
  accountStepErrorTimeout: 'The server did not respond in time.',
  accountStepErrorOffline: 'The connection to the server was lost.',
  accountStepErrorNotSignedIn: 'You are no longer signed in.',
  accountStepErrorFailed: 'Something went wrong at the server.',
  accountStepErrorReadFailed: 'Your data could not be read.',
  accountStepErrorEmailNotVerified: 'Your email address has not been verified.',

  leaveOrgDesc:
    'Leave {org} if you no longer belong to it. You will then lose access to the teams of this organization on all your devices.',
  leaveOrgStartBtn: 'Leave organization…',
  leaveOrgOwnerNote:
    'As an owner you cannot leave {org} yourself. First transfer ownership with "Transfer ownership…" below: the other member becomes co-owner and then removes you. Or request deletion of the organization.',
  leaveOrgConfirmTitle: 'Leave organization {org}?',
  leaveOrgConfirmDesc:
    'Your membership, your team access and your open invitations for this organization will be removed. Games stored on this device stay. You can only come back with a new invitation.',
  leaveOrgConfirmBtn: 'Leave organization',
  leaveOrgInProgress: 'Leaving…',
  leaveOrgOk: 'You have left {org}.',
  leaveOrgOkInvitationsUnchecked:
    'Your email address is not verified, so your invitations for this organization could not be checked. An open invitation may still exist; ask an owner or admin to revoke it.',
  leaveOrgOkDeletionPending: 'A deletion request is open for this organization.',
  leaveOrgNotSignedIn: 'You are not signed in (anymore). Sign in again and try once more.',
  leaveOrgOffline:
    'No connection to the server. Leaving only works online; try again once you are connected.',
  leaveOrgFailedTimeout: 'The server did not respond in time. Try again.',
  leaveOrgFailedRead: 'Your membership could not be checked. Try again later.',
  leaveOrgNotAMember: 'You are not (or no longer) a member of this organization.',
  leaveOrgDeniedOwnerSole:
    'You are the only owner of this organization, so you cannot leave it. First transfer ownership with "Transfer ownership…", or request deletion of the organization.',
  leaveOrgDeniedOwnerAwaitingRemoval:
    'You are an owner and cannot remove your own membership. This is waiting for confirmation by the new owner: another owner (count: {count}) has to remove you via "Remove other owner…".',
  leaveOrgDeniedCreatorNeedsOwner:
    'You created this organization, so you cannot leave it yourself: ask an owner or admin to remove your membership.',
  leaveOrgDeniedUnsupported:
    'This organization is missing data that is needed to leave. Ask an owner to remove your membership, or contact the app administrator.',
  leaveOrgDeniedMissing:
    'This organization no longer exists, but your membership still does. Contact the app administrator.',
  leaveOrgDeniedAwaitingDeletion:
    'A deletion request is open for this organization. As an owner, wait until it has been carried out.',
  leaveOrgDeniedDeletionFailed:
    'Deleting this organization got stuck. Contact the app administrator.',
  leaveOrgBlockedLocalWork:
    'This device has game work for this organization that has not been synced with the server yet (count: {count}). Finish it and let it sync first; otherwise it will be lost.',
  leaveOrgIncomplete:
    'Leaving did not fully succeed; you may still be a member. Try again: it continues where it stopped.',

  accountDeleteDesc:
    'Delete your account together with all your memberships and invitations in the cloud. Games and settings that are stored only on this device stay.',
  accountDeleteStartBtn: 'Delete account…',
  accountDeleteNoOrgHint: 'No longer want to use this account? You can delete it here.',
  accountDeleteTitle: 'Delete account',
  accountDeleteChecking: 'Checking your account…',
  accountDeletePlanIntro: 'This is what happens per organization:',
  accountDeleteClassLeave: 'You leave this organization.',
  accountDeleteClassLeaveTeamOnly: 'Your team access in this organization is removed.',
  accountDeleteClassInvitationsOnly: 'Your invitations for this organization are removed.',
  accountDeleteClassOwnerSole:
    'Blocked: you are the only owner. First transfer ownership with "Transfer ownership…", or request deletion of the organization.',
  accountDeleteClassOwnerAwaitingRemoval:
    'Blocked: you are an owner and waiting for confirmation by the new owner. Another owner (count: {count}) has to remove you via "Remove other owner…".',
  accountDeleteClassCreatorNeedsOwner:
    'Blocked: you created this organization. An owner or admin has to remove your membership.',
  accountDeleteClassAwaitingDeletion:
    'Blocked: a deletion request is open for this organization. Wait until it has been carried out.',
  accountDeleteClassDeletionFailed:
    'Blocked: deleting this organization got stuck. Contact the app administrator.',
  accountDeleteClassUnsupported:
    'Blocked: this organization is missing data. Ask an owner to remove your membership.',
  accountDeleteClassMissing:
    'Blocked: this organization no longer exists, but your membership still does. Contact the app administrator.',
  accountDeleteClassLocalWork:
    'Blocked: this device has game work that has not been synced yet (count: {count}). Finish it and let it sync first.',
  accountDeleteInvitations: 'Invitations to your email address that will be removed: {count}',
  accountDeleteBlockedTitle:
    'Your account cannot be deleted yet. Resolve the blocked items first; nothing was changed.',
  accountDeletePlanChanged: 'The situation has changed in the meantime. The plan has been updated.',
  accountDeleteReadyIntro: 'After that, your account itself is deleted. This cannot be undone.',
  accountDeleteAuthOnly:
    'There are no memberships or invitations of yours left in the cloud; only your account still exists. You can delete it now.',
  accountDeleteContinueBtn: 'Continue',
  accountDeleteRecheckBtn: 'Check again',
  accountDeletePasswordTitle: 'Confirm with your password',
  accountDeletePasswordDesc:
    'Enter your password to delete your account permanently. This cannot be undone.',
  accountDeletePasswordLabel: 'Password',
  accountDeleteConfirmBtn: 'Delete account permanently',
  accountDeleteInProgress: 'Deleting…',
  accountDeleteWrongPassword: 'The password is incorrect. Try again.',
  accountDeleteTooManyRequests: 'Too many attempts. Wait a moment and try again later.',
  accountDeleteReauthNetwork:
    'No connection while checking your password. Try again once you are connected.',
  accountDeleteReauthOther: 'Your password could not be checked. Try again.',
  accountDeleteNotSignedIn: 'You are not signed in (anymore). Sign in again and try once more.',
  accountDeleteEmailNotVerified:
    'Verify your email address first. Without a verified address your invitations cannot be checked. Open the link in your email and then check again.',
  accountDeleteResendVerificationBtn: 'Resend verification email',
  accountDeleteVerificationSent: 'The verification email has been sent.',
  accountDeleteVerificationFailed: 'The verification email could not be sent.',
  accountDeleteOffline:
    'No connection to the server. Deleting your account only works online; try again once you are connected.',
  accountDeleteFailedTimeout: 'The server did not respond in time. Try again.',
  accountDeleteFailedRead: 'Your data could not be checked. Try again later.',
  accountDeleteAuthStateUnknown:
    'It is not certain whether your account was deleted. Sign in again: if that no longer works, your account was deleted; if it does, start again.',
  accountDeleteIncomplete:
    'The cleanup did not fully succeed. Your account still exists. Try again: it continues where it stopped.',
  accountDeleteIncompleteFinalGate:
    'The last check still found data of yours in the cloud (memberships: {members}, team access: {teams}, invitations: {invitations}). You may have just been invited again. Your account still exists; check again.',
  accountDeleteClearedAuthPresent:
    'Your memberships and invitations in the cloud have been removed, but your account still exists. Try again to delete your account.',
  accountDeleteReasonRecentLogin: 'Firebase requires a more recent sign-in.',
  accountDeleteReasonNetwork: 'The connection was lost.',
  accountDeleteReasonOther: 'The server returned an unexpected error.',
  accountDeleteDeleted:
    'Your account has been deleted. The cloud data cached in this browser has been wiped. Data stored only on this device, such as local games and settings, has not been wiped.',
  accountDeleteLocalWipeFailed:
    'The cloud data cached in this browser could not be wiped completely. Clear the browser data if you share this device with others.',
  onboardingResumeExpired:
    'The organization you started creating earlier can no longer be completed. Click "Create organization" again to create a new organization.',
  accountOrganizationNameUnknown: 'Organization (name unknown)',
  transferStartBtn: 'Transfer ownership…',
  transferRemoveOwnerStartBtn: 'Remove other owner…',
  transferPanelDesc:
    'Transfer ownership of {org} to another member. That member becomes co-owner and completes the transfer themselves by removing you as owner. This only works online.',
  transferRemoveOwnerDesc:
    'Has another owner transferred ownership to you? Then complete the transfer by removing that owner. This only works online.',
  transferPromoteTitle: 'Transfer ownership of {org}',
  transferRemoveOwnerTitle: 'Remove other owner of {org}',
  transferLoading: 'Reading the members from the server…',
  transferChooseIntro: 'Choose who becomes co-owner:',
  transferRemoveOwnerChooseIntro: 'Choose which other owner to remove:',
  transferNoCandidates:
    'There is no other member to transfer ownership to. Invite someone to this organization first.',
  transferNoOtherOwners: 'There is no other owner in this organization.',
  transferMemberNoEmail: 'Member without a known email address',
  transferRoleOwner: 'Owner',
  transferRoleAdmin: 'Admin',
  transferRoleCoach: 'Coach',
  transferRoleScorer: 'Scorer',
  transferRoleViewer: 'Viewer',
  transferPromoteConfirmDesc:
    '{member} becomes co-owner of {org} and gets all rights of an owner, including the right to remove you as owner afterwards via "Remove other owner…". You stay owner until {member} does so. Until then you cannot leave {org} or delete your account.',
  transferPromoteConfirmBtn: 'Make co-owner',
  transferPromoteInProgress: 'Transferring…',
  transferRemoveOwnerConfirmDesc:
    'You are removing {member} as owner of {org}: the open invitations of {member} will be revoked and their team access and membership removed. Only do this if {member} wants to transfer ownership to you or you have agreed on it. This cannot be undone; coming back is only possible with a new invitation.',
  transferRemoveOwnerTypeLabel: 'Type the email address {member} to confirm',
  transferRemoveOwnerMismatch: 'This does not match the email address of the chosen owner.',
  transferRemoveOwnerConfirmBtn: 'Remove owner',
  transferRemoveOwnerInProgress: 'Removing…',
  transferBackToListBtn: 'Back to the list',
  transferNotSignedIn: 'You are not signed in (anymore). Sign in again and try once more.',
  transferOffline:
    'No connection to the server. Transferring ownership only works online; try again once you have a connection. You can keep tracking games on this device as usual.',
  transferFailedRead: 'The members of this organization could not be read. Try again later.',
  transferFailedTimeout: 'The server did not respond in time. Try again.',
  transferDeniedNotAMember: 'You are not a member of this organization (anymore).',
  transferDeniedNotOwner:
    'According to the server you are not an owner of this organization (anymore). Only an owner can transfer ownership or remove another owner.',
  transferDeniedSelf: 'You cannot choose yourself here.',
  transferDeniedTargetNotOwner:
    '{member} is not an owner (anymore). Only another owner can be removed here.',
  transferPromoteOk: '{member} is now co-owner of {org}.',
  transferPromoteAlreadyOwner: '{member} was already an owner of {org}.',
  transferPromoteAwaiting:
    'Waiting for confirmation by the new owner: {member} has to sign in and remove you as owner via "Remove other owner…". Only then is the transfer complete. Until then you stay owner and cannot leave {org} or delete your account.',
  transferPromoteNotFound: '{member} is no longer a member of this organization.',
  transferRejectedTargetChanged:
    'The role of {member} has changed in the meantime; the action was stopped. Open the list again.',
  transferRejectedPermission:
    'The server rejected the change. You may no longer be an owner yourself, for example because another owner removed you at the same time.',
  transferPromoteTimeout:
    'The server did not respond in time. The promotion of {member} may still go through later. Try again: that first checks the current state.',
  transferPromoteFailedWrite:
    'The promotion of {member} may not have succeeded. Try again: that first checks the current state.',
  transferCompleteOk: '{member} has been removed as owner of {org}. The transfer is complete.',
  transferCompleteCounts: 'Invitations revoked: {invitations}. Team access removed: {teams}.',
  transferCompleteSkippedMalformed:
    'Invitations in this organization without a readable email address or with an unknown status, skipped: {count}. Nobody can accept them; ask the app administrator to clean them up.',
  transferCompleteAlreadyGone: 'The membership of {member} had already been removed.',
  transferCompleteNotFound:
    '{member} is no longer a member of this organization: the transfer was already completed. Nothing was changed.',
  transferCompletePartial:
    'Invitations of {member} may already have been revoked or team access removed; that is not undone. The membership of {member} still exists.',
  transferCompleteIncomplete:
    'Removing {member} did not fully succeed; {member} may still be an owner. Try again: it continues where it stopped.',
  transferStageInvitations: 'Stopped at: revoking the open invitations of the other owner.',
  transferStageTeamMembers: 'Stopped at: removing the team access of the other owner.',
  transferStagePreRemovalCheck: 'Stopped at: the check before removing the membership.',
  transferStageOrganizationMember: 'Stopped at: removing the membership of the other owner.',
  transferStageFinalCheck: 'Stopped at: the final check.',
  transferStepErrorRoleChanged: 'The role had changed in the meantime.',
  transferStepErrorNotFound: 'The member was not found (anymore).',
  transferStepErrorSelf: 'The target was your own account.',
} as const;

export const STRINGS = { nl, en } as const;

export type StringKey = keyof typeof nl;

export function isValidLang(value: unknown): value is Lang {
  return value === 'nl' || value === 'en';
}

export function translate(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}
