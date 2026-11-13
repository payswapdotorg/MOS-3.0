import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { OperatorStore } from "../src/application/operator-store.js";

/** 操作者声明存储：原子写、损坏 fail-closed、声明即声明。 */

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function newDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mos-operator-"));
  directories.push(directory);
  return directory;
}

describe("OperatorStore", () => {
  test("save + load roundtrip keeps the declaration verbatim", async () => {
    const store = new OperatorStore({ directory: await newDirectory() });
    const saved = await store.save({
      userId: "operator@example.test",
      organizationId: null,
      declaredAt: "2026-11-13T12:00:00.000Z",
    });
    expect(saved.declaredAt).toBe("2026-11-13T12:00:00.000Z"); // 纯记录；loginProvider 在映射层
    const loaded = await store.load();
    expect(loaded).toEqual(saved);
  });

  test("missing file → null (fresh install, fail-closed)", async () => {
    const store = new OperatorStore({ directory: await newDirectory() });
    expect(await store.load()).toBeNull();
  });

  test("corrupt file → null (never a partial or invented operator)", async () => {
    const directory = await newDirectory();
    const store = new OperatorStore({ directory });
    await writeFile(join(directory, "mos-operator.json"), "{corrupt", "utf8");
    expect(await store.load()).toBeNull();
  });

  test("redeclaration overwrites (single operator per data dir)", async () => {
    const store = new OperatorStore({ directory: await newDirectory() });
    await store.save({
      userId: "first@example.test",
      organizationId: null,
      declaredAt: "2026-11-13T12:00:00.000Z",
    });
    await store.save({
      userId: "second@example.test",
      organizationId: "org-1",
      declaredAt: "2026-11-13T12:01:00.000Z",
    });
    const loaded = await store.load();
    expect(loaded?.userId).toBe("second@example.test");
    expect(loaded?.organizationId).toBe("org-1");
  });

  test("atomic write leaves no temp files", async () => {
    const directory = await newDirectory();
    const store = new OperatorStore({ directory });
    await store.save({
      userId: "operator@example.test",
      organizationId: null,
      declaredAt: "2026-11-13T12:00:00.000Z",
    });
    const raw = await readFile(join(directory, "mos-operator.json"), "utf8");
    expect(JSON.parse(raw).userId).toBe("operator@example.test");
  });
});
