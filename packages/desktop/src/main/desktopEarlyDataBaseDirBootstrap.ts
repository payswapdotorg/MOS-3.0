import { app } from "electron";
import {
  runtimeApplicationName,
  runtimeHomePath,
  runtimeSessionDataPath,
  runtimeUserDataPath,
  shouldUseElectronDefaultUserDataPath,
} from "./desktopRuntimeEnv.js";
import { applyEarlyDataBaseDirBootstrap } from "./desktopDataBaseDirBootstrap.js";

/**
 * 本模块是 index.ts 的早期 bootstrap（先于 appARMSBootstrap 等任何会解析
 * Electron 应用身份/默认 userData 的模块加载）——应用身份也必须在这里应用。
 *
 * 背景（release run 5 冒烟实测捕获）：打包产物 app.asar 内 package.json 的
 * productName 仍是上游 "ZCode"，Electron 的默认 userData 是
 * `<appData>/<默认应用名>`；`@arms/rum-electron` 主进程 RumStore 经
 * `app.getPath("userData")` 定位存储目录，其模块加载期就可能完成路径解析——
 * 若 setName/setPath 晚于它执行，RUM 存储会写进 `<appData>/ZCode/rum-electron-store`
 * （上游 ZCode 的 userData）：真实用户机上 MOS 与上游 ZCode 并排安装时互相污染；
 * macOS 上 Chromium 解析 appData 不跟随 HOME 环境覆盖，会直接写到真实家目录
 * （release 冒烟 decoy 即由此捕获）。
 * 应用名对非 MOS flavor 与 Electron 默认值一致（production "ZCode"），
 * 提前应用不改变上游行为；setName/setPath 在 app ready 前调用是 Electron
 * 文档要求的方式。
 */
app.setName(runtimeApplicationName);
if (runtimeHomePath) {
  app.setPath("home", runtimeHomePath);
}
if (!shouldUseElectronDefaultUserDataPath) {
  if (!runtimeUserDataPath || !runtimeSessionDataPath) {
    throw new Error(
      "Desktop runtime data paths are required when Electron default userData is disabled",
    );
  }
  app.setPath("userData", runtimeUserDataPath);
  app.setPath("sessionData", runtimeSessionDataPath);
}

applyEarlyDataBaseDirBootstrap();
