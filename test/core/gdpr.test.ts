import { describe, expect, test } from "vitest";
import { anonymizeJsonData } from "../../src/core/gdpr.js";

describe("anonymizeJsonData", () => {
  test("removes specified PII fields", () => {
    const data = { id: "123", email: "test@test.com", name: "John", role: "admin" };
    const result = anonymizeJsonData(data, ["email", "name"]);

    expect(result).toEqual({ id: "123", role: "admin" });
  });

  test("handles null input", () => {
    expect(anonymizeJsonData(null, ["email"])).toBeNull();
  });

  test("handles nested objects", () => {
    const data = { user: { email: "test@test.com", id: "123" } };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({ user: { id: "123" } });
  });

  test("handles deeply nested objects", () => {
    const data = {
      level1: {
        level2: {
          email: "deep@test.com",
          keepMe: "value",
        },
      },
    };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({
      level1: {
        level2: {
          keepMe: "value",
        },
      },
    });
  });

  test("handles arrays of objects", () => {
    const data = {
      users: [
        { id: "1", email: "a@test.com" },
        { id: "2", email: "b@test.com" },
      ],
    };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({
      users: [{ id: "1" }, { id: "2" }],
    });
  });

  test("handles arrays of primitives", () => {
    const data = { tags: ["tag1", "tag2"], email: "remove@test.com" };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({ tags: ["tag1", "tag2"] });
  });

  test("handles empty object", () => {
    expect(anonymizeJsonData({}, ["email"])).toEqual({});
  });

  test("preserves non-PII fields", () => {
    const data = {
      id: "user-123",
      createdAt: "2024-01-01",
      role: "admin",
      email: "remove@test.com",
    };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({
      id: "user-123",
      createdAt: "2024-01-01",
      role: "admin",
    });
  });

  test("matches keys case-insensitively", () => {
    const data = { Email: "a@test.com", EMAIL: "b@test.com", eMaIl: "c@test.com", role: "admin" };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({ role: "admin" });
  });

  test("does not match structural variants of a field name", () => {
    const data = { user_email: "a@test.com", emails: ["b@test.com"] };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({ user_email: "a@test.com", emails: ["b@test.com"] });
  });

  test("preserves top-level arrays as arrays", () => {
    const data = [{ email: "a@test.com", id: "1" }, { id: "2" }];
    const result = anonymizeJsonData(data, ["email"]);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ id: "1" }, { id: "2" }]);
  });

  test("preserves nested arrays at depth", () => {
    const data = { batches: [[{ email: "a@test.com", id: "1" }], [{ id: "2" }]] };
    const result = anonymizeJsonData(data, ["email"]);

    expect(result).toEqual({ batches: [[{ id: "1" }], [{ id: "2" }]] });
  });

  test("Date instances round-trip intact, not flattened to {}", () => {
    const createdAt = new Date("2026-08-02T12:00:00Z");
    const result = anonymizeJsonData({ id: "1", createdAt, email: "x@t.co" }, ["email"]) as Record<
      string,
      unknown
    >;

    expect(result.createdAt).toBe(createdAt);
    expect(JSON.stringify(result)).toContain("2026-08-02T12:00:00.000Z");
  });

  test("passes primitives through unchanged", () => {
    expect(anonymizeJsonData("a string", ["email"])).toBe("a string");
    expect(anonymizeJsonData(42, ["email"])).toBe(42);
    expect(anonymizeJsonData(true, ["email"])).toBe(true);
  });

  test("never throws on any JSON-representable shape", () => {
    const shapes: unknown[] = [
      null,
      0,
      -1.5,
      "",
      false,
      [],
      {},
      [[[]]],
      { a: { b: { c: [null, { email: "x" }] } } },
      [null, undefined, { email: null }],
    ];
    for (const shape of shapes) {
      expect(() => anonymizeJsonData(shape, ["email"])).not.toThrow();
    }
  });

  test("a literal __proto__ key round-trips as an own property, not a prototype swap", () => {
    const parsed = JSON.parse('{"__proto__":{"isAdmin":true},"id":"1"}') as Record<string, unknown>;
    const result = anonymizeJsonData(parsed, ["email"]) as Record<string, unknown>;

    // The key survives as data, visible to JSON.stringify
    expect(JSON.stringify(result)).toBe('{"__proto__":{"isAdmin":true},"id":"1"}');
    // The prototype was NOT swapped: no inherited isAdmin
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect((result as { isAdmin?: unknown }).isAdmin).toBeUndefined();
  });

  test("a nested __proto__ key round-trips too", () => {
    const parsed = JSON.parse('{"outer":{"__proto__":{"x":1},"keep":2}}') as Record<
      string,
      unknown
    >;
    const result = anonymizeJsonData(parsed, ["email"]) as Record<string, unknown>;

    expect(JSON.stringify(result)).toBe('{"outer":{"__proto__":{"x":1},"keep":2}}');
    const outer = result.outer as Record<string, unknown>;
    expect(Object.getPrototypeOf(outer)).toBe(Object.prototype);
  });

  test("handles mixed nested and top-level PII", () => {
    const data = {
      email: "top@test.com",
      profile: {
        name: "John",
        address: "123 Street",
        settings: {
          phone: "555-1234",
          theme: "dark",
        },
      },
    };
    const result = anonymizeJsonData(data, ["email", "name", "address", "phone"]);

    expect(result).toEqual({
      profile: {
        settings: {
          theme: "dark",
        },
      },
    });
  });
});
