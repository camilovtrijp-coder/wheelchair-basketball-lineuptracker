// @vitest-environment jsdom
// PR 8.3c-1c — de melding aan alle organisatieleden (besluitrecord §2.5).
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/preact';
import {
  DeletionRequestBanner,
  formatDeletionDate,
} from '../../src/ui/deletion/DeletionRequestBanner';
import type { DeletionRequest, DeletionRequestStatus } from '../../src/domain/deletion/types';

function request(status: DeletionRequestStatus): DeletionRequest {
  return {
    organizationId: 'org-1',
    status,
    attempt: 1,
    requestedBy: 'uid-owner',
    requestedAt: '2026-09-29T12:00:00.000Z',
    exportProof: {
      contentHash: 'h',
      exportedAt: '2026-09-29T12:00:00.000Z',
      counts: {
        organizationMembers: 1,
        invitations: 0,
        teams: 1,
        teamMembers: 0,
        settingsDocuments: 0,
        rosterPlayers: 0,
        games: 0,
        gameActions: 0,
        completedGames: 0,
        migrationRuns: 0,
      },
    },
    cancelledAt: status === 'cancelled' ? '2026-09-29T13:00:00.000Z' : null,
    revision: 0,
  };
}

afterEach(cleanup);

describe('DeletionRequestBanner', () => {
  it('toont niets zonder verzoek', () => {
    render(<DeletionRequestBanner lang="nl" request={null} />);
    expect(screen.queryByTestId('deletion-banner')).toBeNull();
  });

  it.each(['cancelled', 'completed'] as const)('toont niets bij status %s', (status) => {
    render(<DeletionRequestBanner lang="nl" request={request(status)} />);
    expect(screen.queryByTestId('deletion-banner')).toBeNull();
  });

  it.each([
    ['requested', 'aangevraagd'],
    ['executing', 'wordt op dit moment verwijderd'],
    ['failed', 'nog niet afgerond'],
  ] as const)('toont bij status %s een melding als status-regio', (status, tekst) => {
    render(<DeletionRequestBanner lang="nl" request={request(status)} />);
    const banner = screen.getByTestId('deletion-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toContain(tekst);
  });

  it('toont de aanvraagdatum in de gekozen taal', () => {
    const { unmount } = render(<DeletionRequestBanner lang="nl" request={request('requested')} />);
    expect(screen.getByTestId('deletion-banner').textContent).toContain('29');
    unmount();
    render(<DeletionRequestBanner lang="en" request={request('requested')} />);
    expect(screen.getByTestId('deletion-banner').textContent).toContain(
      'deletion of this organization',
    );
  });

  it('formatDeletionDate valt bij een onleesbare datum terug op de kale string', () => {
    expect(formatDeletionDate('geen-datum', 'nl')).toBe('geen-datum');
  });
});
