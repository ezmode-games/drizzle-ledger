import { describe, expect, test } from "vitest";
import {
  DEFAULT_SECRET_PATTERNS,
  REDACTED_VALUE,
  redactSensitiveFields,
} from "../../src/core/redact.js";

describe("redactSensitiveFields", () => {
  test("redacts default secret patterns as case-insensitive substrings", () => {
    const data = {
      accessToken: "gho_abc",
      refresh_token: "ghr_def",
      IdToken: "eyJ",
      clientSecret: "shh",
      passwordHash: "argon2",
      ApiKey: "sk-1",
      api_key: "sk-2",
      keep: "visible",
    };

    const result = redactSensitiveFields(data) as Record<string, unknown>;

    expect(result.accessToken).toBe(REDACTED_VALUE);
    expect(result.refresh_token).toBe(REDACTED_VALUE);
    expect(result.IdToken).toBe(REDACTED_VALUE);
    expect(result.clientSecret).toBe(REDACTED_VALUE);
    expect(result.passwordHash).toBe(REDACTED_VALUE);
    expect(result.ApiKey).toBe(REDACTED_VALUE);
    expect(result.api_key).toBe(REDACTED_VALUE);
    expect(result.keep).toBe("visible");
  });

  test("replaces the entire value under a matching key, object or not", () => {
    const data = { tokens: { access: "a", refresh: "b" } };
    const result = redactSensitiveFields(data) as Record<string, unknown>;

    expect(result.tokens).toBe(REDACTED_VALUE);
  });

  test("recurses into nested objects and arrays; arrays stay arrays", () => {
    const data = {
      accounts: [{ accessToken: "t1", provider: "github" }, { provider: "google" }],
      nested: { deep: { password: "p" } },
    };
    const result = redactSensitiveFields(data) as {
      accounts: { accessToken?: string; provider: string }[];
      nested: { deep: { password: string } };
    };

    expect(Array.isArray(result.accounts)).toBe(true);
    expect(result.accounts[0].accessToken).toBe(REDACTED_VALUE);
    expect(result.accounts[0].provider).toBe("github");
    expect(result.nested.deep.password).toBe(REDACTED_VALUE);
  });

  test("supports extra patterns", () => {
    const data = { ssn: "123-45-6789", name: "keep" };
    const result = redactSensitiveFields(data, ["ssn"]) as Record<string, unknown>;

    expect(result.ssn).toBe(REDACTED_VALUE);
    expect(result.name).toBe("keep");
  });

  test("does not mutate the input", () => {
    const data = { accessToken: "gho_abc" };
    redactSensitiveFields(data);

    expect(data.accessToken).toBe("gho_abc");
  });

  test("Date instances round-trip intact, not flattened to {}", () => {
    const createdAt = new Date("2026-08-02T12:00:00Z");
    const data = { id: "u1", createdAt, accessToken: "gho_x" };
    const result = redactSensitiveFields(data) as Record<string, unknown>;

    expect(result.createdAt).toBe(createdAt);
    expect(result.createdAt).toBeInstanceOf(Date);
    // Serialization keeps the ISO string, not "{}"
    expect(JSON.stringify(result)).toContain("2026-08-02T12:00:00.000Z");
  });

  test("null and primitives pass through", () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields("plain")).toBe("plain");
    expect(redactSensitiveFields(42)).toBe(42);
  });

  test("a literal __proto__ key cannot swap the prototype", () => {
    const parsed = JSON.parse('{"__proto__":{"isAdmin":true},"id":"1"}') as Record<string, unknown>;
    const result = redactSensitiveFields(parsed) as Record<string, unknown>;

    expect(JSON.stringify(result)).toBe('{"__proto__":{"isAdmin":true},"id":"1"}');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect((result as { isAdmin?: unknown }).isAdmin).toBeUndefined();
  });

  test("default pattern list is the documented set", () => {
    expect(DEFAULT_SECRET_PATTERNS).toEqual(["token", "secret", "password", "apikey", "api_key"]);
  });
});
