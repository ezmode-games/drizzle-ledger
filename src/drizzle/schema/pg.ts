/**
 * Drizzle Ledger Schema - PostgreSQL
 *
 * Audit log table definition for PostgreSQL databases.
 *
 * @example
 * ```typescript
 * export { auditLog } from '@rafters/ledger/schema/pg';
 * ```
 */

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  tableName: text("table_name").notNull(),
  recordId: text("record_id").notNull(),
  action: text("action", {
    enum: ["INSERT", "UPDATE", "DELETE", "SOFT_DELETE", "RESTORE", "PURGE"],
  }).notNull(),
  oldData: text("old_data"),
  newData: text("new_data"),
  userId: text("user_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  endpoint: text("endpoint"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export function createAuditLogTable(tableName: string) {
  return pgTable(tableName, {
    id: text("id").primaryKey(),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    action: text("action", {
      enum: ["INSERT", "UPDATE", "DELETE", "SOFT_DELETE", "RESTORE", "PURGE"],
    }).notNull(),
    oldData: text("old_data"),
    newData: text("new_data"),
    userId: text("user_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    endpoint: text("endpoint"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  });
}

export type AuditLog = typeof auditLog;
export type AuditLogInsert = typeof auditLog.$inferInsert;
export type AuditLogSelect = typeof auditLog.$inferSelect;

export const AUDIT_LOG_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_audit_log_request ON audit_log(request_id)",
] as const;

/**
 * Build append-only protection SQL for a given audit table name:
 * a plpgsql trigger function that RAISEs on UPDATE/DELETE, so tampering
 * FAILS LOUDLY (an exception the caller must handle and can alert on)
 * rather than being silently swallowed -- pg RULEs with DO INSTEAD
 * NOTHING would return success on a blocked write, giving a tamperer no
 * signal. Apply in a migration. Requires PostgreSQL 14+ (CREATE OR
 * REPLACE TRIGGER).
 *
 * NOTES:
 * - purgeUserData legitimately UPDATEs audit rows -- if you use the
 *   GDPR purge, apply only the delete-blocking trigger, or drop and
 *   re-create the update trigger around purge runs.
 * - Pass the SAME table name you gave createAuditLogTable /
 *   createAuditedDb's auditTableName; protecting the default name while
 *   writing to a custom table protects nothing.
 * - Function/trigger names derive from the table name. CREATE OR
 *   REPLACE clobbers a pre-existing same-named function -- if you
 *   already have one, rename yours or verify the replacement is wanted.
 */
export function auditLogProtectSql(tableName = "audit_log"): readonly [string, string, string] {
  return [
    `CREATE OR REPLACE FUNCTION ${tableName}_block_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${tableName} is append-only'; END; $$ LANGUAGE plpgsql`,
    `CREATE OR REPLACE TRIGGER trg_${tableName}_no_update BEFORE UPDATE ON ${tableName} FOR EACH ROW EXECUTE FUNCTION ${tableName}_block_write()`,
    `CREATE OR REPLACE TRIGGER trg_${tableName}_no_delete BEFORE DELETE ON ${tableName} FOR EACH ROW EXECUTE FUNCTION ${tableName}_block_write()`,
  ] as const;
}

/** Append-only protection for the default audit_log table. */
export const AUDIT_LOG_PROTECT_SQL = auditLogProtectSql();
