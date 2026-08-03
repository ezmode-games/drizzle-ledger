import { describe, expect, test, vi } from "vitest";
import { isUserDataPurged, purgeUserData } from "../../src/drizzle/gdpr.js";

describe("purgeUserData", () => {
  test("anonymizes audit entries for user", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: JSON.stringify({ email: "old@test.com", id: "user-123" }),
        newData: JSON.stringify({ email: "new@test.com", id: "user-123" }),
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "Mozilla/5.0",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    const result = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
      { piiFields: ["email", "name", "ip"] },
    );

    expect(result.entriesAnonymized).toBe(1);
    expect(result.tablesProcessed).toEqual(["users"]);

    // Verify anonymization
    expect(updatedValues).toHaveLength(1);
    expect(updatedValues[0].userId).toBe("PURGED_USER");
    expect(updatedValues[0].ip).toBeNull();
    expect(updatedValues[0].userAgent).toBeNull();

    // Verify JSON data was anonymized
    const oldData = JSON.parse(updatedValues[0].oldData as string);
    const newData = JSON.parse(updatedValues[0].newData as string);
    expect(oldData.email).toBeUndefined();
    expect(oldData.id).toBe("user-123");
    expect(newData.email).toBeUndefined();
    expect(newData.id).toBe("user-123");
  });

  test("preserves audit trail structure", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: JSON.stringify({ email: "test@test.com" }),
        newData: null,
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "Mozilla/5.0",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    // Verify null newData is preserved as null
    expect(updatedValues[0].newData).toBeNull();
  });

  test("returns zero when no entries found", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn(),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    const result = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "nonexistent-user",
    );

    expect(result.entriesAnonymized).toBe(0);
    expect(result.tablesProcessed).toEqual([]);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  test("handles multiple entries across tables", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "INSERT",
        oldData: null,
        newData: JSON.stringify({ email: "test@test.com" }),
        userId: "user-123",
        ip: "1.1.1.1",
        userAgent: "UA1",
        createdAt: new Date(),
      },
      {
        id: "entry-2",
        tableName: "accounts",
        recordId: "acc-456",
        action: "INSERT",
        oldData: null,
        newData: JSON.stringify({ provider: "discord" }),
        userId: "user-123",
        ip: "2.2.2.2",
        userAgent: "UA2",
        createdAt: new Date(),
      },
      {
        id: "entry-3",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: JSON.stringify({ name: "Old" }),
        newData: JSON.stringify({ name: "New" }),
        userId: "user-123",
        ip: "3.3.3.3",
        userAgent: "UA3",
        createdAt: new Date(),
      },
    ];

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    const result = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    expect(result.entriesAnonymized).toBe(3);
    expect(result.tablesProcessed.sort()).toEqual(["accounts", "users"]);
  });

  test("uses custom anonymizedUserId", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: null,
        newData: null,
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "UA",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
      { piiFields: [], anonymizedUserId: "DELETED_USER_123" },
    );

    expect(updatedValues[0].userId).toBe("DELETED_USER_123");
  });

  test("handles malformed JSON gracefully", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: "not valid json",
        newData: '{"valid": "json"}',
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "UA",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    // Should not throw
    const result = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    expect(result.entriesAnonymized).toBe(1);
    // Unreadable JSON is flagged for manual attention
    expect(result.entriesSkipped).toBe(1);
    // Malformed JSON is left byte-for-byte untouched, never destroyed
    expect(updatedValues[0].oldData).toBe("not valid json");
    // Valid JSON is anonymized
    expect(updatedValues[0].newData).toBe('{"valid":"json"}');
  });

  test("scalar JSON payloads round-trip as their JSON text, not null", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "counters",
        recordId: "user-123",
        action: "UPDATE",
        oldData: "0",
        newData: "false",
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "UA",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    // Falsy-but-valid scalars must not collapse to SQL NULL
    expect(updatedValues[0].oldData).toBe("0");
    expect(updatedValues[0].newData).toBe("false");
  });

  test("writes one PURGE audit entry recording the erasure, counts only", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: JSON.stringify({ email: "x@test.com" }),
        newData: null,
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "UA",
        createdAt: new Date(),
      },
    ];

    const insertedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return Promise.resolve();
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    expect(insertedValues).toHaveLength(1);
    const purgeEntry = insertedValues[0];
    expect(purgeEntry.action).toBe("PURGE");
    expect(purgeEntry.tableName).toBe("audit_log");
    // recordId is the anonymized placeholder -- storing the real id would
    // retain the identifier the purge removes
    expect(purgeEntry.recordId).toBe("PURGED_USER");
    const purgeReport = JSON.parse(purgeEntry.newData as string);
    expect(purgeReport.entriesAnonymized).toBe(1);
    expect(JSON.stringify(purgeEntry)).not.toContain("user-123");
    expect(JSON.stringify(purgeEntry)).not.toContain("x@test.com");
  });

  test("no PURGE entry when nothing matched", async () => {
    const insertSpy = vi.fn();
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: insertSpy,
      update: vi.fn(),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    const result = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "ghost-user",
    );

    expect(result.entriesSkipped).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("executes atomically via db.batch when the driver provides it", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: null,
        newData: null,
        userId: "user-123",
        ip: null,
        userAgent: null,
        createdAt: new Date(),
      },
      {
        id: "entry-2",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: null,
        newData: null,
        userId: "user-123",
        ip: null,
        userAgent: null,
        createdAt: new Date(),
      },
    ];

    const whereSpy = vi.fn().mockReturnValue({ kind: "update-statement" });
    const batchSpy = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ kind: "insert-statement" }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: whereSpy }),
      }),
      batch: batchSpy,
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    // One batch call containing every update statement plus the PURGE insert
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const statements = batchSpy.mock.calls[0][0];
    expect(statements).toHaveLength(3);
  });

  test("admin-edited message reached via ownedRecords: content scrubbed, admin identity preserved", async () => {
    // The AC1 scenario end-to-end: entry written by an admin about the
    // user's message -- unreachable by userId/recordId matching, reached
    // only via ownedRecords -- gets its JSON anonymized while the
    // admin's identity fields survive.
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "messages",
        recordId: "msg-1",
        action: "UPDATE",
        oldData: JSON.stringify({ subject: "hi", body: "full email body", email: "u@test.com" }),
        newData: JSON.stringify({ subject: "hi", body: "edited body", email: "u@test.com" }),
        userId: "admin-456",
        ip: "10.0.0.1",
        userAgent: "AdminUA",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
      tableName: { name: "table_name" },
    };

    const result = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
      {
        piiFields: ["email", "subject", "body"],
        ownedRecords: [{ tableName: "messages", recordIds: ["msg-1"] }],
      },
    );

    expect(result.entriesAnonymized).toBe(1);
    // Message content scrubbed
    const newData = JSON.parse(updatedValues[0].newData as string);
    expect(newData.body).toBeUndefined();
    expect(newData.subject).toBeUndefined();
    expect(newData.email).toBeUndefined();
    // Admin identity preserved -- they are not the purged user
    expect(updatedValues[0].userId).toBe("admin-456");
    expect(updatedValues[0].ip).toBe("10.0.0.1");
    expect(updatedValues[0].userAgent).toBe("AdminUA");
  });

  test("each re-run appends its own PURGE entry -- gate on isUserDataPurged", async () => {
    const insertedValues: Record<string, unknown>[] = [];
    const makeDb = (entries: unknown[]) => ({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(entries),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return Promise.resolve();
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    // recordId-matched entries survive the first purge (recordId is
    // never rewritten), so a second run finds and re-processes them
    const persistentEntry = {
      id: "entry-1",
      tableName: "users",
      recordId: "user-123",
      action: "UPDATE",
      oldData: null,
      newData: null,
      userId: "PURGED_USER",
      ip: null,
      userAgent: null,
      createdAt: new Date(),
    };

    await purgeUserData(
      makeDb([persistentEntry]) as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );
    await purgeUserData(
      makeDb([persistentEntry]) as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    // Documented behavior: one PURGE entry per run
    expect(insertedValues.filter((v) => v.action === "PURGE")).toHaveLength(2);
  });

  test("ownedRecords extends the match to records the user owns", async () => {
    const whereConditions: unknown[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((condition: unknown) => {
            whereConditions.push(condition);
            return Promise.resolve([]);
          }),
        }),
      }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
      tableName: { name: "table_name" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
      { ownedRecords: [{ tableName: "messages", recordIds: ["msg-1", "msg-2"] }] },
    );

    // The WHERE condition is a drizzle SQL object composed with the
    // ownership clause; serialize its chunks to prove inclusion.
    expect(whereConditions).toHaveLength(1);
    const conditionText = JSON.stringify(whereConditions[0]);
    expect(conditionText).toContain("msg-1");
    expect(conditionText).toContain("msg-2");
  });

  test("preserves array-shaped JSON payloads as arrays", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "messages",
        recordId: "user-123",
        action: "UPDATE",
        oldData: JSON.stringify([{ email: "a@test.com", id: "1" }, "keep-me", 42]),
        newData: JSON.stringify({ recipients: [{ email: "b@test.com", id: "2" }] }),
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "UA",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    // Top-level array survives as an array, not {"0": ..., "1": ...}
    expect(JSON.parse(updatedValues[0].oldData as string)).toEqual([{ id: "1" }, "keep-me", 42]);
    // Nested arrays survive too
    expect(JSON.parse(updatedValues[0].newData as string)).toEqual({ recipients: [{ id: "2" }] });
  });

  test("preserves userId for entries by other users about this user", async () => {
    const mockEntries = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123", // This is about user-123
        action: "UPDATE",
        oldData: null,
        newData: null,
        userId: "admin-456", // But admin made the change
        ip: "1.2.3.4",
        userAgent: "UA",
        createdAt: new Date(),
      },
    ];

    const updatedValues: Record<string, unknown>[] = [];
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntries),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updatedValues.push(values);
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    // Admin's userId, ip, and userAgent should be preserved since they're not the purged user
    expect(updatedValues[0].userId).toBe("admin-456");
    expect(updatedValues[0].ip).toBe("1.2.3.4");
    expect(updatedValues[0].userAgent).toBe("UA");
  });

  test("idempotent - safe to run multiple times", async () => {
    // First run
    const mockEntriesFirstRun = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: JSON.stringify({ email: "test@test.com" }),
        newData: null,
        userId: "user-123",
        ip: "1.2.3.4",
        userAgent: "UA",
        createdAt: new Date(),
      },
    ];

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockEntriesFirstRun),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const mockAuditTable = {
      id: { name: "id" },
      userId: { name: "user_id" },
      recordId: { name: "record_id" },
    };

    // First purge
    const result1 = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    expect(result1.entriesAnonymized).toBe(1);

    // Simulate second run where entries now have PURGED_USER
    const mockEntriesSecondRun = [
      {
        id: "entry-1",
        tableName: "users",
        recordId: "user-123",
        action: "UPDATE",
        oldData: JSON.stringify({ id: "user-123" }), // email already removed
        newData: null,
        userId: "PURGED_USER", // already anonymized
        ip: null, // already nullified
        userAgent: null, // already nullified
        createdAt: new Date(),
      },
    ];

    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(mockEntriesSecondRun),
      }),
    });

    // Second purge - should still work without error
    const result2 = await purgeUserData(
      mockDb as unknown as Parameters<typeof purgeUserData>[0],
      mockAuditTable as unknown as Parameters<typeof purgeUserData>[1],
      "user-123",
    );

    expect(result2.entriesAnonymized).toBe(1);
  });
});

describe("isUserDataPurged", () => {
  test("returns true when no entries exist for userId", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // Empty array = no entries
        }),
      }),
    };

    const mockAuditTable = {
      userId: { name: "user_id" },
    };

    const result = await isUserDataPurged(
      mockDb as unknown as Parameters<typeof isUserDataPurged>[0],
      mockAuditTable as unknown as Parameters<typeof isUserDataPurged>[1],
      "purged-user",
    );

    expect(result).toBe(true);
  });

  test("returns false when entries exist for userId", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]), // Non-empty = has entries
        }),
      }),
    };

    const mockAuditTable = {
      userId: { name: "user_id" },
    };

    const result = await isUserDataPurged(
      mockDb as unknown as Parameters<typeof isUserDataPurged>[0],
      mockAuditTable as unknown as Parameters<typeof isUserDataPurged>[1],
      "active-user",
    );

    expect(result).toBe(false);
  });
});
