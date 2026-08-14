import type { LangWritePort } from '../../application/i18n/LangRepository';
import { readLang, writeLang, type KeyValueStorage } from '../../i18n/persistence';
import type { Lang } from '../../i18n/strings';

/**
 * `LangWritePort`-implementatie over de bestaande `KeyValueStorage`
 * (dezelfde `browserStorage`/`readLang`/`writeLang` als `App.tsx` al
 * gebruikt voor de live taalwissel-`useEffect`) — hier alleen met een
 * expliciete `boolean`-terugmelding i.p.v. `void`, zodat een falende
 * `Storage.setItem()` (quota/security) de aanroeper bereikt in plaats van
 * ongevangen te gooien.
 */
export class LocalStorageLangRepository implements LangWritePort {
  constructor(private readonly storage: KeyValueStorage) {}

  read(): Lang | null {
    try {
      return readLang(this.storage);
    } catch {
      return null;
    }
  }

  write(lang: Lang): boolean {
    try {
      writeLang(this.storage, lang);
      return true;
    } catch {
      return false;
    }
  }
}
