/**
 * Ledger GDPR - Pure Helpers
 *
 * ORM-agnostic GDPR compliance utilities.
 */

/**
 * Configuration for GDPR purge operation.
 */
export interface PurgeConfig {
  /** Fields to remove from JSON data columns (defaults to common PII fields) */
  piiFields?: string[];
  /** Replacement value for userId (default: 'PURGED_USER') */
  anonymizedUserId?: string;
}

/**
 * Result of a GDPR purge operation.
 */
export interface PurgeResult {
  /** Number of audit entries anonymized */
  entriesAnonymized: number;
  /** Tables that had audit entries anonymized */
  tablesProcessed: string[];
}

/** Default PII fields to remove from JSON data */
export const DEFAULT_PII_FIELDS = [
  "email",
  "name",
  "firstName",
  "lastName",
  "phone",
  "address",
  "ip",
  "ipAddress",
  "userAgent",
];

/**
 * Remove PII fields from a JSON value.
 * Recursively processes nested objects and arrays; arrays stay arrays
 * at every depth. Field matching is case-insensitive on the exact key
 * name ('email' removes 'Email' and 'EMAIL', but not 'user_email' or
 * 'emails' -- list structural variants explicitly).
 *
 * Limitation: this removes matching keys only. PII embedded inside the
 * VALUE of a non-matching key (an address in a free-text 'notes' field,
 * an email inside a message body) is out of reach -- payloads with prose
 * need field-level purging by the caller.
 *
 * @param data - The JSON value to anonymize
 * @param piiFields - Field names to remove (case-insensitive)
 * @returns Anonymized value with PII fields removed
 *
 * @example
 * ```typescript
 * const data = { id: '123', Email: 'test@test.com', name: 'John', role: 'admin' };
 * const result = anonymizeJsonData(data, ['email', 'name']);
 * // { id: '123', role: 'admin' }
 * ```
 */
export function anonymizeJsonData(
  data: Record<string, unknown> | null,
  piiFields: string[],
): Record<string, unknown> | null;
export function anonymizeJsonData(data: unknown, piiFields: string[]): unknown;
export function anonymizeJsonData(data: unknown, piiFields: string[]): unknown {
  const loweredFields = new Set(piiFields.map((field) => field.toLowerCase()));
  return anonymizeValue(data, loweredFields);
}

function anonymizeValue(value: unknown, loweredFields: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => anonymizeValue(item, loweredFields));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (loweredFields.has(key.toLowerCase())) {
        continue;
      }
      result[key] = anonymizeValue(entry, loweredFields);
    }
    return result;
  }

  return value;
}
