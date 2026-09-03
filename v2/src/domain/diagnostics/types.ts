export const DIAGNOSTIC_AREAS = [
  'firebase',
  'settings',
  'roster',
  'game',
  'history',
  'pwa',
] as const;

export type DiagnosticArea = (typeof DIAGNOSTIC_AREAS)[number];

export const DIAGNOSTIC_CODES = [
  'app-check-monitoring-enabled',
  'app-check-initialization-failed',
  'settings-listener-failed',
  'roster-listener-failed',
  'game-local-save-failed',
  'history-cloud-read-failed',
  'history-delete-failed',
  'pwa-update-failed',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface DiagnosticInput {
  area: DiagnosticArea;
  code: DiagnosticCode;
}

export interface DiagnosticEvent extends DiagnosticInput {
  occurredAt: string;
}

export interface DiagnosticsExportV1 {
  type: 'lineup-tracker-diagnostics';
  version: 1;
  exportedAt: string;
  privacy: 'allowlisted-technical-codes-only';
  events: DiagnosticEvent[];
}

const allowedAreas = new Set<string>(DIAGNOSTIC_AREAS);
const allowedCodes = new Set<string>(DIAGNOSTIC_CODES);
const allowedKeys = new Set(['area', 'code']);

/**
 * Fail-closed privacygrens: de diagnosepoort accepteert uitsluitend twee
 * allowlistvelden. Een object met een extra `email`, `uid`, `payload`, raw
 * error of willekeurig toekomstig veld wordt volledig geweigerd.
 */
export function sanitizeDiagnosticInput(value: unknown): DiagnosticInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null;
  if (typeof record.area !== 'string' || !allowedAreas.has(record.area)) return null;
  if (typeof record.code !== 'string' || !allowedCodes.has(record.code)) return null;
  return { area: record.area as DiagnosticArea, code: record.code as DiagnosticCode };
}

export function buildDiagnosticsExport(
  events: readonly DiagnosticEvent[],
  now: Date = new Date(),
): DiagnosticsExportV1 {
  return {
    type: 'lineup-tracker-diagnostics',
    version: 1,
    exportedAt: now.toISOString(),
    privacy: 'allowlisted-technical-codes-only',
    events: events.map((event) => ({ ...event })),
  };
}
