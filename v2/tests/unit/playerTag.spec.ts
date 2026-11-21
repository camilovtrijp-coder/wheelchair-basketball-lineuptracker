import { describe, it, expect } from 'vitest';
import { playerTag } from '../../src/ui/game/playerTag';
import { translate } from '../../src/i18n/strings';
import type { GamePlayer } from '../../src/domain/game/types';

const base: GamePlayer = {
  id: 'gp-1',
  rosterId: 1,
  nr: '4',
  naam: 'Alex',
  kl: '2.5',
  vrouw: false,
  jeugd: false,
  participate: true,
  start: false,
};

describe('playerTag (R6: één V/F-notatie)', () => {
  it('geeft geen letters zonder categorie, één letter per categorie en beide samen', () => {
    expect(playerTag(base, 'Vrouw', 'Jeugd')).toBe('');
    expect(playerTag({ ...base, vrouw: true }, 'Vrouw', 'Jeugd')).toBe('V');
    expect(playerTag({ ...base, jeugd: true }, 'Vrouw', 'Jeugd')).toBe('J');
    expect(playerTag({ ...base, vrouw: true, jeugd: true }, 'Vrouw', 'Jeugd')).toBe('VJ');
  });

  it('volgt een eigen label uit de instellingen (eerste letter, hoofdletter)', () => {
    expect(playerTag({ ...base, vrouw: true }, 'female', 'youth')).toBe('F');
  });

  it('standaardletters per taal: NL V/J, EN F/Y', () => {
    const nl = (k: 'tag1LetterDefault' | 'tag2LetterDefault') => translate('nl', k);
    const en = (k: 'tag1LetterDefault' | 'tag2LetterDefault') => translate('en', k);
    const p = { ...base, vrouw: true, jeugd: true };
    expect(playerTag(p, nl('tag1LetterDefault'), nl('tag2LetterDefault'))).toBe('VJ');
    expect(playerTag(p, en('tag1LetterDefault'), en('tag2LetterDefault'))).toBe('FY');
  });
});
