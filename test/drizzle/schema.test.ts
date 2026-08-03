import { describe, expect, test } from "vitest";
import { AUDIT_LOG_PROTECT_SQL as sqliteProtect } from "../../src/drizzle/schema/sqlite.js";
import { AUDIT_LOG_PROTECT_SQL as pgProtect } from "../../src/drizzle/schema/pg.js";
import { AUDIT_LOG_PROTECT_SQL as mysqlProtect } from "../../src/drizzle/schema/mysql.js";

describe("AUDIT_LOG_PROTECT_SQL", () => {
  test.each([
    ["sqlite", sqliteProtect],
    ["pg", pgProtect],
    ["mysql", mysqlProtect],
  ])("%s ships one update-blocking and one delete-blocking statement", (_dialect, statements) => {
    expect(statements).toHaveLength(2);
    const joined = statements.join("\n").toUpperCase();
    expect(joined).toContain("UPDATE");
    expect(joined).toContain("DELETE");
    for (const statement of statements) {
      expect(statement).toContain("audit_log");
    }
  });

  test("sqlite statements are RAISE(ABORT) triggers", () => {
    for (const statement of sqliteProtect) {
      expect(statement).toContain("RAISE(ABORT");
      expect(statement).toContain("CREATE TRIGGER");
    }
  });
});
