import type { DiagnosticEvent } from '../../domain/diagnostics/types';

export interface DiagnosticsPort {
  /** Retourneert false wanneer de fail-closed sanitizer invoer weigert. */
  record(value: unknown): boolean;
  snapshot(): readonly DiagnosticEvent[];
  clear(): void;
  subscribe(listener: (events: readonly DiagnosticEvent[]) => void): () => void;
}
