/**
 * Drizzle Ledger Schema - SQLite / Cloudflare D1
 *
 * Audit log table definition for SQLite databases.
 *
 * @example
 * ```typescript
 * // In your schema file
 * export { auditLog } from '@rafters/ledger/schema/sqlite';
 *
 * // Or customize the table name
 * import { createAuditLogTable } from '@rafters/ledger/schema/sqlite';
 * export const auditLog = createAuditLogTable('custom_audit_log');
 * ```
 */

import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const auditLog = sqliteTable("audit_log", {
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
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export function createAuditLogTable(tableName: string) {
  return sqliteTable(tableName, {
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
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
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
 * triggers that reject UPDATE and DELETE at the engine, so tampering
 * fails no matter which code path attempts it. Apply in a migration.
 *
 * NOTES:
 * - purgeUserData legitimately UPDATEs audit rows -- if you use the
 *   GDPR purge, apply only the delete-blocking trigger, or drop and
 *   re-create the update trigger around purge runs.
 * - Pass the SAME table name you gave createAuditLogTable /
 *   createAuditedDb's auditTableName; protecting the default name while
 *   writing to a custom table protects nothing.
 * - Trigger names derive from the table name. IF NOT EXISTS silently
 *   keeps a pre-existing SAME-NAMED trigger -- if you already have one,
 *   verify it actually blocks writes.
 */
export function auditLogProtectSql(tableName = "audit_log"): readonly [string, string] {
  return [
    `CREATE TRIGGER IF NOT EXISTS trg_${tableName}_no_update BEFORE UPDATE ON ${tableName} BEGIN SELECT RAISE(ABORT, '${tableName} is append-only'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_${tableName}_no_delete BEFORE DELETE ON ${tableName} BEGIN SELECT RAISE(ABORT, '${tableName} is append-only'); END`,
  ] as const;
}

/** Append-only protection for the default audit_log table. */
export const AUDIT_LOG_PROTECT_SQL = auditLogProtectSql();
