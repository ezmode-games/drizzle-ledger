/**
 * Drizzle Ledger Better Auth Plugin
 *
 * Integrates audit logging with better-auth via databaseHooks.
 *
 * For soft-delete functionality, use createSoftDeleteCallback with
 * the user.deleteUser.beforeDelete option.
 *
 * @example
 * ```typescript
 * import { betterAuth } from 'better-auth';
 * import { ledgerPlugin, createSoftDeleteCallback } from '@rafters/ledger/better-auth-plugin';
 * import { eq } from 'drizzle-orm';
 *
 * export const auth = betterAuth({
 *   database: drizzle(env.DB),
 *   user: {
 *     deleteUser: {
 *       enabled: true,
 *       // Use createSoftDeleteCallback for actual soft-delete behavior
 *       beforeDelete: createSoftDeleteCallback({
 *         db,
 *         userTable: users,
 *         whereUserId: (userId) => eq(users.id, userId),
 *       }),
 *     },
 *   },
 *   plugins: [
 *     // Plugin provides audit logging for create/update via databaseHooks
 *     ledgerPlugin({
 *       writeAuditEntry: async (entry) => {
 *         await db.insert(auditLog).values({ ...entry, id: uuidv7() });
 *       },
 *     }),
 *   ],
 * });
 * ```
 */

import type { BetterAuthPlugin, User } from "better-auth";
import { softDeleteValues } from "./core/soft-delete.js";
import { SoftDeletePerformedError, isSoftDeletePerformed } from "./core/errors.js";
import { redactSensitiveFields } from "./core/redact.js";

/**
 * Audit entry passed to the writeAuditEntry callback.
 */
export interface LedgerAuditEntry {
  /** The table name (user, account, session, verification) */
  tableName: string;
  /** The record ID */
  recordId: string;
  /** The action performed (INSERT, UPDATE, SOFT_DELETE for soft-deletes, DELETE for hard deletes) */
  action: "INSERT" | "UPDATE" | "SOFT_DELETE" | "DELETE";
  /** The data before the operation (for UPDATE/SOFT_DELETE/DELETE) */
  oldData: Record<string, unknown> | null;
  /** The data after the operation (for INSERT/UPDATE) */
  newData: Record<string, unknown> | null;
  /** The user ID performing the action (if available) */
  userId: string | null;
}

/**
 * Configuration for the ledger plugin.
 */
export interface LedgerPluginConfig {
  /**
   * Tables to log delete audit entries for.
   * Currently only 'user' is supported (better-auth only exposes user deleteUser hooks).
   * Note: This only logs audit entries; to actually perform soft-delete,
   * use createSoftDeleteCallback with user.deleteUser.beforeDelete.
   */
  softDeleteTables?: "user"[];
  /**
   * Callback to write an audit entry.
   * If not provided, audit logging is disabled.
   */
  writeAuditEntry?: (entry: LedgerAuditEntry) => Promise<void>;
  /**
   * Tables to audit. Defaults to ['user'].
   *
   * WARNING: 'account' rows carry OAuth accessToken/refreshToken/idToken
   * and credential password hashes. Redaction strips those fields before
   * any audit write, but auditing 'account' remains opt-in -- enable it
   * only with an actual compliance need.
   * Session and verification are excluded by default due to high volume.
   */
  auditTables?: ("user" | "account" | "session" | "verification")[];
  /**
   * Additional key patterns to redact beyond DEFAULT_SECRET_PATTERNS
   * (token/secret/password/apikey/api_key, case-insensitive substring
   * match). Redaction itself cannot be disabled: if redaction fails,
   * the audit entry is NOT written.
   */
  redactPatterns?: readonly string[];
}

// Helper to safely log errors without blocking auth operations
function safeLog(message: string, error?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[ledger] ${message}`, error ?? "");
}

/**
 * Redact secret material from an audit entry's payloads.
 * Applied on EVERY plugin audit path before the sink sees the entry --
 * better-auth rows (account especially) carry OAuth tokens and password
 * hashes, and an audit trail must never become a secrets store.
 */
function redactAuditEntry(
  entry: LedgerAuditEntry,
  extraPatterns?: readonly string[],
): LedgerAuditEntry {
  return {
    ...entry,
    oldData: redactSensitiveFields(entry.oldData, extraPatterns),
    newData: redactSensitiveFields(entry.newData, extraPatterns),
  };
}

// Type for better-auth user with id
type UserWithId = { id: string } & Record<string, unknown>;

/**
 * Better Auth plugin for audit logging.
 *
 * Features:
 * - Audit logging for user and account create/update operations via databaseHooks
 * - Optional delete audit logging when softDeleteTables includes 'user'
 *
 * NOTE: This plugin only provides audit logging. For actual soft-delete behavior
 * (updating deletedAt instead of hard deleting), use createSoftDeleteCallback
 * with the user.deleteUser.beforeDelete option.
 *
 * @param config - Plugin configuration
 * @returns BetterAuthPlugin instance
 *
 * @example
 * ```typescript
 * import { ledgerPlugin } from '@rafters/ledger/better-auth-plugin';
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     ledgerPlugin({
 *       writeAuditEntry: async (entry) => {
 *         await db.insert(auditLog).values({
 *           id: uuidv7(),
 *           ...entry,
 *           createdAt: new Date(),
 *         });
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export function ledgerPlugin(config?: LedgerPluginConfig): BetterAuthPlugin {
  const auditTables = config?.auditTables ?? ["user"];
  const softDeleteTables = config?.softDeleteTables ?? [];
  const writeAuditEntry = config?.writeAuditEntry;
  const redactPatterns = config?.redactPatterns;

  // Helper to safely write audit entry. Redaction is fail-closed: an
  // entry that cannot be redacted is never written.
  async function audit(entry: LedgerAuditEntry): Promise<void> {
    if (!writeAuditEntry) return;
    let redacted: LedgerAuditEntry;
    try {
      redacted = redactAuditEntry(entry, redactPatterns);
    } catch (error) {
      safeLog("Redaction failed; audit entry NOT written", error);
      return;
    }
    try {
      await writeAuditEntry(redacted);
    } catch (error) {
      safeLog("Failed to write audit entry", error);
    }
  }

  // Build databaseHooks based on audited tables
  // biome-ignore lint/suspicious/noExplicitAny: Required for better-auth databaseHooks typing
  const databaseHooks: Record<string, any> = {};

  for (const table of auditTables) {
    databaseHooks[table] = {
      create: {
        after: async (data: UserWithId) => {
          await audit({
            tableName: table,
            recordId: data.id,
            action: "INSERT",
            oldData: null,
            newData: data as Record<string, unknown>,
            userId: table === "user" ? data.id : null,
          });
        },
      },
      update: {
        after: async (data: UserWithId) => {
          await audit({
            tableName: table,
            recordId: data.id,
            action: "UPDATE",
            oldData: null, // We don't have access to old data in after hook
            newData: data as Record<string, unknown>,
            userId: table === "user" ? data.id : null,
          });
        },
      },
    };
  }

  // Add user delete audit logging if configured
  // Note: better-auth's deleteUser hooks are NOT part of databaseHooks.
  // They must be configured separately in user.deleteUser config.
  // This plugin ONLY logs a SOFT_DELETE audit entry; it does NOT perform the
  // actual soft-delete. To implement soft-delete behavior (e.g. updating
  // a deletedAt column), configure your own user.deleteUser.beforeDelete
  // callback, for example using createSoftDeleteCallback.
  const userDeleteHooks = softDeleteTables.includes("user")
    ? {
        beforeDelete: async (user: User) => {
          // Log the soft-delete intent
          await audit({
            tableName: "user",
            recordId: user.id,
            action: "SOFT_DELETE",
            oldData: user as unknown as Record<string, unknown>,
            newData: null,
            userId: user.id,
          });
        },
      }
    : undefined;

  return {
    id: "ledger",
    init: () => {
      return {
        options: {
          databaseHooks,
          ...(userDeleteHooks
            ? {
                user: {
                  deleteUser: userDeleteHooks,
                },
              }
            : {}),
        },
      };
    },
  };
}

/**
 * Options for the soft-delete callback.
 */
export interface SoftDeleteCallbackOptions {
  /**
   * Drizzle database instance with update capability.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle type compatibility
  db: { update: (table: any) => any };
  /**
   * The user table with deletedAt column.
   * Must have 'id' and 'deletedAt' columns.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle table type compatibility
  userTable: { id: any; deletedAt: any; deletedBy?: any };
  /**
   * Function to build a WHERE clause for the user ID.
   * Example: (userId) => eq(userTable.id, userId)
   */
  // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle SQL type compatibility
  whereUserId: (userId: string) => any;
  /**
   * Callback to write audit entry (optional).
   */
  writeAuditEntry?: (entry: LedgerAuditEntry) => Promise<void>;
  /**
   * Additional key patterns to redact beyond DEFAULT_SECRET_PATTERNS.
   * Redaction itself cannot be disabled.
   */
  redactPatterns?: readonly string[];
}

/**
 * Creates a beforeDelete callback that performs soft-delete instead of hard delete.
 *
 * This callback:
 * 1. Performs a soft-delete UPDATE on the user record
 * 2. Logs an audit entry (if writeAuditEntry is provided)
 * 3. Throws to prevent the actual hard delete
 *
 * IMPORTANT: The throw prevents the hard delete from happening.
 * Your client code should catch this and treat it as success.
 *
 * @param options - Configuration options
 * @returns A beforeDelete callback function
 *
 * @example
 * ```typescript
 * import { createSoftDeleteCallback } from '@rafters/ledger/better-auth-plugin';
 * import { eq } from 'drizzle-orm';
 *
 * export const auth = betterAuth({
 *   user: {
 *     deleteUser: {
 *       enabled: true,
 *       beforeDelete: createSoftDeleteCallback({
 *         db,
 *         userTable: users,
 *         whereUserId: (userId) => eq(users.id, userId),
 *         writeAuditEntry: async (entry) => {
 *           await db.insert(auditLog).values({ ...entry, id: uuidv7() });
 *         },
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function createSoftDeleteCallback(
  options: SoftDeleteCallbackOptions,
): (user: User, request?: Request) => Promise<void> {
  const { db, userTable, whereUserId, writeAuditEntry } = options;

  return async (user: User, _request?: Request): Promise<void> => {
    // Perform soft-delete
    const deleteVals = softDeleteValues(null);

    // biome-ignore lint/suspicious/noExplicitAny: Required for Drizzle ORM dynamic table operations
    await (db.update(userTable) as any)
      .set({
        deletedAt: deleteVals.deletedAt,
        ...(userTable.deletedBy !== undefined ? { deletedBy: deleteVals.deletedBy } : {}),
      })
      .where(whereUserId(user.id));

    // Log to audit (redacted, fail-closed on redaction failure)
    if (writeAuditEntry) {
      let redacted: LedgerAuditEntry | null = null;
      try {
        redacted = redactAuditEntry(
          {
            tableName: "user",
            recordId: user.id,
            action: "SOFT_DELETE",
            oldData: user as unknown as Record<string, unknown>,
            newData: { ...user, ...deleteVals } as unknown as Record<string, unknown>,
            userId: user.id,
          },
          options.redactPatterns,
        );
      } catch (error) {
        safeLog("Redaction failed; soft-delete audit entry NOT written", error);
      }
      if (redacted) {
        try {
          await writeAuditEntry(redacted);
        } catch (error) {
          safeLog("Failed to write audit entry for soft-delete", error);
        }
      }
    }

    // Throw to prevent the hard delete from happening
    // This is the recommended pattern for better-auth's beforeDelete
    // Use isSoftDeletePerformed() to check for this error type
    throw new SoftDeletePerformedError(user.id);
  };
}

/**
 * Creates a simple audit-only callback for afterDelete.
 *
 * Unlike createSoftDeleteCallback, this just logs the delete without
 * preventing it (useful for hard delete with audit trail).
 *
 * @param writeAuditEntry - Callback to write audit entry
 * @returns A callback function for afterDelete
 *
 * @example
 * ```typescript
 * import { createDeleteAuditCallback } from '@rafters/ledger/better-auth-plugin';
 *
 * export const auth = betterAuth({
 *   user: {
 *     deleteUser: {
 *       enabled: true,
 *       afterDelete: createDeleteAuditCallback(async (entry) => {
 *         await db.insert(auditLog).values({ ...entry, id: uuidv7() });
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function createDeleteAuditCallback(
  writeAuditEntry: (entry: LedgerAuditEntry) => Promise<void>,
  redactPatterns?: readonly string[],
): (user: User, request?: Request) => Promise<void> {
  return async (user: User, _request?: Request): Promise<void> => {
    let redacted: LedgerAuditEntry | null = null;
    try {
      redacted = redactAuditEntry(
        {
          tableName: "user",
          recordId: user.id,
          action: "DELETE", // Hard delete action (user was permanently deleted)
          oldData: user as unknown as Record<string, unknown>,
          newData: null,
          userId: user.id,
        },
        redactPatterns,
      );
    } catch (error) {
      safeLog("Redaction failed; delete audit entry NOT written", error);
    }
    if (redacted) {
      try {
        await writeAuditEntry(redacted);
      } catch (error) {
        safeLog("Failed to write audit entry for delete", error);
      }
    }
  };
}

// Re-export error types from core for backwards compatibility
export { SoftDeletePerformedError, isSoftDeletePerformed } from "./core/errors.js";
