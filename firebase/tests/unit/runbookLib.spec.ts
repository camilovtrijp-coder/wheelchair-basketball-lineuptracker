import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { DELETION_REQUEST_COUNT_KEYS } from '../../src/documents/deletionRequest.js';
import { buildExecutionRecord } from '../../scripts/lib/executionRecord.js';
import { canonicalDump, hashDump } from '../../scripts/lib/orgInventory.js';
import {
  REPO_ROOT,
  assertNoKeyFile,
  assertOutsideRepo,
  parseInventoryArgs,
} from '../../scripts/lib/runbookGuards.js';

const zeroCounts = Object.fromEntries(DELETION_REQUEST_COUNT_KEYS.map((key) => [key, 0]));
const validRecord = {
  organizationId: 'org-1',
  requestedAt: '2026-09-01T10:00:00.000Z',
  requestedBy: 'uid-owner',
  executedAt: '2026-09-09T10:00:00.000Z',
  counts: { ...zeroCounts, teams: 1 },
  contentHash: 'sha256:abc',
};

describe('executionRecord (PR 8.3c-1d)', () => {
  it('accepteert een record met precies de zeven toegestane velden', () => {
    expect(buildExecutionRecord(validRecord)).toEqual(validRecord);
  });

  it('weigert extra velden, zoals een e-mailadres of spelersnaam', () => {
    expect(() => buildExecutionRecord({ ...validRecord, email: 'a@example.test' })).toThrow(
      /niet-toegestane velden: email/,
    );
    expect(() => buildExecutionRecord({ ...validRecord, players: ['Speler Een'] })).toThrow(
      /niet-toegestane velden/,
    );
  });

  it("weigert een '@' in een tekstveld, ook in de toegestane velden", () => {
    expect(() => buildExecutionRecord({ ...validRecord, requestedBy: 'a@example.test' })).toThrow(
      /'@'/,
    );
  });

  it('weigert ontbrekende, lege of niet-ISO-waarden en foute counts', () => {
    expect(() => buildExecutionRecord({ ...validRecord, organizationId: ' ' })).toThrow(/leeg/);
    expect(() => buildExecutionRecord({ ...validRecord, executedAt: '9-9-2026' })).toThrow(/ISO/);
    expect(() => buildExecutionRecord({ ...validRecord, counts: { teams: 1 } })).toThrow(
      /tien verwachte sleutels/,
    );
    expect(() =>
      buildExecutionRecord({
        ...validRecord,
        counts: { ...zeroCounts, games: -1 },
      }),
    ).toThrow(/niet-negatief/);
    expect(() =>
      buildExecutionRecord({
        ...validRecord,
        counts: { ...zeroCounts, games: 1.5 },
      }),
    ).toThrow(/geheel getal/);
  });
});

describe('canonicalDump/hashDump (PR 8.3c-1d)', () => {
  const a = { path: 'teams/t1', data: { name: 'x', b: 1, a: 2 } };
  const b = { path: 'invitations/i1', data: { status: 'pending' } };

  it('is onafhankelijk van volgorde van documenten en van veldvolgorde', () => {
    const one = canonicalDump([a, b]);
    const two = canonicalDump([b, { path: a.path, data: { a: 2, b: 1, name: 'x' } }]);
    expect(two).toBe(one);
    expect(hashDump(one)).toBe(hashDump(two));
  });

  it('verandert van hash zodra één waarde verandert', () => {
    const before = hashDump(canonicalDump([a, b]));
    const after = hashDump(canonicalDump([a, { ...b, data: { status: 'revoked' } }]));
    expect(after).not.toBe(before);
    expect(before).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('runbookGuards (PR 8.3c-1d)', () => {
  it('weigert een gezet GOOGLE_APPLICATION_CREDENTIALS (geen sleutelbestand)', () => {
    expect(() => assertNoKeyFile({ GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' })).toThrow(
      /service-accountsleutel/,
    );
    expect(() => assertNoKeyFile({})).not.toThrow();
  });

  it('weigert een uitvoerpad binnen de repository, ook via ..-segmenten', () => {
    expect(() => assertOutsideRepo(path.join(REPO_ROOT, 'dump.json'))).toThrow(
      /binnen de repository/,
    );
    expect(() =>
      assertOutsideRepo(path.join(REPO_ROOT, 'firebase', '..', 'x', 'dump.json')),
    ).toThrow(/binnen de repository/);
    expect(() => assertOutsideRepo(REPO_ROOT)).toThrow(/binnen de repository/);
    expect(() => assertOutsideRepo('/tmp/runbook/dump.json')).not.toThrow();
  });

  it('eist --project en --org expliciet en weigert onbekende opties', () => {
    expect(parseInventoryArgs(['--project', 'p', '--org', 'o', '--out', '/tmp/x'])).toEqual({
      project: 'p',
      org: 'o',
      out: '/tmp/x',
    });
    expect(() => parseInventoryArgs(['--org', 'o'])).toThrow(/--project is verplicht/);
    expect(() => parseInventoryArgs(['--project', 'p'])).toThrow(/--org is verplicht/);
    expect(() => parseInventoryArgs(['--project', 'p', '--org', 'o', '--force', 'y'])).toThrow(
      /onbekende opties/,
    );
    expect(() => parseInventoryArgs(['--project', '--org', 'o'])).toThrow(/ongeldig argument/);
  });
});
