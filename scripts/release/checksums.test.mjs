import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateSha256sums, parseSha256sums, sha256File } from "./checksums.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mos-release-checksums-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("sha256File 与 node crypto 直算一致，且支持跨多个 1MB 分块", async (t) => {
  const directory = await fixture(t);
  // 2.5MB 随机内容：按 1MB 分块会跨 3 块，验证分块边界不吞字节。
  const payload = Buffer.alloc(2 * 1024 * 1024 + 512 * 1024);
  for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251;
  const bigFile = join(directory, "big.bin");
  await writeFile(bigFile, payload);
  const expected = createHash("sha256").update(payload).digest("hex");
  assert.equal(await sha256File(bigFile), expected);
  // 显式小分块再验一次边界（100 字节内容 / 64 字节分块）。
  const smallFile = join(directory, "small.bin");
  await writeFile(smallFile, Buffer.alloc(100, 7));
  assert.equal(
    await sha256File(smallFile, { chunkSizeBytes: 64 }),
    createHash("sha256").update(Buffer.alloc(100, 7)).digest("hex"),
  );
  await assert.rejects(sha256File(join(directory, "missing.bin")));
  await assert.rejects(sha256File(smallFile, { chunkSizeBytes: 0 }));
});

test("generateSha256sums 输出 sha256sum 兼容行（两个空格 + 文件名）", async (t) => {
  const directory = await fixture(t);
  const first = join(directory, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  const second = join(directory, "MOS-3.0.0-rc.1-linux-x64.deb");
  await writeFile(first, "linux-appimage-bytes");
  await writeFile(second, "linux-deb-bytes");
  const text = await generateSha256sums([
    { path: first },
    { path: second, filename: "MOS-3.0.0-rc.1-linux-x64.deb" },
  ]);
  const lines = text.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^[0-9a-f]{64} {2}MOS-3\.0\.0-rc\.1-linux-x64\.AppImage$/u);
  assert.match(lines[1], /^[0-9a-f]{64} {2}MOS-3\.0\.0-rc\.1-linux-x64\.deb$/u);
  // 与 parseSha256sums 互为逆操作。
  const parsed = parseSha256sums(text);
  assert.equal(parsed[0].sha256, createHash("sha256").update("linux-appimage-bytes").digest("hex"));
  assert.equal(parsed[0].filename, "MOS-3.0.0-rc.1-linux-x64.AppImage");
});

test("parseSha256sums 拒绝非标准行（宁可失败不可误判）", () => {
  assert.throws(() => parseSha256sums("deadbeef  file.bin"), /行格式不合法/u);
  assert.throws(() => parseSha256sums(`${"a".repeat(64)} file.bin`), /行格式不合法/u);
  assert.deepEqual(parseSha256sums("\n\n"), []);
});

test("空产物列表生成空清单文本（调用方负责在空集上失败）", async () => {
  assert.equal(await generateSha256sums([]), "\n");
});
