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
} as const;

export const STRINGS = { nl, en } as const;

export type StringKey = keyof typeof nl;

export function isValidLang(value: unknown): value is Lang {
  return value === 'nl' || value === 'en';
}

export function translate(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}
