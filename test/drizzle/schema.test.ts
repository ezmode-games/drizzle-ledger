import { describe, expect, test } from "vitest";
import {
  AUDIT_LOG_PROTECT_SQL as sqliteProtect,
  auditLogProtectSql as sqliteProtectFor,
} from "../../src/drizzle/schema/sqlite.js";
import {
  AUDIT_LOG_PROTECT_SQL as pgProtect,
  auditLogProtectSql as pgProtectFor,
} from "../../src/drizzle/schema/pg.js";
import { AUDIT_LOG_PROTECT_SQL as mysqlProtect } from "../../src/drizzle/schema/mysql.js";

describe("AUDIT_LOG_PROTECT_SQL", () => {
  test.each([
    ["sqlite", sqliteProtect, 2],
    ["pg", pgProtect, 3],
    ["mysql", mysqlProtect, 2],
  ])("%s ships update-blocking and delete-blocking statements", (_dialect, statements, count) => {
    // pg carries a third statement: the shared plpgsql trigger function
    expect(statements).toHaveLength(count as number);
    const joined = (statements as readonly string[]).join("\n").toUpperCase();
    expect(joined).toContain("UPDATE");
    expect(joined).toContain("DELETE");
    for (const statement of statements as readonly string[]) {
      expect(statement).toContain("audit_log");
    }
  });

  test("sqlite statements are RAISE(ABORT) triggers", () => {
    for (const statement of sqliteProtect) {
      expect(statement).toContain("RAISE(ABORT");
      expect(statement).toContain("CREATE TRIGGER");
    }
  });

  test("pg protection FAILS LOUDLY via plpgsql RAISE EXCEPTION, not silent rules", () => {
    const joined = pgProtect.join("\n");
    expect(joined).toContain("RAISE EXCEPTION");
    expect(joined).not.toContain("DO INSTEAD NOTHING");
  });

  test("auditLogProtectSql parameterizes the table name for custom audit tables", () => {
    for (const statement of sqliteProtectFor("platform_audit_log")) {
      expect(statement).toContain("platform_audit_log");
      expect(statement).not.toContain("ON audit_log");
    }
    for (const statement of pgProtectFor("platform_audit_log")) {
      expect(statement).toContain("platform_audit_log");
    }
  });
});
