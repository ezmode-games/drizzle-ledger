/**
 * Drizzle Ledger Logger
 *
 * A Drizzle Logger implementation that captures query information
 * for audit logging purposes.
 *
 * This is a best-effort observability trail, not a completeness-guaranteed
 * audit mechanism: it sees queries as SQL text and reconstructs intent by
 * parsing. Mutations it cannot parse are surfaced as entries with
 * tableName "unknown" rather than silently skipped -- the visible gap is
 * what keeps the trail honest.
 */

import type { Logger } from "drizzle-orm";
import { getLedgerContext } from "../core/context.js";

/**
 * Parsed query information.
 */
export interface ParsedQuery {
  action: "INSERT" | "UPDATE" | "DELETE" | "SELECT";
  table: string;
}

/**
 * Input for audit entry callback.
 */
export interface AuditEntryInput {
  tableName: string;
  recordId: string | null;
  action: "INSERT" | "UPDATE" | "DELETE" | "SELECT";
  query: string;
  /**
   * Bound query parameters. Populated only when `includeParams` is set:
   * params carry EVERY bound value -- password hashes, tokens, message
   * bodies -- so persisting them turns the audit trail into a secrets
   * store. Empty array when params are excluded (the default).
   */
  params: unknown[];
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  endpoint: string | null;
  requestId: string | undefined;
}

/**
 * Configuration for AuditLogger.
 */
export interface AuditLoggerConfig {
  /** Tables to audit (if empty, audits all tables). Case-insensitive. */
  includeTables?: string[];
  /** Tables to exclude from auditing. Case-insensitive. */
  excludeTables?: string[];
  /** Whether to log SELECT queries (default: false) */
  logSelects?: boolean;
  /**
   * Hold the audit write promise open past the response.
   * Wire this to ExecutionContext.waitUntil in Cloudflare Workers --
   * REQUIRED there: without it the runtime can cancel the unawaited
   * write when the response returns and entries are silently dropped.
   * Outside Workers, writes are tracked internally and can be drained
   * with flush().
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Include raw bound params in audit entries (default: false).
   * Params contain every bound value including secrets -- opt in only
   * when the audit sink is trusted with that material.
   */
  includeParams?: boolean;
  /**
   * Called when a mutation-shaped query could not be parsed.
   * Default behavior (with or without this hook) writes an entry with
   * tableName "unknown" so the gap is visible in the trail.
   */
  onUnparsedMutation?: (query: string) => void;
  /**
   * Called when writing an audit entry fails. Defaults to console.error.
   * Write failures never break the query itself.
   */
  onWriteError?: (error: unknown, entry: AuditEntryInput) => void;
}

/**
 * Parse a SQL query to extract the action and table name.
 *
 * @param query - The SQL query string
 * @returns Parsed query info or null if unparseable
 */
export function parseQuery(query: string): ParsedQuery | null {
  const normalized = query.trim();

  // INSERT INTO table_name
  const insertMatch = normalized.match(/^INSERT\s+INTO\s+[`"']?(\w+)[`"']?/i);
  if (insertMatch?.[1]) {
    return { action: "INSERT", table: insertMatch[1].toLowerCase() };
  }

  // UPDATE table_name
  const updateMatch = normalized.match(/^UPDATE\s+[`"']?(\w+)[`"']?/i);
  if (updateMatch?.[1]) {
    return { action: "UPDATE", table: updateMatch[1].toLowerCase() };
  }

  // DELETE FROM table_name
  const deleteMatch = normalized.match(/^DELETE\s+FROM\s+[`"']?(\w+)[`"']?/i);
  if (deleteMatch?.[1]) {
    return { action: "DELETE", table: deleteMatch[1].toLowerCase() };
  }

  // SELECT ... FROM table_name
  const selectMatch = normalized.match(/^SELECT\s+.+?\s+FROM\s+[`"']?(\w+)[`"']?/is);
  if (selectMatch?.[1]) {
    return { action: "SELECT", table: selectMatch[1].toLowerCase() };
  }

  return null;
}

/**
 * Detect a query that mutates data even though parseQuery could not
 * resolve its target table: CTE-led statements (WITH ... DELETE),
 * INSERT OR REPLACE / REPLACE INTO, schema-qualified names, and other
 * shapes outside the simple parser. Best-effort classification of the
 * action for the "unknown" entry.
 */
export function classifyUnparsedMutation(query: string): "INSERT" | "UPDATE" | "DELETE" | null {
  const normalized = query.trim().toUpperCase();

  const isMutationShaped =
    normalized.startsWith("WITH") ||
    normalized.startsWith("INSERT") ||
    normalized.startsWith("REPLACE") ||
    normalized.startsWith("UPDATE") ||
    normalized.startsWith("DELETE") ||
    normalized.startsWith("MERGE");

  if (!isMutationShaped) {
    return null;
  }

  if (/\bDELETE\b/.test(normalized)) {
    return "DELETE";
  }
  if (/\bINSERT\b|\bREPLACE\b|\bMERGE\b/.test(normalized)) {
    return "INSERT";
  }
  return "UPDATE";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Try to extract a record ID from query params.
 * Only returns a param that is unambiguously id-shaped (a UUID) --
 * looser matching misattributed entries to whatever plausible-looking
 * string happened to bind first. Best-effort: null means "not confident",
 * and consumers must treat recordId as advisory.
 *
 * @param params - Query parameters
 * @returns The first UUID-shaped string parameter, or null
 */
export function extractRecordId(params: unknown[]): string | null {
  for (const param of params) {
    if (typeof param === "string" && UUID_PATTERN.test(param)) {
      return param;
    }
  }
  return null;
}

/**
 * Drizzle Logger that writes to an audit trail.
 *
 * @example
 * ```typescript
 * const logger = new AuditLogger(
 *   async (entry) => {
 *     await db.insert(auditLog).values({
 *       id: uuidv7(),
 *       ...entry,
 *       createdAt: new Date(),
 *     });
 *   },
 *   {
 *     excludeTables: ['audit_log', 'session'],
 *     waitUntil: (p) => ctx.waitUntil(p),
 *   }
 * );
 *
 * const db = drizzle(d1, { logger });
 * ```
 */
export class AuditLogger implements Logger {
  private pending = new Set<Promise<void>>();
  private lowerInclude: string[] | undefined;
  private lowerExclude: string[] | undefined;

  constructor(
    private writeAuditEntry: (entry: AuditEntryInput) => Promise<void>,
    private config?: AuditLoggerConfig,
  ) {
    this.lowerInclude = config?.includeTables?.map((t) => t.toLowerCase());
    this.lowerExclude = config?.excludeTables?.map((t) => t.toLowerCase());
  }

  logQuery(query: string, params: unknown[]): void {
    const parsed = parseQuery(query);

    if (!parsed) {
      // A mutation we could not parse must not vanish from the trail.
      const action = classifyUnparsedMutation(query);
      if (action) {
        this.config?.onUnparsedMutation?.(query);
        this.write({
          tableName: "unknown",
          recordId: null,
          action,
          query,
          params: this.config?.includeParams ? params : [],
          ...this.contextFields(),
        });
      }
      return;
    }

    // Skip SELECT unless configured to log them
    if (parsed.action === "SELECT" && !this.config?.logSelects) {
      return;
    }

    // Check include/exclude tables (case-insensitive)
    if (this.lowerInclude?.length && !this.lowerInclude.includes(parsed.table)) {
      return;
    }

    if (this.lowerExclude?.includes(parsed.table)) {
      return;
    }

    this.write({
      tableName: parsed.table,
      recordId: extractRecordId(params),
      action: parsed.action,
      query,
      params: this.config?.includeParams ? params : [],
      ...this.contextFields(),
    });
  }

  /**
   * Wait for all in-flight audit writes to settle.
   * Use at shutdown (or per-request outside Workers) to guarantee no
   * entry is lost to an exiting process. With `waitUntil` configured the
   * platform holds the writes instead and flush resolves immediately.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  private contextFields(): Pick<
    AuditEntryInput,
    "userId" | "ip" | "userAgent" | "endpoint" | "requestId"
  > {
    const context = getLedgerContext();
    return {
      userId: context?.userId ?? null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      endpoint: context?.endpoint ?? null,
      requestId: context?.requestId,
    };
  }

  private write(entry: AuditEntryInput): void {
    const promise = this.writeAuditEntry(entry).catch((err) => {
      const onWriteError = this.config?.onWriteError;
      if (onWriteError) {
        onWriteError(err, entry);
      } else {
        console.error("[ledger] Failed to write audit entry:", err);
      }
    });

    if (this.config?.waitUntil) {
      this.config.waitUntil(promise);
      return;
    }

    // Track locally so flush() can drain before process exit.
    this.pending.add(promise);
    promise.finally(() => {
      this.pending.delete(promise);
    });
  }
}
