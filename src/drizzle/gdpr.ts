/**
 * Ledger GDPR - Drizzle Adapter
 *
 * Drizzle-coupled GDPR purge functions.
 */

import { eq, or } from "drizzle-orm";
import { anonymizeJsonData, DEFAULT_PII_FIELDS } from "../core/gdpr.js";
import type { PurgeConfig, PurgeResult } from "../core/gdpr.js";
import type { AuditLog } from "./schema/sqlite.js";

// Re-export pure helpers from core for convenience
export {
  anonymizeJsonData,
  DEFAULT_PII_FIELDS,
  type PurgeConfig,
  type PurgeResult,
} from "../core/gdpr.js";

/** Default replacement value for userId */
const DEFAULT_ANONYMIZED_USER_ID = "PURGED_USER";

/**
 * Parse a stored JSON column, distinguishing "column is NULL" and
 * "parsed successfully" from "stored text is not valid JSON".
 * Malformed JSON must be left byte-for-byte untouched by the purge,
 * never overwritten -- so the caller needs to know parsing failed.
 */
function parseStoredJson(json: string | null): { ok: true; value: unknown } | { ok: false } {
  if (json === null) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false };
  }
}

/**
 * Serialize an anonymized value back to the stored column shape.
 * A NULL column round-trips as NULL; everything else (objects, arrays,
 * primitives) round-trips as its JSON text.
 */
function serializeAnonymized(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return JSON.stringify(value);
}

// Type for Drizzle database with update capability
// biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle db type compatibility
type DrizzleDb = { update: (table: any) => any; select: () => any };

/**
 * Anonymize all user data in audit logs.
 * Does NOT delete records - preserves audit trail with PII removed.
 *
 * This function:
 * 1. Finds all audit entries for the user (by userId OR recordId)
 * 2. Replaces userId with anonymized value (only for entries created by the user)
 * 3. Nullifies ip and userAgent (only for entries created by the user)
 * 4. Removes PII fields from oldData/newData JSON
 * 5. Preserves non-PII audit data (tableName, action, timestamps)
 *
 * @param db - Drizzle database instance
 * @param auditTable - The audit log table
 * @param userId - User ID to purge
 * @param config - Optional configuration
 * @returns Result with count of affected records
 *
 * @example
 * ```typescript
 * import { purgeUserData } from '@rafters/ledger/gdpr';
 * import { auditLog } from '@rafters/ledger';
 *
 * const result = await purgeUserData(db, auditLog, 'user-123', {
 *   piiFields: ['email', 'name', 'ip', 'address', 'phone'],
 * });
 *
 * console.log(`Anonymized ${result.entriesAnonymized} audit entries`);
 * ```
 */
export async function purgeUserData(
  db: DrizzleDb,
  auditTable: AuditLog,
  userId: string,
  config?: PurgeConfig,
): Promise<PurgeResult> {
  const piiFields = config?.piiFields ?? DEFAULT_PII_FIELDS;
  const anonymizedUserId = config?.anonymizedUserId ?? DEFAULT_ANONYMIZED_USER_ID;

  // Find all audit entries for this user
  // Match by userId (who performed action) OR recordId (the user's record)
  const entries = await db
    .select()
    .from(auditTable)
    .where(or(eq(auditTable.userId, userId), eq(auditTable.recordId, userId)));

  if (entries.length === 0) {
    return {
      entriesAnonymized: 0,
      tablesProcessed: [],
    };
  }

  // Track unique tables processed
  const tablesProcessed = new Set<string>();
  let entriesAnonymized = 0;

  // Process each entry
  for (const entry of entries) {
    tablesProcessed.add(entry.tableName);

    // Parse and anonymize JSON data. Stored text that fails to parse is
    // left untouched -- the purge must never destroy entries it cannot read.
    const oldParsed = parseStoredJson(entry.oldData);
    const newParsed = parseStoredJson(entry.newData);

    const anonymizedOldData = oldParsed.ok
      ? serializeAnonymized(anonymizeJsonData(oldParsed.value, piiFields))
      : entry.oldData;
    const anonymizedNewData = newParsed.ok
      ? serializeAnonymized(anonymizeJsonData(newParsed.value, piiFields))
      : entry.newData;

    // Update the entry
    // Only anonymize userId/ip/userAgent when entry.userId matches the purged user
    // This preserves admin PII when they modified the user's record
    // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle ORM dynamic operations
    await (db.update(auditTable) as any)
      .set({
        userId: entry.userId === userId ? anonymizedUserId : entry.userId,
        ip: entry.userId === userId ? null : entry.ip,
        userAgent: entry.userId === userId ? null : entry.userAgent,
        oldData: anonymizedOldData,
        newData: anonymizedNewData,
      })
      .where(eq(auditTable.id, entry.id));

    entriesAnonymized++;
  }

  return {
    entriesAnonymized,
    tablesProcessed: Array.from(tablesProcessed),
  };
}

/**
 * Check if a user's data has already been purged.
 * Useful for idempotency checks.
 *
 * @param db - Drizzle database instance
 * @param auditTable - The audit log table
 * @param userId - User ID to check
 * @returns true if no audit entries exist with this userId
 */
export async function isUserDataPurged(
  db: DrizzleDb,
  auditTable: AuditLog,
  userId: string,
): Promise<boolean> {
  const entries = await db.select().from(auditTable).where(eq(auditTable.userId, userId));

  return entries.length === 0;
}
