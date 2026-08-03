/**
 * Ledger GDPR - Drizzle Adapter
 *
 * Drizzle-coupled GDPR purge functions.
 *
 * Scope: the purge covers the AUDIT LOG only. The live user row and the
 * app's domain tables are the caller's responsibility -- "GDPR
 * compliance" from this module alone would be overclaiming.
 */

import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { anonymizeJsonData, DEFAULT_PII_FIELDS } from "../core/gdpr.js";
import type { PurgeConfig, PurgeResult } from "../core/gdpr.js";
import { getLedgerContext } from "../core/context.js";
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

// Type for Drizzle database used by the purge
// biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle db type compatibility
type DrizzleDb = {
  // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle db type compatibility
  update: (table: any) => any;
  select: () => any;
  // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle db type compatibility
  insert: (table: any) => any;
  // biome-ignore lint/suspicious/noExplicitAny: D1/libsql batch API
  batch?: (statements: any[]) => Promise<unknown>;
};

/**
 * Build the audit-entry match condition for a user: entries the user
 * performed (userId), entries about the user's own record (recordId ==
 * userId), and entries about records the user owns (ownedRecords, which
 * catches admin/system actions on the user's data).
 */
function buildUserMatch(
  auditTable: AuditLog,
  userId: string,
  ownedRecords: PurgeConfig["ownedRecords"],
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    eq(auditTable.userId, userId),
    eq(auditTable.recordId, userId),
  ];

  for (const owned of ownedRecords ?? []) {
    if (owned.recordIds.length === 0) {
      continue;
    }
    conditions.push(
      and(eq(auditTable.tableName, owned.tableName), inArray(auditTable.recordId, owned.recordIds)),
    );
  }

  return or(...conditions);
}

/**
 * Anonymize all user data in audit logs.
 * Does NOT delete records - preserves audit trail with PII removed.
 *
 * This function:
 * 1. Finds all audit entries for the user: by userId (actions they
 *    performed), by recordId == userId (their own record), and by
 *    ownedRecords (their records acted on by admins/system)
 * 2. Replaces userId with anonymized value (only for entries created by the user)
 * 3. Nullifies ip and userAgent (only for entries created by the user)
 * 4. Removes PII fields from oldData/newData JSON; unparseable JSON is
 *    left untouched and counted in entriesSkipped
 * 5. Preserves non-PII audit data (tableName, action, timestamps)
 * 6. Executes all updates atomically via db.batch when the driver
 *    provides it (D1/libsql); otherwise sequentially (NOT atomic --
 *    a crash mid-purge leaves a partial purge; re-run to complete)
 * 7. Writes one PURGE audit entry recording that the erasure happened
 *    (counts only, no PII)
 *
 * @param db - Drizzle database instance
 * @param auditTable - The audit log table
 * @param userId - User ID to purge
 * @param config - Optional configuration
 * @returns Result with counts of affected records
 *
 * @example
 * ```typescript
 * import { purgeUserData } from '@rafters/ledger/drizzle';
 *
 * const result = await purgeUserData(db, auditLog, 'user-123', {
 *   piiFields: ['email', 'name', 'subject', 'body', 'to', 'from'],
 *   ownedRecords: [{ tableName: 'messages', recordIds: userMessageIds }],
 * });
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

  const entries = await db
    .select()
    .from(auditTable)
    .where(buildUserMatch(auditTable, userId, config?.ownedRecords));

  if (entries.length === 0) {
    return {
      entriesAnonymized: 0,
      tablesProcessed: [],
      entriesSkipped: 0,
    };
  }

  const tablesProcessed = new Set<string>();
  let entriesSkipped = 0;
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle statement builders
  const statements: any[] = [];

  for (const entry of entries) {
    tablesProcessed.add(entry.tableName);

    // Parse and anonymize JSON data. Stored text that fails to parse is
    // left untouched -- the purge must never destroy entries it cannot read.
    const oldParsed = parseStoredJson(entry.oldData);
    const newParsed = parseStoredJson(entry.newData);

    if (!oldParsed.ok || !newParsed.ok) {
      entriesSkipped++;
    }

    const anonymizedOldData = oldParsed.ok
      ? serializeAnonymized(anonymizeJsonData(oldParsed.value, piiFields))
      : entry.oldData;
    const anonymizedNewData = newParsed.ok
      ? serializeAnonymized(anonymizeJsonData(newParsed.value, piiFields))
      : entry.newData;

    // Only anonymize userId/ip/userAgent when entry.userId matches the purged user
    // This preserves admin PII when they modified the user's record
    statements.push(
      // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle ORM dynamic operations
      (db.update(auditTable) as any)
        .set({
          userId: entry.userId === userId ? anonymizedUserId : entry.userId,
          ip: entry.userId === userId ? null : entry.ip,
          userAgent: entry.userId === userId ? null : entry.userAgent,
          oldData: anonymizedOldData,
          newData: anonymizedNewData,
        })
        .where(eq(auditTable.id, entry.id)),
    );
  }

  const result: PurgeResult = {
    entriesAnonymized: entries.length,
    tablesProcessed: Array.from(tablesProcessed),
    entriesSkipped,
  };

  // Record that the erasure happened: counts only, no PII, recordId is
  // the anonymized placeholder (storing the purged user's real id here
  // would itself retain the identifier the purge removes).
  statements.push(
    // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle ORM dynamic operations
    (db.insert(auditTable) as any).values({
      id: uuidv7(),
      tableName: "audit_log",
      recordId: anonymizedUserId,
      action: "PURGE",
      oldData: null,
      newData: JSON.stringify(result),
      userId: getLedgerContext()?.userId ?? null,
      ip: null,
      userAgent: null,
      endpoint: getLedgerContext()?.endpoint ?? null,
      requestId: getLedgerContext()?.requestId ?? null,
      createdAt: new Date(),
    }),
  );

  if (typeof db.batch === "function") {
    // All-or-nothing where the driver supports it (D1, libsql).
    await db.batch(statements);
  } else {
    for (const statement of statements) {
      await statement;
    }
  }

  return result;
}

/**
 * Check whether audit entries still ATTRIBUTE actions to this user.
 * Useful for idempotency checks before/after purgeUserData.
 *
 * Limitation, by design: this checks the userId column only. The purge
 * never rewrites recordId in ANY case -- not for ownedRecords matches,
 * not even for the user's own row -- it anonymizes content in place.
 * So any predicate containing recordId-based matching returns non-empty
 * forever after a successful purge, and cannot distinguish
 * purged-from-unpurged. Content-level verification post-hoc is not
 * possible from the rows alone. The PURGE audit entry is the record
 * that the erasure ran; note each re-run appends another PURGE entry
 * (each run is its own recorded erasure event), so gate re-runs on this
 * function.
 *
 * @param db - Drizzle database instance
 * @param auditTable - The audit log table
 * @param userId - User ID to check
 * @returns true if no audit entries carry this userId
 */
export async function isUserDataPurged(
  db: Pick<DrizzleDb, "select">,
  auditTable: AuditLog,
  userId: string,
): Promise<boolean> {
  const entries = await db.select().from(auditTable).where(eq(auditTable.userId, userId));

  return entries.length === 0;
}
