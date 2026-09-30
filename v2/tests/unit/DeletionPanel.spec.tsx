// @vitest-environment jsdom
// PR 8.3c-1c — UI-wiring van het verwijderverzoek. De beslissingen (blokkades,
// bevestigingen, bewijs, overgangen) zijn al bewezen in
// `DeletionRequestCoordinator.spec.ts`/`deletionAssessment.spec.ts`; dit bestand
// bewijst dat het paneel de juiste poort aanroept, de juiste stappen toont, de
// rolgrens respecteert en dat de bevestigingsdialoog toegankelijk werkt
// (typebevestiging, Escape, backdrop, focus in/uit, geen sluiten tijdens werk).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/preact';

vi.mock('../../src/infrastructure/export/downloadOrganizationExportFile', () => ({
  downloadOrganizationExportFile: vi.fn(),
}));

import { DeletionPanel } from '../../src/ui/deletion/DeletionPanel';
import { downloadOrganizationExportFile } from '../../src/infrastructure/export/downloadOrganizationExportFile';
import type {
  DeletionAssessmentOutcome,
  DeletionCancelOutcome,
  DeletionRequestCoordinator,
  DeletionRequestOutcome,
} from '../../src/application/deletion/DeletionRequestCoordinator';
import type { DeletionRequest } from '../../src/domain/deletion/types';
import type { OrganizationExportV1 } from '../../src/domain/export/types';
import type { OrganizationRole } from '../../src/domain/organizations/types';

const ORG_ID = 'org-1';
const ORG_NAME = 'De Adelaars Org';

const COUNTS = {
  organizationMembers: 5,
  invitations: 2,
  teams: 1,
  teamMembers: 1,
  settingsDocuments: 1,
  rosterPlayers: 8,
  games: 0,
  gameActions: 0,
  completedGames: 3,
  migrationRuns: 0,
};

function request(overrides: Partial<DeletionRequest> = {}): DeletionRequest {
  return {
    organizationId: ORG_ID,
    status: 'requested',
    attempt: 1,
    requestedBy: 'uid-owner',
    requestedAt: '2026-09-29T12:00:00.000Z',
    exportProof: {
      contentHash: 'hash-1',
      exportedAt: '2026-09-29T12:00:00.000Z',
      counts: COUNTS,
    },
    cancelledAt: null,
    revision: 0,
    ...overrides,
  };
}

function assessedOutcome(
  overrides: {
    blockers?: DeletionAssessmentOutcome extends infer O
      ? O extends { status: 'ok'; assessment: infer A }
        ? A extends { blockers: infer B }
          ? B
          : never
        : never
      : never;
    stale?: number;
    teamOnly?: number;
    existing?: DeletionRequest | null;
  } = {},
): DeletionAssessmentOutcome {
  return {
    status: 'ok',
    assessment: {
      blockers: overrides.blockers ?? [],
      staleUnfinishedGames: Array.from({ length: overrides.stale ?? 0 }, (_, i) => ({
        teamId: 'team-1',
        gameId: `g-${i}`,
      })),
      teamOnlyMemberCount: overrides.teamOnly ?? 0,
    },
    cleanup: {
      redactableTombstones: 2,
      removableInvitations: { pending: 3, accepted: 0, claimed: 4, revoked: 1 },
      abandonedGames: 5,
      expiredMigrationRuns: 6,
    },
    existingRequest: overrides.existing ?? null,
  };
}

const EXPORT = {
  type: 'organization-export',
  contentHash: 'hash-1',
} as unknown as OrganizationExportV1;

interface FakeCoordinator {
  assess: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

function fake(
  assess: DeletionAssessmentOutcome = assessedOutcome(),
  requestOutcome: DeletionRequestOutcome = { status: 'ok', request: request(), export: EXPORT },
  cancelOutcome: DeletionCancelOutcome = {
    status: 'ok',
    request: request({ status: 'cancelled', revision: 1, cancelledAt: '2026-09-29T13:00:00.000Z' }),
  },
): FakeCoordinator {
  return {
    assess: vi.fn().mockResolvedValue(assess),
    request: vi.fn().mockResolvedValue(requestOutcome),
    cancel: vi.fn().mockResolvedValue(cancelOutcome),
  };
}

function mount(
  coordinator: FakeCoordinator,
  role: OrganizationRole = 'organizationOwner',
  onRequestChange?: (r: DeletionRequest | null) => void,
) {
  return render(
    <DeletionPanel
      lang="nl"
      organizationId={ORG_ID}
      organizationName={ORG_NAME}
      callerRole={role}
      coordinator={coordinator as unknown as DeletionRequestCoordinator}
      onRequestChange={onRequestChange}
    />,
  );
}

async function openAssessed(coordinator: FakeCoordinator, role?: OrganizationRole) {
  const utils = mount(coordinator, role);
  fireEvent.click(screen.getByTestId('deletion-start-btn'));
  await screen.findByTestId('deletion-assessed');
  return utils;
}

beforeEach(() => {
  vi.mocked(downloadOrganizationExportFile).mockClear();
});
afterEach(cleanup);

describe('DeletionPanel: rolgrens', () => {
  it.each(['organizationAdmin', 'coach', 'scorer', 'viewer'] as const)(
    'rendert niets voor %s, en roept de coordinator nooit aan',
    (role) => {
      const coordinator = fake();
      mount(coordinator, role);
      expect(screen.queryByTestId('deletion-panel')).toBeNull();
      expect(coordinator.assess).not.toHaveBeenCalled();
    },
  );

  it('toont voor de owner alleen een startknop, zonder iets aan te roepen', () => {
    const coordinator = fake();
    mount(coordinator);
    expect(screen.getByTestId('deletion-start-btn')).toBeTruthy();
    expect(coordinator.assess).not.toHaveBeenCalled();
    expect(coordinator.request).not.toHaveBeenCalled();
  });
});

describe('DeletionPanel: beoordeling', () => {
  it('toont het opruimoverzicht als aantallen', async () => {
    await openAssessed(fake());
    expect(screen.getByTestId('deletion-cleanup-tombstones').textContent).toContain(': 2');
    expect(screen.getByTestId('deletion-cleanup-invitations-pending').textContent).toContain(': 3');
    expect(screen.getByTestId('deletion-cleanup-invitations-accepted').textContent).toContain(
      ': 0',
    );
    expect(screen.getByTestId('deletion-cleanup-invitations-claimed').textContent).toContain(': 4');
    expect(screen.getByTestId('deletion-cleanup-invitations-revoked').textContent).toContain(': 1');
    expect(screen.getByTestId('deletion-cleanup-abandoned-games').textContent).toContain(': 5');
    expect(screen.getByTestId('deletion-cleanup-migration-runs').textContent).toContain(': 6');
  });

  it('roept assess aan met de organisatie-ID', async () => {
    const coordinator = fake();
    await openAssessed(coordinator);
    expect(coordinator.assess).toHaveBeenCalledWith(ORG_ID);
  });

  it('een harde blokkade toont de reden en schakelt de aanvraagknop uit', async () => {
    await openAssessed(
      fake(
        assessedOutcome({
          blockers: [{ code: 'recent-active-game', teamId: 'team-1', gameId: 'g-live' }],
        }),
      ),
    );
    expect(screen.getByTestId('deletion-blocker-recent-active-game').textContent).toContain(
      'g-live',
    );
    expect((screen.getByTestId('deletion-request-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('een niet-terminale migratierun blokkeert met eigen tekst', async () => {
    await openAssessed(
      fake(
        assessedOutcome({
          blockers: [{ code: 'migration-run-not-terminal', teamId: 'team-1', runId: 'run-9' }],
        }),
      ),
    );
    expect(screen.getByTestId('deletion-blocker-migration-run-not-terminal').textContent).toContain(
      'run-9',
    );
    expect((screen.getByTestId('deletion-request-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('onafgeronde wedstrijden zonder recente activiteit vragen om een bevestiging vóór de aanvraagknop werkt', async () => {
    await openAssessed(fake(assessedOutcome({ stale: 2 })));
    const button = screen.getByTestId('deletion-request-btn') as HTMLButtonElement;
    expect(screen.getByTestId('deletion-stale').textContent).toContain('2');
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('deletion-stale-ack'));
    expect(button.disabled).toBe(false);
    fireEvent.click(screen.getByTestId('deletion-stale-ack'));
    expect(button.disabled).toBe(true);
  });

  it('toont het aantal team-only leden met de opdracht hen zelf te informeren', async () => {
    await openAssessed(fake(assessedOutcome({ teamOnly: 3 })));
    expect(screen.getByTestId('deletion-team-only').textContent).toContain('3');
  });

  it('toont geen team-only melding wanneer er geen zijn', async () => {
    await openAssessed(fake());
    expect(screen.queryByTestId('deletion-team-only')).toBeNull();
  });

  it.each([
    ['denied', { status: 'denied' } as DeletionAssessmentOutcome, 'alleen de eigenaar'],
    [
      'organisatie niet gevonden',
      { status: 'failed', reason: 'organization-not-found' } as DeletionAssessmentOutcome,
      'niet gevonden',
    ],
    [
      'leesfout',
      { status: 'failed', reason: 'read-failed' } as DeletionAssessmentOutcome,
      'mislukt',
    ],
  ])('een %s eindigt in een foutmelding', async (_naam, outcome, tekst) => {
    mount(fake(outcome));
    fireEvent.click(screen.getByTestId('deletion-start-btn'));
    const error = await screen.findByTestId('deletion-error');
    expect(error.textContent?.toLowerCase()).toContain(tekst);
  });

  it('een gooiende coordinator eindigt in een generieke fout, niet in een crash', async () => {
    const coordinator = fake();
    coordinator.assess.mockRejectedValue(new Error('boom'));
    mount(coordinator);
    fireEvent.click(screen.getByTestId('deletion-start-btn'));
    await screen.findByTestId('deletion-error');
  });
});

describe('DeletionPanel: aanvragen', () => {
  async function openDialog(coordinator = fake(), assess?: DeletionAssessmentOutcome) {
    if (assess) coordinator.assess.mockResolvedValue(assess);
    await openAssessed(coordinator);
    const trigger = screen.getByTestId('deletion-request-btn');
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByTestId('deletion-request-dialog');
    return { coordinator, trigger };
  }

  it('de bevestigingsknop blijft uitgeschakeld tot de exacte organisatienaam is getypt', async () => {
    await openDialog();
    const confirm = screen.getByTestId('deletion-request-dialog-confirm') as HTMLButtonElement;
    const input = screen.getByTestId('deletion-request-dialog-input') as HTMLInputElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.input(input, { target: { value: 'De Adelaars' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.input(input, { target: { value: ORG_NAME } });
    expect(confirm.disabled).toBe(false);
  });

  it('een aanvraag zonder getypte bevestiging roept de coordinator nooit aan', async () => {
    const { coordinator } = await openDialog();
    fireEvent.click(screen.getByTestId('deletion-request-dialog-confirm'));
    expect(coordinator.request).not.toHaveBeenCalled();
  });

  it('een geslaagde aanvraag toont de status, de gevoelige-inhoudwaarschuwing en een downloadknop', async () => {
    const changes: (DeletionRequest | null)[] = [];
    const coordinator = fake();
    mount(coordinator, 'organizationOwner', (r) => changes.push(r));
    fireEvent.click(screen.getByTestId('deletion-start-btn'));
    await screen.findByTestId('deletion-assessed');
    fireEvent.click(screen.getByTestId('deletion-request-btn'));
    fireEvent.input(await screen.findByTestId('deletion-request-dialog-input'), {
      target: { value: ORG_NAME },
    });
    fireEvent.click(screen.getByTestId('deletion-request-dialog-confirm'));

    await screen.findByTestId('deletion-submitted');
    expect(coordinator.request).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      acknowledgedStaleGames: false,
    });
    expect(screen.queryByTestId('deletion-request-dialog')).toBeNull();
    expect(screen.getByTestId('deletion-status').textContent).toContain('handmatig');
    expect(screen.getByTestId('deletion-sensitive-warning')).toBeTruthy();
    expect(changes.at(-1)?.status).toBe('requested');
  });

  it('geeft de bevestiging van verlaten wedstrijden door aan de coordinator', async () => {
    const coordinator = fake(assessedOutcome({ stale: 1 }));
    await openAssessed(coordinator);
    fireEvent.click(screen.getByTestId('deletion-stale-ack'));
    fireEvent.click(screen.getByTestId('deletion-request-btn'));
    fireEvent.input(await screen.findByTestId('deletion-request-dialog-input'), {
      target: { value: ORG_NAME },
    });
    fireEvent.click(screen.getByTestId('deletion-request-dialog-confirm'));
    await screen.findByTestId('deletion-submitted');
    expect(coordinator.request).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      acknowledgedStaleGames: true,
    });
  });

  it('downloadt de export uitsluitend na een expliciete klik, met een bestandsnaam', async () => {
    const coordinator = fake();
    await openAssessed(coordinator);
    fireEvent.click(screen.getByTestId('deletion-request-btn'));
    fireEvent.input(await screen.findByTestId('deletion-request-dialog-input'), {
      target: { value: ORG_NAME },
    });
    fireEvent.click(screen.getByTestId('deletion-request-dialog-confirm'));
    await screen.findByTestId('deletion-submitted');
    expect(downloadOrganizationExportFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('deletion-download-btn'));
    expect(downloadOrganizationExportFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadOrganizationExportFile).mock.calls[0]?.[1]).toMatch(/\.json$/);
    expect(screen.getByTestId('deletion-downloaded')).toBeTruthy();
  });

  describe('uitkomsten van een mislukte aanvraag', () => {
    async function submit(coordinator: FakeCoordinator) {
      await openAssessed(coordinator);
      fireEvent.click(screen.getByTestId('deletion-request-btn'));
      fireEvent.input(await screen.findByTestId('deletion-request-dialog-input'), {
        target: { value: ORG_NAME },
      });
      fireEvent.click(screen.getByTestId('deletion-request-dialog-confirm'));
    }

    it('blocked: sluit de dialoog en leest de situatie opnieuw in', async () => {
      const coordinator = fake(assessedOutcome(), {
        status: 'blocked',
        blockers: [{ code: 'recent-active-game', teamId: 'team-1', gameId: 'g-live' }],
      });
      await submit(coordinator);
      await waitFor(() => expect(coordinator.assess).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId('deletion-request-dialog')).toBeNull();
    });

    it('needs-acknowledgement: sluit de dialoog en toont een melding', async () => {
      const coordinator = fake(assessedOutcome(), {
        status: 'needs-acknowledgement',
        staleGameCount: 1,
      });
      await submit(coordinator);
      expect((await screen.findByTestId('deletion-notice')).textContent).toContain('Bevestig');
      expect(screen.queryByTestId('deletion-request-dialog')).toBeNull();
    });

    it('already-open: leest opnieuw in en meldt dat er al een verzoek is', async () => {
      const coordinator = fake(assessedOutcome(), { status: 'already-open', request: request() });
      await submit(coordinator);
      await waitFor(() => expect(coordinator.assess).toHaveBeenCalledTimes(2));
      expect((await screen.findByTestId('deletion-notice')).textContent).toContain('al een');
    });

    it('clock-behind: houdt de dialoog open met een eigen uitleg over de klok', async () => {
      const coordinator = fake(assessedOutcome(), {
        status: 'clock-behind',
        previousExportedAt: '2026-09-29T12:00:00.000Z',
      });
      await submit(coordinator);
      expect((await screen.findByTestId('deletion-request-dialog-error')).textContent).toContain(
        'klok',
      );
      expect(screen.getByTestId('deletion-request-dialog')).toBeTruthy();
    });

    it.each([
      ['rejected', 'geweigerd'],
      ['timeout', 'Geen antwoord'],
      ['readback-failed', 'teruggelezen'],
      ['not-signed-in', 'niet ingelogd'],
    ] as const)(
      'write-failed (%s): sluit de dialoog, leest de status opnieuw en toont een eigen melding',
      async (code, tekst) => {
        const coordinator = fake(assessedOutcome(), {
          status: 'write-failed',
          error: code === 'readback-failed' ? { code, detail: 'x' } : ({ code } as never),
        });
        await submit(coordinator);
        await waitFor(() => expect(coordinator.assess).toHaveBeenCalledTimes(2));
        expect((await screen.findByTestId('deletion-notice')).textContent).toContain(tekst);
        expect(screen.queryByTestId('deletion-request-dialog')).toBeNull();
      },
    );

    it('failed/roundtripFailed: houdt de dialoog open met een eigen melding', async () => {
      const coordinator = fake(assessedOutcome(), { status: 'failed', reason: 'roundtripFailed' });
      await submit(coordinator);
      expect((await screen.findByTestId('deletion-request-dialog-error')).textContent).toContain(
        'geverifieerd',
      );
    });

    it('denied: eindigt in een foutmelding', async () => {
      const coordinator = fake(assessedOutcome(), { status: 'denied' });
      await submit(coordinator);
      await screen.findByTestId('deletion-error');
    });

    it('een gooiende coordinator laat de dialoog open met een generieke fout', async () => {
      const coordinator = fake();
      coordinator.request.mockRejectedValue(new Error('boom'));
      await submit(coordinator);
      await screen.findByTestId('deletion-request-dialog-error');
    });
  });

  describe('toegankelijkheid van de dialoog', () => {
    it('is een modaal dialoog met een naam', async () => {
      await openDialog();
      const dialog = screen.getByTestId('deletion-request-dialog');
      expect(dialog.getAttribute('role')).toBe('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-label')).toBeTruthy();
    });

    it('verplaatst de focus naar binnen bij openen en geeft die terug aan de knop bij sluiten', async () => {
      const { trigger } = await openDialog();
      const dialog = screen.getByTestId('deletion-request-dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('deletion-request-dialog')).toBeNull());
      expect(document.activeElement).toBe(trigger);
    });

    it('Escape sluit zonder de coordinator aan te roepen', async () => {
      const { coordinator } = await openDialog();
      fireEvent.keyDown(screen.getByTestId('deletion-request-dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('deletion-request-dialog')).toBeNull());
      expect(coordinator.request).not.toHaveBeenCalled();
    });

    it('een klik op de achtergrond sluit, een klik in het dialoog niet', async () => {
      await openDialog();
      fireEvent.click(screen.getByTestId('deletion-request-dialog-input'));
      expect(screen.getByTestId('deletion-request-dialog')).toBeTruthy();
      fireEvent.click(screen.getByTestId('deletion-request-dialog'));
      await waitFor(() => expect(screen.queryByTestId('deletion-request-dialog')).toBeNull());
    });

    it('de terugknop sluit zonder aanvraag', async () => {
      const { coordinator } = await openDialog();
      fireEvent.click(screen.getByTestId('deletion-request-dialog-back'));
      await waitFor(() => expect(screen.queryByTestId('deletion-request-dialog')).toBeNull());
      expect(coordinator.request).not.toHaveBeenCalled();
    });

    it('tijdens de aanvraag sluit niets het dialoog (Escape, achtergrond en terugknop)', async () => {
      let resolve!: (o: DeletionRequestOutcome) => void;
      const coordinator = fake();
      coordinator.request.mockReturnValue(
        new Promise<DeletionRequestOutcome>((r) => {
          resolve = r;
        }),
      );
      await openAssessed(coordinator);
      fireEvent.click(screen.getByTestId('deletion-request-btn'));
      fireEvent.input(await screen.findByTestId('deletion-request-dialog-input'), {
        target: { value: ORG_NAME },
      });
      fireEvent.click(screen.getByTestId('deletion-request-dialog-confirm'));

      const dialog = screen.getByTestId('deletion-request-dialog');
      expect(
        (screen.getByTestId('deletion-request-dialog-back') as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId('deletion-request-dialog-confirm') as HTMLButtonElement).disabled,
      ).toBe(true);
      fireEvent.keyDown(dialog, { key: 'Escape' });
      fireEvent.click(dialog);
      expect(screen.getByTestId('deletion-request-dialog')).toBeTruthy();

      resolve({ status: 'ok', request: request(), export: EXPORT });
      await screen.findByTestId('deletion-submitted');
    });
  });
});

describe('DeletionPanel: bestaand verzoek', () => {
  it('requested: toont de status en een annuleerknop, en geen aanvraagknop', async () => {
    await openAssessed(fake(assessedOutcome({ existing: request() })));
    expect(screen.getByTestId('deletion-status').textContent).toContain('handmatig');
    expect(screen.getByTestId('deletion-cancel-request-btn')).toBeTruthy();
    expect(screen.queryByTestId('deletion-request-btn')).toBeNull();
  });

  it('annuleren: vraagt bevestiging, roept cancel aan en leest daarna opnieuw in', async () => {
    const changes: (DeletionRequest | null)[] = [];
    const coordinator = fake(assessedOutcome({ existing: request() }));
    mount(coordinator, 'organizationOwner', (r) => changes.push(r));
    fireEvent.click(screen.getByTestId('deletion-start-btn'));
    await screen.findByTestId('deletion-assessed');
    fireEvent.click(screen.getByTestId('deletion-cancel-request-btn'));
    await screen.findByTestId('deletion-cancel-dialog');
    // annuleren vraagt GEEN typebevestiging
    expect(screen.queryByTestId('deletion-cancel-dialog-input')).toBeNull();
    expect(coordinator.cancel).not.toHaveBeenCalled();

    coordinator.assess.mockResolvedValue(
      assessedOutcome({
        existing: request({
          status: 'cancelled',
          revision: 1,
          cancelledAt: '2026-09-29T13:00:00.000Z',
        }),
      }),
    );
    fireEvent.click(screen.getByTestId('deletion-cancel-dialog-confirm'));
    await waitFor(() => expect(coordinator.cancel).toHaveBeenCalledWith(ORG_ID));
    await waitFor(() => expect(coordinator.assess).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId('deletion-notice')).textContent).toContain('geannuleerd');
    expect(changes.some((c) => c?.status === 'cancelled')).toBe(true);
  });

  it('het annuleerdialoog sluit met Escape zonder te annuleren en geeft de focus terug', async () => {
    const coordinator = fake(assessedOutcome({ existing: request() }));
    await openAssessed(coordinator);
    const trigger = screen.getByTestId('deletion-cancel-request-btn');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByTestId('deletion-cancel-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('deletion-cancel-dialog')).toBeNull());
    expect(coordinator.cancel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('cancelled: de owner kan opnieuw een verzoek indienen (herstart)', async () => {
    await openAssessed(
      fake(
        assessedOutcome({
          existing: request({
            status: 'cancelled',
            revision: 1,
            cancelledAt: '2026-09-29T13:00:00.000Z',
          }),
        }),
      ),
    );
    expect(screen.getByTestId('deletion-status').textContent).toContain('geannuleerd');
    expect(screen.queryByTestId('deletion-cancel-request-btn')).toBeNull();
    expect((screen.getByTestId('deletion-request-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ['executing', 'bezig'],
    ['failed', 'onderbroken'],
    ['completed', 'afgerond'],
  ] as const)(
    '%s: toont alleen de status, zonder annuleer- of aanvraagknop',
    async (status, tekst) => {
      await openAssessed(fake(assessedOutcome({ existing: request({ status }) })));
      expect(screen.getByTestId('deletion-status').textContent).toContain(tekst);
      expect(screen.queryByTestId('deletion-cancel-request-btn')).toBeNull();
      expect(screen.queryByTestId('deletion-request-btn')).toBeNull();
    },
  );

  it('een mislukte annulering (rejected) leest de status opnieuw in en meldt dat', async () => {
    const coordinator = fake(assessedOutcome({ existing: request() }), undefined, {
      status: 'write-failed',
      error: { code: 'rejected' },
    });
    await openAssessed(coordinator);
    fireEvent.click(screen.getByTestId('deletion-cancel-request-btn'));
    fireEvent.click(await screen.findByTestId('deletion-cancel-dialog-confirm'));
    await waitFor(() => expect(coordinator.assess).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId('deletion-notice')).textContent).toContain('geweigerd');
  });
});
