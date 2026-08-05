import { describe, it, expect } from 'vitest';
import type { Roster } from '../../src/domain/roster/types';
import type { RosterRepository } from '../../src/application/roster/RosterRepository';
import { getRoster, saveRoster } from '../../src/application/roster/usecases';

class TrackingRepository implements RosterRepository {
  public writeCalls: Roster[] = [];
  public writeResult = true;
  private current: Roster;

  constructor(initial: Roster = []) {
    this.current = initial;
  }

  read(): Roster {
    return this.current;
  }

  write(players: Roster): boolean {
    this.writeCalls.push(players);
    if (this.writeResult) this.current = players;
    return this.writeResult;
  }
}

const PLAYER = { id: 1, nr: '7', naam: 'Jan', kl: '3.0', vrouw: false, jeugd: false };

describe('application/roster/usecases', () => {
  it('getRoster delegeert naar de repository', () => {
    const repo = new TrackingRepository([PLAYER]);
    expect(getRoster(repo)).toEqual([PLAYER]);
  });

  it('saveRoster schrijft expliciet naar de repository en geeft het resultaat door', () => {
    const repo = new TrackingRepository();
    expect(saveRoster(repo, [PLAYER])).toBe(true);
    expect(repo.writeCalls).toEqual([[PLAYER]]);

    repo.writeResult = false;
    expect(saveRoster(repo, [PLAYER])).toBe(false);
  });
});
