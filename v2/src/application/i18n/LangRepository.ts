import type { Lang } from '../../i18n/strings';

/**
 * Schrijfpoort voor de opgeslagen taalvoorkeur (`lineup-tracker-lang`).
 * Bestond vóór deze poort niet als eigen abstractie — `App.tsx` riep
 * `i18n/persistence.ts`'s `writeLang()` rechtstreeks aan vanuit een
 * `useEffect`, zonder enige foutafhandeling of readback (die kan immers
 * nooit een expliciet "geslaagd/mislukt"-resultaat teruggeven aan een
 * aanroeper). Voor `application/backup/BackupCoordinator.ts` (externe
 * PR-6.6-review, aug. 2026) is dat onvoldoende: een import die taal als
 * "written" in het journaal zet terwijl de storage-write feitelijk faalde
 * (quota/security-uitzondering van `Storage.setItem()`) zou een vals
 * succes melden en taal buiten de rollback houden. Deze poort geeft de
 * coordinator dezelfde write+readback-garantie als settings/roster.
 */
export interface LangWritePort {
  /** Rauwe storage-read; `null` betekent "nog nooit opgeslagen". */
  read(): Lang | null;
  /** `false` als de storage-write faalde (bv. quota/security) — muteert dan niets. */
  write(lang: Lang): boolean;
}
