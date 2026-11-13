import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertTagIsMosOwned,
  isReleaseCandidate,
  parseMosVersion,
  releaseChannelForVersion,
} from "./mos-version.mjs";

test("parseMosVersion 接受裸 semver 与 mos-v 标签两种形态", () => {
  assert.deepEqual(parseMosVersion("3.0.0-rc.1"), {
    version: "3.0.0-rc.1",
    tag: "mos-v3.0.0-rc.1",
  });
  assert.deepEqual(parseMosVersion("mos-v3.0.0"), { version: "3.0.0", tag: "mos-v3.0.0" });
  assert.deepEqual(parseMosVersion(" 3.1.4 "), { version: "3.1.4", tag: "mos-v3.1.4" });
});

test("parseMosVersion 拒绝上游 ZCode 标签形态与非 semver 输入", () => {
  // 上游形态 v3.18.x 绝不能进入 MOS 发布链路（backlog §1.3：不与上游标签混用）。
  for (const invalid of [
    "v3.18.0",
    "v3.18.1",
    "v3.0.0-rc.1",
    "3.18.x",
    "3.0",
    "3.0.0.1",
    "mos-3.0.0",
    "",
    "latest",
    "3.0.0+build",
  ]) {
    assert.throws(() => parseMosVersion(invalid), undefined, `应拒绝：${invalid}`);
  }
  assert.throws(() => parseMosVersion(3), /必须是字符串/u);
});

test("isReleaseCandidate 与通道判定：预发布段 => rc，否则 stable", () => {
  assert.equal(isReleaseCandidate("3.0.0-rc.1"), true);
  assert.equal(isReleaseCandidate("3.0.0"), false);
  // isReleaseCandidate 是已验证版本上的判定，不做 semver 解析；非版本输入不在契约内。
  assert.equal(isReleaseCandidate("not-a-version"), true);
  assert.equal(isReleaseCandidate(undefined), false);
  assert.equal(releaseChannelForVersion("3.0.0-rc.1"), "rc");
  assert.equal(releaseChannelForVersion("3.0.0"), "stable");
});

test("assertTagIsMosOwned 只认 mos-v 前缀标签", () => {
  assert.deepEqual(assertTagIsMosOwned("mos-v3.0.0-rc.1"), {
    version: "3.0.0-rc.1",
    tag: "mos-v3.0.0-rc.1",
  });
  for (const invalid of ["v3.18.0", "3.0.0", "mos-v", "mos-v3.18.x", ""]) {
    assert.throws(() => assertTagIsMosOwned(invalid), undefined, `应拒绝：${invalid}`);
  }
});
