// @vitest-environment jsdom
// PR 8.3b deel 2/2 (docs/pr-8.3-plan.md §C 8.3b werk 4): UI-wiringtests
// bovenop deel 1/2's al-geteste engine (`organizationExportBuild.spec.ts`/
// `organizationExportCoordinator.spec.ts`/`organizationExportRoundtrip.spec.ts`)
// — dit bestand bewijst dat de UI de juiste poort aanroept en de juiste
// stappen toont, niet dat de coordinator zelf correct is (dat blijft
// exclusief deel-1/2-scope). Zelfde structuur als `MigrationPanel.spec.tsx`.
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/preact';
import { ExportPanel } from '../../src/ui/export/ExportPanel';
import { OrganizationExportCoordinator } from '../../src/application/export/OrganizationExportCoordinator';
import type {
  OrganizationExportGateway,
  OrganizationExportReadResult,
} from '../../src/application/export/OrganizationExportGateway';
import type { RawOrganizationExportInput } from '../../src/domain/export/build';
import type { OrganizationRole } from '../../src/domain/organizations/types';

const ORG_ID = 'org-1';

function rawInput(overrides: Partial<RawOrganizationExportInput> = {}): RawOrganizationExportInput {
  return {
    organization: {
      id: ORG_ID,
      name: 'De Adelaars Org',
      createdBy: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    organizationMembers: [
      { id: 'uid-owner', role: 'organizationOwner', email: 'owner@example.com' },
    ],
    invitations: [],
    teams: [
      {
        teamId: 'team-1',
        name: 'De Adelaars',
        orgName: 'De Adelaars Org',
        createdBy: 'uid-owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        teamMembers: [],
        settings: null,
        roster: null,
        games: [],
        completedGames: [],
        migrationRuns: [],
      },
    ],
    ...overrides,
  };
}

class FakeGateway implements OrganizationExportGateway {
  constructor(
    private result: OrganizationExportReadResult,
    private caller: { uid: string; role: OrganizationRole } | null = {
      uid: 'uid-owner',
      role: 'organizationOwner',
    },
  ) {}
  async readOrganizationExportInput(): Promise<OrganizationExportReadResult> {
    return this.result;
  }
  async readAuthoritativeCaller(): Promise<{ uid: string; role: OrganizationRole } | null> {
    return this.caller;
  }
}

function makeCoordinator(result: OrganizationExportReadResult) {
  return new OrganizationExportCoordinator(
    new FakeGateway(result),
    () => '2026-09-08T10:00:00.000Z',
  );
}

afterEach(() => cleanup());

describe('ui/export/ExportPanel — rolgrens (§B "alleen organizationOwner")', () => {
  it('rendert helemaal niets voor een coach', () => {
    const coordinator = makeCoordinator({ ok: true, data: rawInput() });
    const { container } = render(
      <ExportPanel
        lang="nl"
        organizationId={ORG_ID}
        organizationName="De Adelaars Org"
        callerRole="coach"
        coordinator={coordinator}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('rendert helemaal niets voor een viewer', () => {
    const coordinator = makeCoordinator({ ok: true, data: rawInput() });
    const { container } = render(
      <ExportPanel
        lang="nl"
        organizationId={ORG_ID}
        organizationName="De Adelaars Org"
        callerRole="viewer"
        coordinator={coordinator}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('ui/export/ExportPanel — happy path (werk 4: preview → download)', () => {
  it('toont doelorganisatie, teams, aantallen en waarschuwing, en downloadt na klik', async () => {
    const coordinator = makeCoordinator({ ok: true, data: rawInput() });
    if (!('createObjectURL' in URL)) {
      // @ts-expect-error jsdom-polyfill voor deze testomgeving
      URL.createObjectURL = () => 'blob:fake';
      // @ts-expect-error jsdom-polyfill voor deze testomgeving
      URL.revokeObjectURL = () => undefined;
    }
    render(
      <ExportPanel
        lang="nl"
        organizationId={ORG_ID}
        organizationName="De Adelaars Org"
        callerRole="organizationOwner"
        coordinator={coordinator}
      />,
    );

    fireEvent.click(screen.getByTestId('export-start-btn'));
    await waitFor(() => expect(screen.getByTestId('export-preview')).toBeTruthy());

    expect(screen.getByTestId('export-preview-target').textContent).toContain('De Adelaars Org');
    expect(screen.getByTestId('export-preview-target').textContent).toContain(ORG_ID);
    expect(screen.getByTestId('export-preview-team-team-1').textContent).toBe('De Adelaars');
    expect(screen.getByTestId('export-preview-count-teams').textContent).toContain('1');
    expect(screen.getByTestId('export-sensitive-warning')).toBeTruthy();

    fireEvent.click(screen.getByTestId('export-download-btn'));
    await waitFor(() => expect(screen.getByTestId('export-downloaded')).toBeTruthy());
  });
});

describe('ui/export/ExportPanel — foutafhandeling (werk 4)', () => {
  it('toont een fout zonder preview wanneer de organisatie niet gevonden is', async () => {
    const coordinator = makeCoordinator({ ok: false, error: { code: 'organization-not-found' } });
    render(
      <ExportPanel
        lang="nl"
        organizationId={ORG_ID}
        organizationName="De Adelaars Org"
        callerRole="organizationOwner"
        coordinator={coordinator}
      />,
    );
    fireEvent.click(screen.getByTestId('export-start-btn'));
    await waitFor(() => expect(screen.getByTestId('export-error')).toBeTruthy());
    expect(screen.queryByTestId('export-preview')).toBeNull();
    expect(screen.getByTestId('export-error').textContent).toContain('niet gevonden');
  });

  it('toont een fout wanneer de gateway een leesfout oplevert', async () => {
    const coordinator = makeCoordinator({
      ok: false,
      error: { code: 'read-failed', detail: new Error('boom') },
    });
    render(
      <ExportPanel
        lang="nl"
        organizationId={ORG_ID}
        organizationName="De Adelaars Org"
        callerRole="organizationOwner"
        coordinator={coordinator}
      />,
    );
    fireEvent.click(screen.getByTestId('export-start-btn'));
    await waitFor(() => expect(screen.getByTestId('export-error')).toBeTruthy());
    expect(screen.queryByTestId('export-preview')).toBeNull();
  });
});
