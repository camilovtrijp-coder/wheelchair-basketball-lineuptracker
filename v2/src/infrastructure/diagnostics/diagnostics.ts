import type { DiagnosticsPort } from '../../application/diagnostics/DiagnosticsPort';
import {
  buildDiagnosticsExport,
  sanitizeDiagnosticInput,
  type DiagnosticEvent,
} from '../../domain/diagnostics/types';

export const MAX_DIAGNOSTIC_EVENTS = 50;

export class InMemoryDiagnostics implements DiagnosticsPort {
  private events: DiagnosticEvent[] = [];
  private readonly listeners = new Set<(events: readonly DiagnosticEvent[]) => void>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly maxEvents: number = MAX_DIAGNOSTIC_EVENTS,
  ) {}

  record(value: unknown): boolean {
    const safe = sanitizeDiagnosticInput(value);
    if (!safe) return false;
    this.events = [...this.events, { ...safe, occurredAt: this.now().toISOString() }].slice(
      -this.maxEvents,
    );
    this.emit();
    return true;
  }

  snapshot(): readonly DiagnosticEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  clear(): void {
    this.events = [];
    this.emit();
  }

  subscribe(listener: (events: readonly DiagnosticEvent[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Gedeelde, uitsluitend in-memory sessiebuffer; schrijft geen browseropslag. */
export const diagnostics = new InMemoryDiagnostics();

export function downloadDiagnostics(
  events: readonly DiagnosticEvent[],
  now: Date = new Date(),
): void {
  const payload = buildDiagnosticsExport(events, now);
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lineup-tracker-diagnostics-${now.toISOString().slice(0, 10).replaceAll('-', '')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
