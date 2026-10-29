/**
 * Compact, veilig diagnoseobject bij een mislukte service-workerregistratie of
 * een uitblijvende `controllerchange` (zie `PwaUpdateAdapter`). Bevat alleen
 * technische gegevens over het EIGEN service-workerbestand: geen body, geen
 * cookies, geen tokens, geen e-mailadressen of andere persoonsgegevens. De
 * eigenaar kan dit als screenshot delen om te zien waarom de registratie
 * op een omgeving (bijv. een Netlify-preview) mislukt.
 */
export interface PwaSwProbeOk {
  ok: true;
  /** HTTP-status; 0 bij een `opaqueredirect` (de server stuurde een redirect). */
  status: number;
  /** `Response.type`: 'basic', 'opaqueredirect', 'opaque', 'cors', … */
  responseType: string;
  contentType: string | null;
  redirected: boolean;
  /**
   * Alleen bij een gewoon antwoord (200, same-origin): omvang en de eerste/laatste
   * tekens van het EIGEN, publieke service-workerbestand. Laat zien of er iets
   * is ingevoegd of afgekapt (bijv. door een proxy of de hostingomgeving).
   */
  bytes?: number;
  head?: string;
  tail?: string;
}

export interface PwaSwProbeFailed {
  ok: false;
  errorName: string;
}

export type PwaSwProbe = PwaSwProbeOk | PwaSwProbeFailed;

export interface PwaErrorDetail {
  phase: 'register' | 'controllerchange';
  swUrl: string;
  swType: 'module' | 'classic';
  errorName?: string;
  errorMessage?: string;
  /** Alleen bij `phase: 'register'`: uitkomst van één same-origin fetch-probe. */
  probe?: PwaSwProbe;
}

/** Ruim genoeg voor de volledige browsermelding; de reden staat vaak ná de URL's. */
export const PWA_ERROR_TEXT_MAX = 600;
/** Aantal tekens van het begin en einde van het sw-bestand in de diagnose. */
export const PWA_SW_SNIPPET_CHARS = 80;

export function truncateDiagnosticText(text: string, max: number = PWA_ERROR_TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Platte tekst voor het uitklapbare blok: één regel per veld, kopieerbaar. */
export function formatPwaErrorDetail(detail: PwaErrorDetail): string {
  const lines: string[] = [`phase: ${detail.phase}`, `script: ${detail.swUrl} (${detail.swType})`];
  if (detail.errorName || detail.errorMessage) {
    lines.push(`error: ${[detail.errorName, detail.errorMessage].filter(Boolean).join(': ')}`);
  }
  if (detail.probe) {
    if (detail.probe.ok) {
      const p = detail.probe;
      lines.push(
        `probe: status ${p.status}, type ${p.responseType}, content-type ${p.contentType ?? '-'}, redirected ${p.redirected ? 'yes' : 'no'}`,
      );
      if (p.bytes !== undefined) lines.push(`bytes: ${p.bytes}`);
      if (p.head !== undefined) lines.push(`head: ${p.head}`);
      if (p.tail !== undefined) lines.push(`tail: ${p.tail}`);
    } else {
      lines.push(`probe: failed (${detail.probe.errorName})`);
    }
  }
  return lines.join('\n');
}
