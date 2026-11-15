import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MuseExecStartupError,
  assertMuseWorkspaceContainment,
  isSameMuseWorkspaceRoot,
  sameMuseWorkspaceRootLexically,
} from "../src/muse-code/muse-exec-support.js";
// workspace 判定单元测试（Issue #24 / ACR-0002；PR #27 评审 rev. 3）：
// 词法归一比较 + realpath 别名解析（真 symlink 在 POSIX 上验证；Windows junction
// 经注入的 realpath 模拟同一解析语义）+ 收敛校验的物理复核（词法在界内、物理在
// 界外 = 越界，fail-closed）。这是 mock 单元证据，不是真实 Windows junction 的
// 执行证据（AGENTS.md §7：contract-tested；在机清单见 evidence §4）。

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop!()?.().catch(() => undefined);
  }
});

async function tempParent(prefix: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(parent, { force: true, recursive: true }));
  return parent;
}

describe("sameMuseWorkspaceRootLexically", () => {
  it("normalizes separators, trailing separators and device-path prefixes", () => {
    expect(sameMuseWorkspaceRootLexically("/ws/root", "/ws/root/")).toBe(true);
    expect(sameMuseWorkspaceRootLexically("/ws/root//", "/ws/root")).toBe(true);
    expect(sameMuseWorkspaceRootLexically("C:\\ws\\root", "C:/ws/root")).toBe(true);
    expect(sameMuseWorkspaceRootLexically("\\\\?\\C:\\ws\\root", "C:\\ws\\root")).toBe(true);
    expect(sameMuseWorkspaceRootLexically("  /ws/root ", "/ws/root")).toBe(true);
  });

  it("keeps distinct roots distinct (no prefix/containment loosening)", () => {
    expect(sameMuseWorkspaceRootLexically("/ws/root", "/ws/root-2")).toBe(false);
    expect(sameMuseWorkspaceRootLexically("/ws/root", "/ws/root/sub")).toBe(false);
    expect(sameMuseWorkspaceRootLexically("/ws/root", "/other/root")).toBe(false);
    expect(sameMuseWorkspaceRootLexically("", "/ws/root")).toBe(false);
    expect(sameMuseWorkspaceRootLexically("", "")).toBe(false);
  });

  // win32 盘符/路径大小写归一仅在实际 win32 平台生效（与 isInsideMuseWorkspace
  // 同策略：POSIX 保持大小写敏感）。
  if (process.platform === "win32") {
    it("folds drive and path case on win32", () => {
      expect(sameMuseWorkspaceRootLexically("C:\\WS\\Root", "c:\\ws\\root")).toBe(true);
    });
  } else {
    it("keeps POSIX paths case-sensitive", () => {
      expect(sameMuseWorkspaceRootLexically("/ws/Root", "/ws/root")).toBe(false);
    });
  }
});

describe("isSameMuseWorkspaceRoot (resume gate)", () => {
  it("resolves real symlinks to the same physical root (alias continuity)", async () => {
    const parent = await tempParent("muse-root-alias-");
    const real = join(parent, "real");
    const alias = join(parent, "alias");
    await mkdir(real);
    await symlink(real, alias);
    await expect(isSameMuseWorkspaceRoot(real, alias)).resolves.toBe(true);
    await expect(isSameMuseWorkspaceRoot(alias, real)).resolves.toBe(true);
    // 尾分隔符差异在词法层就归一。
    await expect(isSameMuseWorkspaceRoot(`${real}/`, real)).resolves.toBe(true);
  });

  it("treats different physical roots as different even when lexically close", async () => {
    const parent = await tempParent("muse-root-diff-");
    const first = join(parent, "ws-a");
    const second = join(parent, "ws-b");
    await mkdir(first);
    await mkdir(second);
    await expect(isSameMuseWorkspaceRoot(first, second)).resolves.toBe(false);
  });

  it("keeps continuity across Windows-junction aliases via the injectable realpath", async () => {
    // Windows junction：C:\ws\junction → D:\real-ws（POSIX 上无法创建真 junction，
    // 注入的 realpath 模拟 junction 的解析语义——别名与目标解析到同一物理目录）。
    const junctionRealpath = async (path: string): Promise<string> => {
      if (path === "C:\\ws\\junction") return "D:\\real-ws";
      if (path === "C:\\ws\\junction\\sub") return "D:\\real-ws\\sub";
      return path;
    };
    await expect(
      isSameMuseWorkspaceRoot("C:\\ws\\junction", "D:\\real-ws", {
        realpath: junctionRealpath,
      }),
    ).resolves.toBe(true);
    // 别名解析后的目标 ≠ 另一个物理根 → 不同根（fail-closed，不续接）。
    await expect(
      isSameMuseWorkspaceRoot("C:\\ws\\junction", "D:\\other-ws", {
        realpath: junctionRealpath,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed (different) when either root cannot be resolved", async () => {
    const parent = await tempParent("muse-root-missing-");
    const existing = join(parent, "exists");
    await mkdir(existing);
    await expect(
      isSameMuseWorkspaceRoot(existing, join(parent, "missing")),
    ).resolves.toBe(false);
    await expect(
      isSameMuseWorkspaceRoot(join(parent, "missing"), existing),
    ).resolves.toBe(false);
  });
});

describe("assertMuseWorkspaceContainment (physical layer)", () => {
  it("rejects a working directory that is lexically inside but physically outside via symlink", async () => {
    const parent = await tempParent("muse-contain-escape-");
    const root = join(parent, "ws");
    const outside = join(parent, "outside");
    const link = join(root, "link");
    await mkdir(root);
    await mkdir(join(outside, "sub"), { recursive: true });
    await symlink(outside, link);
    // 词法在界内（ws/link）、物理在界外（outside）→ fail-closed。
    await expect(assertMuseWorkspaceContainment(link, root)).rejects.toThrow(
      /inside the workspace root/i,
    );
    await expect(
      assertMuseWorkspaceContainment(join(link, "sub"), root),
    ).rejects.toThrow(/symlink\/junction/i);
  });

  it("allows a symlinked working directory that still resolves inside the root", async () => {
    const parent = await tempParent("muse-contain-allow-");
    const root = join(parent, "ws");
    const sub = join(root, "sub");
    const alias = join(root, "alias");
    await mkdir(sub, { recursive: true });
    await symlink(sub, alias);
    await expect(assertMuseWorkspaceContainment(alias, root)).resolves.toBeUndefined();
    // 别名下的嵌套路径（词法+物理都在界内）同样放行。
    await expect(
      assertMuseWorkspaceContainment(join(alias, "nested"), root),
    ).resolves.toBeUndefined();
  });

  it("rejects junction escapes with the injected realpath (Windows junction semantics)", async () => {
    // junction 指向根外：/ws/junction → /elsewhere（注入 realpath 模拟解析语义；
    // POSIX 绝对路径保持词法层语义清晰）。
    const escapingRealpath = async (path: string): Promise<string> =>
      path.startsWith("/ws/junction") ? path.replace("/ws/junction", "/elsewhere") : path;
    await expect(
      assertMuseWorkspaceContainment("/ws/junction/sub", "/ws", {
        realpath: escapingRealpath,
      }),
    ).rejects.toThrow(MuseExecStartupError);
    // junction 指向根内：/ws/junction → /ws/inside → 词法+物理都在界内，放行。
    const insideRealpath = async (path: string): Promise<string> =>
      path.startsWith("/ws/junction") ? path.replace("/ws/junction", "/ws/inside") : path;
    await expect(
      assertMuseWorkspaceContainment("/ws/junction/sub", "/ws", {
        realpath: insideRealpath,
      }),
    ).resolves.toBeUndefined();
  });

  it("falls back to the lexical verdict when resolution is unavailable", async () => {
    // 路径不存在：realpath 失败 → 词法判定兜底（spawn 自身失败是自然收口）。
    await expect(
      assertMuseWorkspaceContainment("/definitely/not/present/cwd", "/definitely/not/present"),
    ).resolves.toBeUndefined();
    await expect(
      assertMuseWorkspaceContainment("/elsewhere/missing", "/definitely/not/present"),
    ).rejects.toThrow(/inside the workspace root/i);
  });
});
