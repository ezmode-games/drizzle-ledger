import { describe, expect, test, vi } from "vitest";
import { createLedgerContext, runWithLedgerContext } from "../../src/core/context.js";
import {
  type AuditEntryInput,
  AuditLogger,
  classifyUnparsedMutation,
  extractRecordId,
  parseQuery,
} from "../../src/drizzle/logger.js";

describe("parseQuery", () => {
  test("parses INSERT query", () => {
    const result = parseQuery("INSERT INTO users (id, name) VALUES (?, ?)");
    expect(result).toEqual({ action: "INSERT", table: "users" });
  });

  test("parses INSERT with backticks", () => {
    const result = parseQuery("INSERT INTO `users` (`id`) VALUES (?)");
    expect(result).toEqual({ action: "INSERT", table: "users" });
  });

  test("parses UPDATE query", () => {
    const result = parseQuery("UPDATE users SET name = ? WHERE id = ?");
    expect(result).toEqual({ action: "UPDATE", table: "users" });
  });

  test("parses DELETE query", () => {
    const result = parseQuery("DELETE FROM users WHERE id = ?");
    expect(result).toEqual({ action: "DELETE", table: "users" });
  });

  test("parses SELECT query", () => {
    const result = parseQuery("SELECT id, name FROM users WHERE id = ?");
    expect(result).toEqual({ action: "SELECT", table: "users" });
  });

  test("parses SELECT * query", () => {
    const result = parseQuery("SELECT * FROM mods WHERE slug = ?");
    expect(result).toEqual({ action: "SELECT", table: "mods" });
  });

  test("handles case insensitivity", () => {
    const result = parseQuery("insert into USERS (id) values (?)");
    expect(result).toEqual({ action: "INSERT", table: "users" });
  });

  test("returns null for unparseable query", () => {
    expect(parseQuery("PRAGMA table_info(users)")).toBeNull();
  });

  test("returns null for BEGIN/COMMIT", () => {
    expect(parseQuery("BEGIN")).toBeNull();
    expect(parseQuery("COMMIT")).toBeNull();
  });

  test("returns null for empty query", () => {
    expect(parseQuery("")).toBeNull();
  });

  test("schema-qualified names attribute to the table, not the schema", () => {
    expect(parseQuery("INSERT INTO main.users (id) VALUES (?)")).toEqual({
      action: "INSERT",
      table: "users",
    });
    expect(parseQuery('UPDATE "main"."users" SET name = ?')).toEqual({
      action: "UPDATE",
      table: "users",
    });
    expect(parseQuery("DELETE FROM main.users WHERE id = ?")).toEqual({
      action: "DELETE",
      table: "users",
    });
  });
});

describe("extractRecordId", () => {
  test("extracts UUID from params", () => {
    const params = ["018f1234-5678-7abc-def0-123456789abc", "John"];
    expect(extractRecordId(params)).toBe("018f1234-5678-7abc-def0-123456789abc");
  });

  test("returns null for non-UUID strings that merely look id-ish", () => {
    // The old loose matching grabbed the first plausible word and
    // misattributed entries; only UUID-shaped params qualify now.
    expect(extractRecordId(["user-123", "John"])).toBeNull();
    expect(extractRecordId(["admin"])).toBeNull();
    expect(extractRecordId(["not-a-uuid-just-dashes"])).toBeNull();
  });

  test("returns null for empty params", () => {
    expect(extractRecordId([])).toBeNull();
  });

  test("skips non-string params and finds a later UUID", () => {
    const params = [123, true, null, "018f1234-5678-7abc-def0-123456789abc"];
    expect(extractRecordId(params)).toBe("018f1234-5678-7abc-def0-123456789abc");
  });
});

describe("classifyUnparsedMutation", () => {
  test("classifies CTE-led delete", () => {
    expect(
      classifyUnparsedMutation(
        "WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)",
      ),
    ).toBe("DELETE");
  });

  test("classifies INSERT OR REPLACE", () => {
    expect(classifyUnparsedMutation("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)")).toBe(
      "INSERT",
    );
  });

  test("classifies CTE-led update", () => {
    expect(classifyUnparsedMutation("WITH ranked AS (SELECT id FROM t) UPDATE t SET x = 1")).toBe(
      "UPDATE",
    );
  });

  test("returns null for non-mutation shapes", () => {
    expect(classifyUnparsedMutation("PRAGMA table_info(users)")).toBeNull();
    expect(classifyUnparsedMutation("BEGIN")).toBeNull();
    expect(classifyUnparsedMutation("SELECT * FROM users")).toBeNull();
  });

  test("returns null for read-only CTEs -- no phantom mutations", () => {
    expect(classifyUnparsedMutation("WITH t AS (SELECT id FROM users) SELECT * FROM t")).toBeNull();
  });
});

describe("AuditLogger", () => {
  test("calls writeAuditEntry for INSERT", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    logger.logQuery("INSERT INTO users (id, name) VALUES (?, ?)", [
      "018f1234-5678-7abc-def0-123456789abc",
      "John",
    ]);

    await logger.flush();

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("INSERT");
    expect(entries[0].tableName).toBe("users");
    expect(entries[0].recordId).toBe("018f1234-5678-7abc-def0-123456789abc");
  });

  test("calls writeAuditEntry for UPDATE", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    logger.logQuery("UPDATE users SET name = ? WHERE id = ?", ["Jane", "user-456"]);

    await new Promise((r) => setTimeout(r, 10));

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("UPDATE");
    expect(entries[0].tableName).toBe("users");
  });

  test("calls writeAuditEntry for DELETE", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    logger.logQuery("DELETE FROM users WHERE id = ?", ["user-789"]);

    await new Promise((r) => setTimeout(r, 10));

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("DELETE");
  });

  test("skips SELECT by default", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    logger.logQuery("SELECT * FROM users WHERE id = ?", ["user-123"]);

    await new Promise((r) => setTimeout(r, 10));

    expect(entries).toHaveLength(0);
  });

  test("logs SELECT when configured", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      { logSelects: true },
    );

    logger.logQuery("SELECT * FROM users WHERE id = ?", ["user-123"]);

    await new Promise((r) => setTimeout(r, 10));

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("SELECT");
  });

  test("skips excluded tables", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      { excludeTables: ["audit_log", "session"] },
    );

    logger.logQuery("INSERT INTO audit_log (id) VALUES (?)", ["log-123"]);
    logger.logQuery("INSERT INTO session (id) VALUES (?)", ["sess-123"]);
    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["user-123"]);

    await new Promise((r) => setTimeout(r, 10));

    expect(entries).toHaveLength(1);
    expect(entries[0].tableName).toBe("users");
  });

  test("only logs included tables when specified", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      { includeTables: ["users", "mods"] },
    );

    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["user-123"]);
    logger.logQuery("INSERT INTO mods (id) VALUES (?)", ["mod-123"]);
    logger.logQuery("INSERT INTO tags (id) VALUES (?)", ["tag-123"]);

    await new Promise((r) => setTimeout(r, 10));

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.tableName)).toEqual(["users", "mods"]);
  });

  test("captures context from AsyncLocalStorage", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    const context = createLedgerContext({
      userId: "user-999",
      ip: "1.2.3.4",
      userAgent: "TestAgent",
      endpoint: "POST /api/test",
      requestId: "req-abc",
    });

    await runWithLedgerContext(context, async () => {
      logger.logQuery("INSERT INTO users (id) VALUES (?)", ["user-123"]);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe("user-999");
    expect(entries[0].ip).toBe("1.2.3.4");
    expect(entries[0].userAgent).toBe("TestAgent");
    expect(entries[0].endpoint).toBe("POST /api/test");
    expect(entries[0].requestId).toBe("req-abc");
  });

  test("handles writeAuditEntry errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new AuditLogger(() => {
      return Promise.reject(new Error("DB connection failed"));
    });

    // Should not throw
    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["user-123"]);

    await new Promise((r) => setTimeout(r, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      "[ledger] Failed to write audit entry:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  test("skips unparseable non-mutation queries", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    logger.logQuery("PRAGMA table_info(users)", []);
    logger.logQuery("BEGIN", []);

    await logger.flush();

    expect(entries).toHaveLength(0);
  });

  test("unparseable mutations produce a visible unknown entry, not silence", async () => {
    const entries: AuditEntryInput[] = [];
    const unparsed: string[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      { onUnparsedMutation: (q) => unparsed.push(q) },
    );

    logger.logQuery(
      "WITH doomed AS (SELECT id FROM users WHERE last_seen < ?) DELETE FROM users WHERE id IN (SELECT id FROM doomed)",
      ["2020-01-01"],
    );
    logger.logQuery("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", ["key", "value"]);

    await logger.flush();

    expect(entries).toHaveLength(2);
    expect(entries[0].tableName).toBe("unknown");
    expect(entries[0].action).toBe("DELETE");
    expect(entries[1].tableName).toBe("unknown");
    expect(entries[1].action).toBe("INSERT");
    expect(unparsed).toHaveLength(2);
  });

  test("excludes params by default", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    logger.logQuery("INSERT INTO account (id, access_token) VALUES (?, ?)", [
      "018f1234-5678-7abc-def0-123456789abc",
      "gho_secret_token_value",
    ]);

    await logger.flush();

    expect(entries).toHaveLength(1);
    expect(entries[0].params).toEqual([]);
    expect(JSON.stringify(entries[0])).not.toContain("gho_secret_token_value");
  });

  test("includes params only when opted in", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      { includeParams: true },
    );

    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["018f1234-5678-7abc-def0-123456789abc"]);

    await logger.flush();

    expect(entries[0].params).toEqual(["018f1234-5678-7abc-def0-123456789abc"]);
  });

  test("table filters are case-insensitive", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      { excludeTables: ["Session"], includeTables: ["Session", "Users"] },
    );

    logger.logQuery("INSERT INTO session (id) VALUES (?)", ["s1"]);
    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["u1"]);

    await logger.flush();

    expect(entries).toHaveLength(1);
    expect(entries[0].tableName).toBe("users");
  });

  test("routes writes through waitUntil when configured", async () => {
    const held: Promise<unknown>[] = [];
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      { waitUntil: (p) => held.push(p) },
    );

    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["u1"]);

    expect(held).toHaveLength(1);
    await Promise.all(held);
    expect(entries).toHaveLength(1);
  });

  test("flush drains slow in-flight writes", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(async (entry) => {
      await new Promise((r) => setTimeout(r, 20));
      entries.push(entry);
    });

    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["u1"]);
    logger.logQuery("UPDATE users SET name = ? WHERE id = ?", ["Jane", "u1"]);

    expect(entries).toHaveLength(0);
    await logger.flush();
    expect(entries).toHaveLength(2);
  });

  test("a read-only CTE produces no entry even without logSelects", async () => {
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger((entry) => {
      entries.push(entry);
      return Promise.resolve();
    });

    logger.logQuery("WITH t AS (SELECT id FROM users) SELECT * FROM t", []);

    await logger.flush();

    expect(entries).toHaveLength(0);
  });

  test("a synchronously-throwing sink never breaks the query path", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new AuditLogger((() => {
      throw new Error("sync sink explosion");
    }) as unknown as (entry: AuditEntryInput) => Promise<void>);

    expect(() => logger.logQuery("INSERT INTO users (id) VALUES (?)", ["u1"])).not.toThrow();
    await logger.flush();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[ledger] Failed to write audit entry:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  test("a throwing onUnparsedMutation hook never breaks the query path", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const entries: AuditEntryInput[] = [];
    const logger = new AuditLogger(
      (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      {
        onUnparsedMutation: () => {
          throw new Error("hook explosion");
        },
      },
    );

    expect(() =>
      logger.logQuery("WITH doomed AS (SELECT 1) DELETE FROM users WHERE id IN (SELECT 1)", []),
    ).not.toThrow();
    await logger.flush();

    // The unknown entry is still written despite the throwing hook
    expect(entries).toHaveLength(1);
    expect(entries[0].tableName).toBe("unknown");
    consoleSpy.mockRestore();
  });

  test("onWriteError receives failures instead of console when configured", async () => {
    const failures: unknown[] = [];
    const logger = new AuditLogger(() => Promise.reject(new Error("DB connection failed")), {
      onWriteError: (err) => failures.push(err),
    });

    logger.logQuery("INSERT INTO users (id) VALUES (?)", ["u1"]);

    await logger.flush();

    expect(failures).toHaveLength(1);
    expect((failures[0] as Error).message).toBe("DB connection failed");
  });
});
