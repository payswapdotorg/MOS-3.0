import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MuseExecStartupError,
  assertMuseWorkspaceContainment,
  canResumeMuseSessionMapping,
  resolveMuseWorkspaceRootPhysical,
  sameMuseWorkspaceRootLexically,
} from "../src/muse-code/muse-exec-support.js";
// workspace 判定单元测试（Issue #24 / ACR-0002；PR #27 评审 rev. 3 + 验证轮修正 A/B）：
// 词法归一比较 + canonical 物理根 resume 门控（验证轮修正 A：映射持久化 canonical
// 根，每次续接重新物理解析当前根——真 symlink 在 POSIX 上验证，Windows junction
// 经注入的 realpath 模拟同一解析语义；symlink retarget 后必须拒绝续接）+ 收敛校验
// 的物理复核（验证轮修正 B：物理解析失败（ENOENT/EACCES）= spawn 前拒绝，绝无
// 「词法兜底通过」）。这是 mock 单元证据，不是真实 Windows junction 的执行证据
// （AGENTS.md §7：contract-tested；在机清单见 evidence §4）。

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

describe("resolveMuseWorkspaceRootPhysical", () => {
  it("resolves existing roots and reports unresolvable ones as undefined (never guesses)", async () => {
    const parent = await tempParent("muse-resolve-");
    const real = join(parent, "real");
    const alias = join(parent, "alias");
    await mkdir(real);
    await symlink(real, alias);
    // 别名解析到同一物理根。
    expect(await resolveMuseWorkspaceRootPhysical(alias)).toBe(real);
    // ENOENT（不存在）= undefined（不猜测）。
    expect(await resolveMuseWorkspaceRootPhysical(join(parent, "missing"))).toBeUndefined();
    // EACCES（注入 realpath 模拟权限拒绝——root 运行的环境上真实 chmod 不会失败）。
    expect(
      await resolveMuseWorkspaceRootPhysical(real, {
        realpath: async () => {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        },
      }),
    ).toBeUndefined();
  });
});

describe("canResumeMuseSessionMapping (resume gate, 验证轮修正 A)", () => {
  it("keeps continuity when the current root resolves to the stored canonical root (alias continuity)", async () => {
    const parent = await tempParent("muse-root-alias-");
    const real = join(parent, "real");
    const alias = join(parent, "alias");
    await mkdir(real);
    await symlink(real, alias);
    // 映射记录 canonical 物理根；当前请求经别名到达同一物理目录 → 续接保持。
    await expect(
      canResumeMuseSessionMapping({ canonicalWorkspaceRoot: real }, alias),
    ).resolves.toBe(true);
    await expect(
      canResumeMuseSessionMapping({ canonicalWorkspaceRoot: real }, real),
    ).resolves.toBe(true);
  });

  it("refuses resume after the workspace symlink is retargeted even though the path string is identical", async () => {
    const parent = await tempParent("muse-root-retarget-");
    const first = join(parent, "ws-one");
    const second = join(parent, "ws-two");
    const link = join(parent, "link");
    await mkdir(first);
    await mkdir(second);
    await symlink(first, link);
    // 映射建立时 link → ws-one：canonical 根 = ws-one。
    const canonicalAtRecord = (await resolveMuseWorkspaceRootPhysical(link)) ?? "";
    expect(canonicalAtRecord).toBe(first);
    // retarget：link → ws-two（同一路径串，物理目标已换）→ 拒绝续接旧会话。
    await rm(link);
    await symlink(second, link);
    await expect(
      canResumeMuseSessionMapping({ canonicalWorkspaceRoot: canonicalAtRecord }, link),
    ).resolves.toBe(false);
    // 新物理根的映射可以续接（连续性在当前根内自愈）。
    await expect(
      canResumeMuseSessionMapping({ canonicalWorkspaceRoot: second }, link),
    ).resolves.toBe(true);
  });

  it("refuses resume for legacy mappings without a canonical root (fail-closed)", async () => {
    const parent = await tempParent("muse-root-legacy-");
    const real = join(parent, "real");
    await mkdir(real);
    // 旧版映射（无 canonicalWorkspaceRoot）/记录时不可解析（空串）→ 拒绝续接，
    // 当前根内开新会话。
    await expect(
      canResumeMuseSessionMapping({ canonicalWorkspaceRoot: "" }, real),
    ).resolves.toBe(false);
  });

  it("treats different physical roots as different even when lexically close", async () => {
    const parent = await tempParent("muse-root-diff-");
    const first = join(parent, "ws-a");
    const second = join(parent, "ws-b");
    await mkdir(first);
    await mkdir(second);
    await expect(
      canResumeMuseSessionMapping({ canonicalWorkspaceRoot: first }, second),
    ).resolves.toBe(false);
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
      canResumeMuseSessionMapping(
        { canonicalWorkspaceRoot: "D:\\real-ws" },
        "C:\\ws\\junction",
        { realpath: junctionRealpath },
      ),
    ).resolves.toBe(true);
    // 别名解析后的目标 ≠ 另一个物理根 → 不同根（fail-closed，不续接）。
    await expect(
      canResumeMuseSessionMapping(
        { canonicalWorkspaceRoot: "D:\\other-ws" },
        "C:\\ws\\junction",
        { realpath: junctionRealpath },
      ),
    ).resolves.toBe(false);
  });

  it("refuses resume when the current root cannot be resolved (ENOENT/EACCES)", async () => {
    const parent = await tempParent("muse-root-missing-");
    const existing = join(parent, "exists");
    await mkdir(existing);
    // 当前根不存在（ENOENT）→ 拒绝续接。
    await expect(
      canResumeMuseSessionMapping(
        { canonicalWorkspaceRoot: existing },
        join(parent, "missing"),
      ),
    ).resolves.toBe(false);
    // 当前根不可达（EACCES，注入模拟）→ 拒绝续接。
    await expect(
      canResumeMuseSessionMapping({ canonicalWorkspaceRoot: existing }, existing, {
        realpath: async () => {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        },
      }),
    ).resolves.toBe(false);
  });
});

describe("assertMuseWorkspaceContainment (physical layer, 验证轮修正 B)", () => {
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
    await mkdir(join(sub, "nested"), { recursive: true });
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

  it("rejects unresolvable boundaries before spawn instead of falling back to the lexical verdict (ENOENT)", async () => {
    const parent = await tempParent("muse-contain-missing-");
    const root = join(parent, "ws");
    await mkdir(root);
    // cwd 不存在（ENOENT）→ spawn 前拒绝（workspaceUnresolvable），绝无词法兜底通过。
    await expect(
      assertMuseWorkspaceContainment(join(root, "missing-cwd"), root),
    ).rejects.toMatchObject({
      issueCode: "workspaceUnresolvable",
      name: "MuseExecStartupError",
    });
    // 根不存在（ENOENT）→ 同样 spawn 前拒绝。
    await expect(
      assertMuseWorkspaceContainment(join(parent, "gone-root", "sub"), join(parent, "gone-root")),
    ).rejects.toMatchObject({ issueCode: "workspaceUnresolvable" });
  });

  it("rejects inaccessible boundaries before spawn (EACCES via the injected realpath)", async () => {
    const parent = await tempParent("muse-contain-eacces-");
    const root = join(parent, "ws");
    await mkdir(join(root, "sub"), { recursive: true });
    const eaccesRealpath = async (path: string): Promise<string> => {
      // 只让根的解析失败（cwd 可解析）——单侧失败同样必须拒绝。
      if (path === root) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return path;
    };
    await expect(
      assertMuseWorkspaceContainment(join(root, "sub"), root, { realpath: eaccesRealpath }),
    ).rejects.toMatchObject({ issueCode: "workspaceUnresolvable" });
    // 双侧都失败（注入统一 EACCES）同样拒绝。
    await expect(
      assertMuseWorkspaceContainment(
        join(root, "sub"),
        root,
        {
          realpath: async () => {
            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
          },
        },
      ),
    ).rejects.toMatchObject({ issueCode: "workspaceUnresolvable" });
  });
});
