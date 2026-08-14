import { Timestamp } from 'firebase/firestore';

/**
 * Gegooid door elke `fromFirestore()` wanneer serverdata niet aan het
 * documentcontract voldoet. Review-opvolging #29 (P2): de converters waren
 * type-projecties (een `as`-achtige aanname), geen runtime-decoders —
 * `snapshot.data()` levert ongevalideerde `DocumentData`. Deze helpers dwingen
 * elk veld af vóór het als het getypte document wordt teruggegeven, zodat een
 * consumer (bijv. de repository-adapters in PR 5.3) nooit stilzwijgend een
 * corrupt of onvolledig object krijgt.
 */
export class DocumentValidationError extends Error {
  constructor(documentType: string, field: string, detail: string) {
    super(`${documentType}: veld "${field}" ${detail}`);
    this.name = 'DocumentValidationError';
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assertString(documentType: string, field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new DocumentValidationError(
      documentType,
      field,
      `moet een string zijn, kreeg ${typeof value}`,
    );
  }
  return value;
}

export function assertNonEmptyString(documentType: string, field: string, value: unknown): string {
  const s = assertString(documentType, field, value);
  if (s.trim() === '') {
    throw new DocumentValidationError(documentType, field, 'mag niet leeg zijn');
  }
  return s;
}

export function assertEmail(documentType: string, field: string, value: unknown): string {
  const s = assertNonEmptyString(documentType, field, value);
  if (!s.includes('@')) {
    throw new DocumentValidationError(
      documentType,
      field,
      `moet een e-mailadres zijn, kreeg "${s}"`,
    );
  }
  return s;
}

export function assertBoolean(documentType: string, field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new DocumentValidationError(
      documentType,
      field,
      `moet een boolean zijn, kreeg ${typeof value}`,
    );
  }
  return value;
}

export function assertNumber(documentType: string, field: string, value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new DocumentValidationError(
      documentType,
      field,
      `moet een getal zijn, kreeg ${typeof value}`,
    );
  }
  return value;
}

export function assertInteger(documentType: string, field: string, value: unknown): number {
  const n = assertNumber(documentType, field, value);
  if (!Number.isInteger(n)) {
    throw new DocumentValidationError(
      documentType,
      field,
      `moet een geheel getal zijn, kreeg ${n}`,
    );
  }
  return n;
}

export function assertStringArray(documentType: string, field: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new DocumentValidationError(documentType, field, 'moet een array van strings zijn');
  }
  return value;
}

export function assertNullableStringArray(
  documentType: string,
  field: string,
  value: unknown,
): string[] | null {
  if (value === null) return null;
  return assertStringArray(documentType, field, value);
}

export function assertNullableString(
  documentType: string,
  field: string,
  value: unknown,
): string | null {
  if (value === null) return null;
  return assertString(documentType, field, value);
}

/**
 * Review-opvolging PR 7.1a (externe review, aug. 2026): een niet-lege string
 * is geen geldig ISO-tijdstip — `assertNonEmptyString` liet bijv.
 * `"dit-is-geen-tijdstip"` ongemoeid door voor client-autoritatieve
 * tijdvelden (`GameDocument.createdAt`/`startedAt`,
 * `GameActionEnvelopeDocument.occurredAt` — bewust géén Firestore
 * `Timestamp`, zie de toelichting bij die documenten).
 *
 * Tweede review-opvolging PR 7.1a (externe review, aug. 2026): een kale
 * `Date.parse()`-check bewijst niet dat de invoer een geldige ISO-string is —
 * `Date.parse()` accepteert ook niet-ISO-formaten zoals `"January 1, 2026"`,
 * en normaliseert een onmogelijke kalenderdatum zoals
 * `"2026-02-31T00:00:00.000Z"` stilzwijgend naar 3 maart in plaats van te
 * weigeren. De applicatie produceert deze velden zelf altijd canoniek via
 * `Date.prototype.toISOString()` (zie `ActiveGame.createdAt`/`startedAt` en
 * `GameAction.at`), dus een strikte round-trip-eis — geparste waarde exact
 * gelijk aan `toISOString()` van diezelfde waarde — weigert zowel
 * niet-ISO-formaten als ongeldige kalenderdata, terwijl elke echt door de
 * applicatie geschreven waarde ongewijzigd blijft accepteren.
 */
export function assertIsoTimestampString(
  documentType: string,
  field: string,
  value: unknown,
): string {
  const s = assertNonEmptyString(documentType, field, value);
  const ms = Date.parse(s);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== s) {
    throw new DocumentValidationError(
      documentType,
      field,
      `moet een geldige ISO-tijdstip-string zijn, kreeg "${s}"`,
    );
  }
  return s;
}

export function assertNullableIsoTimestampString(
  documentType: string,
  field: string,
  value: unknown,
): string | null {
  if (value === null) return null;
  return assertIsoTimestampString(documentType, field, value);
}

/**
 * Review-opvolging PR 7.1a: contextvelden (`organizationId`/`teamId`/
 * `gameId`/`actionId`) werden alleen op aanwezigheid/type gecontroleerd, niet
 * tegen het daadwerkelijke Firestore-pad van het document — een document kon
 * dus geldige, maar voor het pad VERKEERDE context-ID's dragen. `pathSegments()`
 * splitst `snapshot.ref.path` (bijv.
 * `organizations/org-1/teams/team-1/games/game-1`) in de losse padsegmenten;
 * `assertPathContextField()` weigert een veld dat niet overeenkomt met het
 * segment op de verwachte positie.
 */
export function pathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

export function assertPathContextField(
  documentType: string,
  field: string,
  value: string,
  pathSegment: string | undefined,
): string {
  if (value !== pathSegment) {
    throw new DocumentValidationError(
      documentType,
      field,
      `komt niet overeen met het Firestore-pad (veld "${value}", pad-segment "${pathSegment ?? '(ontbreekt)'}")`,
    );
  }
  return value;
}

export function assertTimestamp(documentType: string, field: string, value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) {
    throw new DocumentValidationError(documentType, field, 'moet een Firestore Timestamp zijn');
  }
  return value;
}

export function assertNullableTimestamp(
  documentType: string,
  field: string,
  value: unknown,
): Timestamp | null {
  if (value === null) return null;
  return assertTimestamp(documentType, field, value);
}

export function assertOptionalTimestamp(
  documentType: string,
  field: string,
  value: unknown,
): Timestamp | undefined {
  if (value === undefined) return undefined;
  return assertTimestamp(documentType, field, value);
}

export function assertOptionalNonEmptyString(
  documentType: string,
  field: string,
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  return assertNonEmptyString(documentType, field, value);
}

export function assertOneOf<T extends string>(
  documentType: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  const s = assertString(documentType, field, value);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new DocumentValidationError(
      documentType,
      field,
      `moet één van [${allowed.join(', ')}] zijn, kreeg "${s}"`,
    );
  }
  return s as T;
}
