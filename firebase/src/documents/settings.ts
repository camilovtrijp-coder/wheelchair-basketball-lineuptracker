import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { assertBoolean, assertNonEmptyString, assertNumber, assertString, assertTimestamp } from './validation.js';

const TYPE = 'settings';

/**
 * organizations/{orgId}/teams/{teamId}/settings/current
 *
 * Veldvorm spiegelt bewust `v2/src/domain/settings/types.ts` (`Settings`) —
 * dezelfde velden als de lokale v1/v2-instellingen, plus `updatedAt`. PR 5.3
 * beslist hoe de Firebase-adapter deze converter achter `SettingsRepository`
 * hangt; deze PR levert alleen het typed documentcontract.
 */
export interface SettingsDocument {
  teamName: string;
  logoUri: string;
  primaryColor: string;
  accentColor: string;
  quarterCount: number;
  periodLabel: string;
  useClassLimit: boolean;
  tag1Label: string;
  tag2Label: string;
  classBaseLimit: number;
  maxBonus: number;
  bonusTag1Only: number;
  bonusTag2Only: number;
  bonusBoth: number;
  updatedAt: Timestamp;
}

export const settingsConverter: FirestoreDataConverter<SettingsDocument> = {
  toFirestore(settings: SettingsDocument) {
    return settings;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): SettingsDocument {
    const data = snapshot.data();
    return {
      teamName: assertString(TYPE, 'teamName', data.teamName),
      logoUri: assertString(TYPE, 'logoUri', data.logoUri),
      primaryColor: assertNonEmptyString(TYPE, 'primaryColor', data.primaryColor),
      accentColor: assertNonEmptyString(TYPE, 'accentColor', data.accentColor),
      quarterCount: assertNumber(TYPE, 'quarterCount', data.quarterCount),
      periodLabel: assertString(TYPE, 'periodLabel', data.periodLabel),
      useClassLimit: assertBoolean(TYPE, 'useClassLimit', data.useClassLimit),
      tag1Label: assertString(TYPE, 'tag1Label', data.tag1Label),
      tag2Label: assertString(TYPE, 'tag2Label', data.tag2Label),
      classBaseLimit: assertNumber(TYPE, 'classBaseLimit', data.classBaseLimit),
      maxBonus: assertNumber(TYPE, 'maxBonus', data.maxBonus),
      bonusTag1Only: assertNumber(TYPE, 'bonusTag1Only', data.bonusTag1Only),
      bonusTag2Only: assertNumber(TYPE, 'bonusTag2Only', data.bonusTag2Only),
      bonusBoth: assertNumber(TYPE, 'bonusBoth', data.bonusBoth),
      updatedAt: assertTimestamp(TYPE, 'updatedAt', data.updatedAt),
    };
  },
};
