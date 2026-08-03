/**
 * Ledger Errors
 *
 * ORM-agnostic error types used across the library.
 */

/**
 * Error thrown when soft-delete is performed successfully.
 * Check for this error type to handle soft-delete success cases.
 */
export class SoftDeletePerformedError extends Error {
  readonly code = "SOFT_DELETE_PERFORMED" as const;
  readonly softDeleted = true as const;
  readonly userId: string;

  constructor(userId: string) {
    super("User soft-deleted successfully");
    this.name = "SoftDeletePerformedError";
    this.userId = userId;
  }
}

/**
 * Check if an error is a soft-delete success error.
 *
 * @param error - The error to check
 * @returns true if this is a soft-delete success
 *
 * @example
 * ```typescript
 * try {
 *   await auth.api.deleteUser({ userId });
 * } catch (error) {
 *   if (isSoftDeletePerformed(error)) {
 *     // Success! User was soft-deleted
 *     return { success: true };
 *   }
 *   throw error;
 * }
 * ```
 */
export function isSoftDeletePerformed(error: unknown): error is SoftDeletePerformedError {
  if (error instanceof SoftDeletePerformedError) return true;
  if (error instanceof Error) {
    return (
      "code" in error &&
      (error as Error & { code?: string }).code === "SOFT_DELETE_PERFORMED" &&
      "softDeleted" in error &&
      (error as Error & { softDeleted?: boolean }).softDeleted === true
    );
  }
  return false;
}

/**
 * Error thrown by createAuditedDb in allowlist mode when a table listed
 * in softDeleteTables is deleted from but has no deletedAt property.
 * Loud failure instead of a silent fallback to hard delete.
 */
export class MissingSoftDeleteColumnError extends Error {
  readonly code = "MISSING_SOFT_DELETE_COLUMN" as const;
  readonly tableName: string;

  constructor(tableName: string) {
    super(
      `Table '${tableName}' is listed in softDeleteTables but has no deletedAt column property`,
    );
    this.name = "MissingSoftDeleteColumnError";
    this.tableName = tableName;
  }
}

/**
 * Error thrown by createAuditedDb in allowlist mode when the table
 * object's name cannot be resolved: the allowlist cannot be consulted,
 * and silently falling through to hard delete would defeat the mode.
 */
export class UnresolvedSoftDeleteTableError extends Error {
  readonly code = "UNRESOLVED_SOFT_DELETE_TABLE" as const;

  constructor() {
    super(
      "Cannot resolve the table name for a delete in softDeleteTables allowlist mode; refusing to guess between soft and hard delete",
    );
    this.name = "UnresolvedSoftDeleteTableError";
  }
}
