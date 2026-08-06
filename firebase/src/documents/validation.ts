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
    throw new DocumentValidationError(documentType, field, `moet een string zijn, kreeg ${typeof value}`);
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
    throw new DocumentValidationError(documentType, field, `moet een e-mailadres zijn, kreeg "${s}"`);
  }
  return s;
}

export function assertBoolean(documentType: string, field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new DocumentValidationError(documentType, field, `moet een boolean zijn, kreeg ${typeof value}`);
  }
  return value;
}

export function assertNumber(documentType: string, field: string, value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new DocumentValidationError(documentType, field, `moet een getal zijn, kreeg ${typeof value}`);
  }
  return value;
}

export function assertTimestamp(documentType: string, field: string, value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) {
    throw new DocumentValidationError(documentType, field, 'moet een Firestore Timestamp zijn');
  }
  return value;
}

export function assertNullableTimestamp(documentType: string, field: string, value: unknown): Timestamp | null {
  if (value === null) return null;
  return assertTimestamp(documentType, field, value);
}

export function assertOptionalTimestamp(documentType: string, field: string, value: unknown): Timestamp | undefined {
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
    throw new DocumentValidationError(documentType, field, `moet één van [${allowed.join(', ')}] zijn, kreeg "${s}"`);
  }
  return s as T;
}
