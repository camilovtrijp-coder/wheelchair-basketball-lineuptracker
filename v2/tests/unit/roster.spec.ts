import { describe, it, expect } from 'vitest';
import type { Roster } from '../../src/domain/roster/types';
import {
  addPlayer,
  findDuplicateNumbers,
  normalizeRoster,
  removePlayer,
  sortRoster,
  toStoredPlayers,
  updatePlayerField,
} from '../../src/domain/roster/normalize';

function player(overrides: Partial<Roster[number]> = {}): Roster[number] {
  return {
    id: 1,
    nr: '7',
    naam: 'Jan',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    ...overrides,
  };
}

describe('domain/roster/normalize', () => {
  describe('normalizeRoster', () => {
    it('retourneert een lege lijst bij niet-array input', () => {
      expect(normalizeRoster(undefined)).toEqual([]);
      expect(normalizeRoster(null)).toEqual([]);
      expect(normalizeRoster('string')).toEqual([]);
      expect(normalizeRoster({})).toEqual([]);
    });

    it('filtert niet-object entries maar laat geldige spelers ongemoeid', () => {
      const p = player();
      const out = normalizeRoster([p, null, 'garbage', 42, p]);
      expect(out).toEqual([p, p]);
    });

    it('repareert geen bestaande spelersvelden (geen stille vormwijziging)', () => {
      const corrupt = player({ vrouw: 'ja' as unknown as boolean, kl: 3 as unknown as string });
      const out = normalizeRoster([corrupt]);
      expect(out[0]).toEqual(corrupt);
    });

    it('behoudt onbekende velden op een speler', () => {
      const withExtra = { ...player(), toekomstigVeld: 'bewaard' };
      const out = normalizeRoster([withExtra]);
      expect((out[0] as Record<string, unknown>).toekomstigVeld).toBe('bewaard');
    });
  });

  describe('sortRoster', () => {
    it('sorteert numeriek op rugnummer', () => {
      const players = [
        player({ id: 1, nr: '9' }),
        player({ id: 2, nr: '3' }),
        player({ id: 3, nr: '1' }),
      ];
      const sorted = sortRoster(players);
      expect(sorted.map((p) => p.nr)).toEqual(['1', '3', '9']);
    });

    it('behandelt niet-numerieke rugnummers als 0', () => {
      const players = [player({ id: 1, nr: 'x' }), player({ id: 2, nr: '2' })];
      const sorted = sortRoster(players);
      expect(sorted.map((p) => p.id)).toEqual([1, 2]);
    });

    it('muteert de invoerlijst niet', () => {
      const players = [player({ id: 1, nr: '9' }), player({ id: 2, nr: '1' })];
      const copy = [...players];
      sortRoster(players);
      expect(players).toEqual(copy);
    });
  });

  describe('findDuplicateNumbers', () => {
    it('vindt dubbele rugnummers bij spelers met een ingevulde naam', () => {
      const players = [
        player({ id: 1, nr: '7', naam: 'A' }),
        player({ id: 2, nr: '7', naam: 'B' }),
        player({ id: 3, nr: '9', naam: 'C' }),
      ];
      expect(findDuplicateNumbers(players)).toEqual(['7']);
    });

    it('negeert spelers zonder naam bij het bepalen van duplicaten', () => {
      const players = [player({ id: 1, nr: '7', naam: 'A' }), player({ id: 2, nr: '7', naam: '' })];
      expect(findDuplicateNumbers(players)).toEqual([]);
    });
  });

  describe('addPlayer', () => {
    it('voegt een speler toe met v1-standaardwaarden en een uniek, oplopend id', () => {
      const players = [player({ id: 5, nr: '1' })];
      const next = addPlayer(players);
      expect(next).toHaveLength(2);
      const added = next.find((p) => p.id === 6);
      expect(added).toMatchObject({ naam: '', kl: '3.0', vrouw: false, jeugd: false });
    });

    it('sorteert na toevoegen opnieuw op rugnummer', () => {
      // nieuwe speler krijgt nr = aantal + 1 = "2", dus komt vóór de bestaande nr "5" te staan
      const players = [player({ id: 1, nr: '5' })];
      const next = addPlayer(players);
      expect(next.map((p) => p.nr)).toEqual(['2', '5']);
      expect(next.map((p) => p.id)).toEqual([2, 1]);
    });
  });

  describe('updatePlayerField', () => {
    it('werkt alleen het opgegeven veld van de opgegeven speler bij', () => {
      const players = [player({ id: 1, naam: 'A' }), player({ id: 2, naam: 'B' })];
      const next = updatePlayerField(players, 1, 'naam', 'Gewijzigd');
      expect(next[0]?.naam).toBe('Gewijzigd');
      expect(next[1]?.naam).toBe('B');
    });

    it('sorteert opnieuw wanneer het rugnummer wijzigt', () => {
      const players = [player({ id: 1, nr: '1' }), player({ id: 2, nr: '2' })];
      const next = updatePlayerField(players, 1, 'nr', '9');
      expect(next.map((p) => p.id)).toEqual([2, 1]);
    });

    it('sorteert niet opnieuw bij een niet-nr-veld', () => {
      const players = [player({ id: 1, nr: '9' }), player({ id: 2, nr: '1' })];
      const next = updatePlayerField(players, 1, 'naam', 'X');
      expect(next.map((p) => p.id)).toEqual([1, 2]);
    });

    it('behoudt onbekende velden op de bijgewerkte speler', () => {
      const withExtra = { ...player({ id: 1 }), legacyFlag: 42 };
      const next = updatePlayerField([withExtra], 1, 'naam', 'Nieuw');
      expect((next[0] as Record<string, unknown>).legacyFlag).toBe(42);
    });
  });

  describe('removePlayer', () => {
    it('verwijdert alleen de speler met het opgegeven id', () => {
      const players = [player({ id: 1 }), player({ id: 2 })];
      const next = removePlayer(players, 1);
      expect(next.map((p) => p.id)).toEqual([2]);
    });

    it('op een lege lijst levert een lege lijst op', () => {
      expect(removePlayer([], 1)).toEqual([]);
    });

    it('bij een niet-bestaand id blijft de lijst ongewijzigd', () => {
      const players = [player({ id: 1 }), player({ id: 2 })];
      const next = removePlayer(players, 999);
      expect(next).toEqual(players);
    });
  });

  describe('toStoredPlayers', () => {
    it('behoudt alleen de bekende teamvelden (spiegelt v1-saveRoster)', () => {
      const withExtra = { ...player({ id: 1 }), start: false, participate: true, legacyFlag: 'x' };
      const out = toStoredPlayers([withExtra]);
      expect(out).toEqual([{ id: 1, nr: '7', naam: 'Jan', kl: '3.0', vrouw: false, jeugd: false }]);
    });
  });
});
