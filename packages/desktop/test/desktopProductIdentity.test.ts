import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  desktopProductIdentities,
  resolveDesktopArtifactSuffix,
  resolveDesktopProductFlavor,
  resolveWindowsAppUserModelId,
  resolveWindowsAppUserModelIdForFlavor,
  resolveDesktopProductIdentity,
} from "../scripts/desktop-product-identity.mjs";

describe("desktop product identity", () => {
  it("根锁文件的发布版本与构建版本一致", () => {
    // 合并上游发布提交只对齐当前版本，不恢复上游旧版本，也不重算依赖锁。
    const readRootJson = (name: string) =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, "../../..", name), "utf8"));
    const version = readRootJson("package.json").version;
    const lock = readRootJson("package-lock.json");
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);
  });

  it("ZCODE_ENV=test 使用可与生产版并排安装的 Preview 身份", () => {
    expect(resolveDesktopProductIdentity({ ZCODE_ENV: "test" })).toEqual({
      flavor: "preview",
      appId: "dev.zcode.app.preview",
      productName: "ZCode Preview",
      linuxExecutableName: "zcode-preview",
      linuxPackageName: "zcode-preview",
      cuaHelperInstallVariant: "preview",
    });
  });

  it("ZCODE_PREVIEW_IDENTITY=1 让生产后端的构建改用 Preview 身份", () => {
    // 身份与后端环境分轴：同一份 Preview 身份既可以连测试后端，也可以连生产后端。
    for (const flag of ["1", " 1 "]) {
      const env = { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("preview");
      expect(resolveDesktopProductIdentity(env)).toBe(desktopProductIdentities.preview);
    }
    for (const flag of ["", "0"]) {
      const env = { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("production");
    }
  });

  it("开关只认 1/0：其它拼写在构建期直接失败，不能在路由层漏匹配却在脚本层开启", () => {
    // CI workflow 规则与 release 门做 == "1" 精确比较；若脚本层再接受 true/yes/on，
    // `ZCODE_PREVIEW_IDENTITY=true` 会落入 @electron/dev 生产验收目录却打出 Preview 身份包。
    for (const flag of ["true", "yes", "on", "false", "no", "off", "2"]) {
      expect(() =>
        resolveDesktopProductFlavor({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: flag }),
      ).toThrow(/expected 1 or 0/);
    }
  });

  it("测试后端永远是 Preview 身份，开关无法把它变成正式 ZCode", () => {
    expect(resolveDesktopProductFlavor({ ZCODE_ENV: "test", ZCODE_PREVIEW_IDENTITY: "0" })).toBe(
      "preview",
    );
    expect(resolveDesktopProductFlavor({ ZCODE_ENV: "test", ZCODE_PREVIEW_IDENTITY: "1" })).toBe(
      "preview",
    );
  });

  it("产物后缀只标记后端环境，生产后端的 Preview 包靠 productName 区分", () => {
    expect(resolveDesktopArtifactSuffix({ ZCODE_ENV: "test" })).toBe("_TEST");
    expect(resolveDesktopArtifactSuffix({ ZCODE_ENV: "production" })).toBe("");
    expect(
      resolveDesktopArtifactSuffix({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }),
    ).toBe("");
    expect(resolveDesktopArtifactSuffix({})).toBe("_TEST");
  });

  it("ZCODE_ENV=production 完整保留正式包身份", () => {
    expect(resolveDesktopProductIdentity({ ZCODE_ENV: "production" })).toBe(
      desktopProductIdentities.production,
    );
    expect(desktopProductIdentities.production).toEqual({
      flavor: "production",
      appId: "dev.zcode.app",
      productName: "ZCode",
      linuxExecutableName: "zcode",
      linuxPackageName: "zcode",
      cuaHelperInstallVariant: null,
    });
  });

  it("未注入或未知环境时不应误生成正式安装身份", () => {
    expect(resolveDesktopProductIdentity({}).flavor).toBe("preview");
    expect(resolveDesktopProductIdentity({ ZCODE_ENV: "staging" }).flavor).toBe("preview");
  });

  it("打包态 Windows AUMID 必须和 NSIS appId 保持一致", () => {
    expect(resolveWindowsAppUserModelId({ ZCODE_ENV: "production" })).toBe(
      desktopProductIdentities.production.appId,
    );
    expect(resolveWindowsAppUserModelId({ ZCODE_ENV: "test" })).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(
      resolveWindowsAppUserModelId({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }),
    ).toBe(desktopProductIdentities.preview.appId);
    // 主进程按编译期 flavor 取 AUMID，不依赖安装后机器上的环境变量。
    expect(resolveWindowsAppUserModelIdForFlavor("preview")).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(resolveWindowsAppUserModelIdForFlavor("production")).toBe(
      desktopProductIdentities.production.appId,
    );
  });

  it("开发态继续使用独立 AUMID，避免污染打包版 Shell 身份", () => {
    expect(resolveWindowsAppUserModelId({}, { isPackaged: false })).toBe("cn.aminer.zcode");
  });

  it("MOS_PRODUCT_IDENTITY=1 使用独立 MOS 产品身份，与上游 ZCode 全维度隔离", () => {
    for (const flag of ["1", " 1 "]) {
      const env = { ZCODE_ENV: "production", MOS_PRODUCT_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("mos");
      expect(resolveDesktopProductIdentity(env)).toEqual({
        flavor: "mos",
        appId: "org.payswap.mos",
        productName: "MOS",
        linuxExecutableName: "mos",
        linuxPackageName: "mos",
        cuaHelperInstallVariant: null,
      });
    }
    // MOS 优先于 Preview：两个开关同时开启时必须是独立产品身份，不允许落回 ZCode 渠道。
    expect(
      resolveDesktopProductFlavor({
        ZCODE_ENV: "production",
        ZCODE_PREVIEW_IDENTITY: "1",
        MOS_PRODUCT_IDENTITY: "1",
      }),
    ).toBe("mos");
    // 测试后端 + MOS：独立身份仍生效，产物后缀仍标记 _TEST。
    expect(resolveDesktopProductFlavor({ ZCODE_ENV: "test", MOS_PRODUCT_IDENTITY: "1" })).toBe("mos");
    expect(
      resolveDesktopArtifactSuffix({ ZCODE_ENV: "test", MOS_PRODUCT_IDENTITY: "1" }),
    ).toBe("_TEST");
  });

  it("MOS 开关同样只认 1/0：其它拼写在构建期直接失败", () => {
    for (const flag of ["true", "yes", "on", "false", "no", "off", "2"]) {
      expect(() =>
        resolveDesktopProductFlavor({ ZCODE_ENV: "production", MOS_PRODUCT_IDENTITY: flag }),
      ).toThrow(/expected 1 or 0/);
    }
  });

  it("MOS 打包态 AUMID 使用 MOS appId；未知 flavor 回落 production 身份", () => {
    expect(resolveWindowsAppUserModelIdForFlavor("mos")).toBe(
      desktopProductIdentities.mos.appId,
    );
    // 未知 flavor（历史版本缓存/异常注入）回落 production appId，不产生第三个 Shell 身份。
    expect(resolveWindowsAppUserModelIdForFlavor("unknown")).toBe(
      desktopProductIdentities.production.appId,
    );
  });

  it("未开启 MOS 开关时任何后端环境都不会产生 MOS 身份", () => {
    for (const env of [{}, { ZCODE_ENV: "production" }, { ZCODE_ENV: "test" }, { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }]) {
      expect(resolveDesktopProductFlavor(env)).not.toBe("mos");
    }
  });
});
