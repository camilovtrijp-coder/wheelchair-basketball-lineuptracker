import { describe, it, expect } from 'vitest';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import {
  combinedCsvFor,
  combinedCsvForGame,
  csvFilenameFor,
  minutesCsvFor,
  segmentsCsvFor,
} from '../../src/domain/game/csv';

// Golden-master fixtures uit docs/product-compatibility-matrix.md ("Voorbeeld 1:
// Eenvoudige Wedstrijd", "Voorbeeld 2: Classificatie Systeem") — byte-exacte
// controle van het Nederlandse CSV-contract (docs/pr-6.3-plan.md §C/6.3a).

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: 'p1',
    rosterId: 1,
    nr: '1',
    naam: 'P1',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
    ...overrides,
  };
}

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    quarter: 1,
    beginSec: 600,
    endSec: 420,
    durSec: 180,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 0,
    pa: 0,
    classSum: 0,
    allowed: 0,
    over: false,
    ...overrides,
  };
}

// Voorbeeld 1: 5 spelers #1..#5, geen classificatiesysteem.
const players1: GamePlayer[] = [
  player({ id: 'p1', nr: '1', naam: 'P1', kl: '3.0' }),
  player({ id: 'p2', nr: '2', naam: 'P2', kl: '2.5' }),
  player({ id: 'p3', nr: '3', naam: 'P3', kl: '3.5' }),
  player({ id: 'p4', nr: '4', naam: 'P4', kl: '2.0' }),
  player({ id: 'p5', nr: '5', naam: 'P5', kl: '3.0' }),
];

const segments1: Segment[] = [
  segment({ id: 's1', quarter: 1, beginSec: 600, endSec: 420, durSec: 180, pf: 8, pa: 6 }),
  segment({ id: 's2', quarter: 1, beginSec: 420, endSec: 240, durSec: 180, pf: 6, pa: 8 }),
  segment({ id: 's3', quarter: 2, beginSec: 600, endSec: 360, durSec: 240, pf: 10, pa: 4 }),
];

const LINEUP_LABEL = '"P1 #1 | P2 #2 | P3 #3 | P4 #4 | P5 #5"';

describe('segmentsCsvFor (Voorbeeld 1, geen classificatie)', () => {
  it('bouwt de byte-exacte CSV van het Nederlandse contract', () => {
    const csv = segmentsCsvFor(segments1, players1, false);
    expect(csv).toBe(
      [
        'Opstelling,Kwart,Begin,Eind,Speeltijd,Seconden,Punten voor,Punten tegen,Plusminus,Lineup code',
        `${LINEUP_LABEL},1,10:00,7:00,3:00,180,8,6,2,1-2-3-4-5`,
        `${LINEUP_LABEL},1,7:00,4:00,3:00,180,6,8,-2,1-2-3-4-5`,
        `${LINEUP_LABEL},2,10:00,6:00,4:00,240,10,4,6,1-2-3-4-5`,
      ].join('\n'),
    );
  });
});

describe('minutesCsvFor (Voorbeeld 1, geen classificatie)', () => {
  it('telt totale speeltijd per speler op, zonder classificatiekolommen', () => {
    const csv = minutesCsvFor(segments1, players1, false);
    expect(csv).toBe(
      [
        'Speler,Nummer,Speeltijd,Seconden,Aantal beurten',
        'P1,1,10:00,600,3',
        'P2,2,10:00,600,3',
        'P3,3,10:00,600,3',
        'P4,4,10:00,600,3',
        'P5,5,10:00,600,3',
      ].join('\n'),
    );
  });

  it('laat spelers zonder speeltijd weg (v1-pariteit)', () => {
    const bench = player({ id: 'p6', nr: '6', naam: 'P6' });
    const csv = minutesCsvFor(segments1, [...players1, bench], false);
    expect(csv).not.toContain('P6');
  });
});

describe('combinedCsvFor (Voorbeeld 1)', () => {
  it('combineert beide secties met de exacte v1-scheidingsstructuur', () => {
    const csv = combinedCsvFor(segments1, players1, false);
    expect(csv).toBe(
      'Opstellingen (+/-)\n' +
        segmentsCsvFor(segments1, players1, false) +
        '\n\nSpeeltijd per speler\n' +
        minutesCsvFor(segments1, players1, false),
    );
    expect(csv.startsWith('Opstellingen (+/-)\n')).toBe(true);
    expect(csv).toContain('\n\nSpeeltijd per speler\n');
  });
});

describe('CSV met classificatiesysteem (Voorbeeld 2)', () => {
  // classSum 14.0, toegestane grens 17.0 (14.5 basis + 2.5 maxBonus), binnen grens.
  const classSegments: Segment[] = [
    segment({ id: 's1', pf: 5, pa: 3, classSum: 14.0, allowed: 17.0, over: false }),
  ];

  it('voegt de classificatiekolommen toe aan segments-CSV', () => {
    const csv = segmentsCsvFor(classSegments, players1, true);
    const [head, row] = csv.split('\n');
    expect(head).toBe(
      'Opstelling,Kwart,Begin,Eind,Speeltijd,Seconden,Punten voor,Punten tegen,Plusminus,' +
        'Som classificatie,Toegestane grens,Binnen klassegrens,Lineup code',
    );
    expect(row).toBe(`${LINEUP_LABEL},1,10:00,7:00,3:00,180,5,3,2,14.0,17.0,OK,1-2-3-4-5`);
  });

  it("toont 'Te hoog' zodra een segment de classificatiegrens overschrijdt", () => {
    const over = [segment({ classSum: 18.0, allowed: 17.0, over: true })];
    const csv = segmentsCsvFor(over, players1, true);
    expect(csv.split('\n')[1]).toContain(',18.0,17.0,Te hoog,');
  });

  it('voegt Classificatie/Geslacht/Jeugd-kolommen toe aan minutes-CSV', () => {
    const p = player({ id: 'p1', nr: '1', naam: 'P1', kl: '3.0', vrouw: true, jeugd: false });
    const csv = minutesCsvFor([segment({ lineup: ['p1'], durSec: 100 })], [p], true);
    expect(csv.split('\n')[1]).toBe('P1,1,3.0,Vrouw,Nee,1:40,100,1');
  });
});

describe('combinedCsvForGame / csvFilenameFor (CompletedGame)', () => {
  function completedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
    return {
      id: 'g1',
      organizationId: 'org-1',
      teamId: 'team-1',
      sourceGameId: 'active-1',
      opponent: 'Team B',
      competition: '',
      date: '2026-03-05T12:00:00.000Z',
      players: players1,
      segments: segments1,
      scoreFor: 24,
      scoreAgainst: 18,
      quarterCount: 2,
      periodLabel: '',
      useClassLimit: false,
      ...overrides,
    };
  }

  it('gebruikt de bevroren snapshotvelden, niet actuele instellingen', () => {
    const game = completedGame();
    expect(combinedCsvForGame(game)).toBe(combinedCsvFor(game.segments, game.players, false));
  });

  it('bouwt de bestandsnaam op basis van het afrondmoment, niet "vandaag"', () => {
    const filename = csvFilenameFor(completedGame());
    expect(filename).toMatch(/^team-b-\d{8}-\d{4}\.csv$/);
  });

  it('valt terug op "wedstrijd" wanneer er geen tegenstander is ingevuld', () => {
    const filename = csvFilenameFor(completedGame({ opponent: '' }));
    expect(filename).toMatch(/^wedstrijd-\d{8}-\d{4}\.csv$/);
  });
});
