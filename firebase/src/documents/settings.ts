import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';

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
      teamName: data.teamName,
      logoUri: data.logoUri,
      primaryColor: data.primaryColor,
      accentColor: data.accentColor,
      quarterCount: data.quarterCount,
      periodLabel: data.periodLabel,
      useClassLimit: data.useClassLimit,
      tag1Label: data.tag1Label,
      tag2Label: data.tag2Label,
      classBaseLimit: data.classBaseLimit,
      maxBonus: data.maxBonus,
      bonusTag1Only: data.bonusTag1Only,
      bonusTag2Only: data.bonusTag2Only,
      bonusBoth: data.bonusBoth,
      updatedAt: data.updatedAt,
    };
  },
};
