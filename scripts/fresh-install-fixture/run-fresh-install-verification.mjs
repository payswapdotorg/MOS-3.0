#!/usr/bin/env node
// run-fresh-install-verification —— fresh-install fixture 驱动器。
//
// 用法：
//   无人值守（预期在 consent 段以 auth_timeout 终止，exit 3）：
//     node scripts/fresh-install-fixture/run-fresh-install-verification.mjs \
//       --evidence-out evidence.json [--consent-wait-ms 120000]
//
//   有人值守（真人在 authorize_url 完成授权；后端启用 MOS 后可走完全周期）：
//     node scripts/fresh-install-fixture/run-fresh-install-verification.mjs \
//       --evidence-out evidence.json --consent-wait-ms 300000
//
// 驱动器在 live registration 成功后立刻打印 authorize_url（真人等待期间就能看到要
// 打开的链接），等待期间每 30s 打印一次心跳；周期结束时再复述一次。
//
// 周期：fresh state → reset → live registration → consent → credentials land →
// coding plan grant active。证据 JSON 不含任何 secret（凭据只以 sha256 指纹出现），
// 凭据本身只存在于进程内存且绝不落盘。
//
// 退出码：0 全周期成立；3 auth_timeout（无人值守预期终态）；4 授权失败/被拒；
// 5 提供方未配置该产品；6 需要账号认证；1 fixture/用法错误。
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runFreshInstallCycle, VERDICT_EXIT_CODES } from "./lib/cycle.mjs";

const USAGE = `用法：node scripts/fresh-install-fixture/run-fresh-install-verification.mjs --evidence-out <path.json> [选项]

选项：
  --evidence-out     证据 JSON 输出路径（必填；失败也会写出）
  --origin           ZCode endpoint origin（默认 https://zcode.z.ai）
  --product          API 产品身份：mos | zcode（默认 mos；镜像 X-ZCode-Product-Id）
  --provider         OAuth 提供方家族：zai | bigmodel（默认 zai）
  --app-version      上报的 app_version（默认 3.18.0）
  --platform         上报的 platform 头（默认 <process.platform>-<process.arch>）
  --data-root        安装数据根（默认临时目录；传入真实安装根即做 reinstall 复验）
  --consent-wait-ms  等待真人完成授权的预算，毫秒（默认 300000）
  --help             打印本说明`;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    evidenceOut: null,
    origin: "https://zcode.z.ai",
    product: "mos",
    provider: "zai",
    appVersion: "3.18.0",
    platform: `${process.platform}-${process.arch}`,
    dataRoot: null,
    consentWaitMs: 300_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${arg}`);
      i += 1;
      return argv[i];
    };
    switch (arg) {
      case "--evidence-out":
        parsed.evidenceOut = next();
        break;
      case "--origin":
        parsed.origin = next();
        break;
      case "--product":
        parsed.product = next();
        break;
      case "--provider":
        parsed.provider = next();
        break;
      case "--app-version":
        parsed.appVersion = next();
        break;
      case "--platform":
        parsed.platform = next();
        break;
      case "--data-root":
        parsed.dataRoot = next();
        break;
      case "--consent-wait-ms":
        parsed.consentWaitMs = Number(next());
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.evidenceOut) throw new Error("--evidence-out is required");
  if (args.product !== "mos" && args.product !== "zcode") {
    throw new Error(`--product must be mos or zcode (got ${args.product})`);
  }
  if (args.provider !== "zai" && args.provider !== "bigmodel") {
    throw new Error(`--provider must be zai or bigmodel (got ${args.provider})`);
  }
  if (!Number.isFinite(args.consentWaitMs) || args.consentWaitMs < 0) {
    throw new Error("--consent-wait-ms must be a non-negative number");
  }

  const evidence = await runFreshInstallCycle({
    origin: args.origin,
    productId: args.product,
    providerId: args.provider,
    appVersion: args.appVersion,
    platform: args.platform,
    dataRoot: args.dataRoot ? resolve(args.dataRoot) : null,
    consentWaitMs: args.consentWaitMs,
    log: (line) => console.log(line),
  });

  await writeFile(args.evidenceOut, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const authorizeUrl = evidence.observations?.authorizeUrl;
  if (authorizeUrl) {
    console.log(`\nAuthorization URL (a human must complete consent here): ${authorizeUrl}`);
  }
  console.log(`\nVerdict: ${evidence.verdict} (exit ${VERDICT_EXIT_CODES[evidence.verdict]})`);
  console.log(`Evidence: ${resolve(args.evidenceOut)}`);
  return VERDICT_EXIT_CODES[evidence.verdict] ?? 1;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    console.error(`${USAGE}\n\nError: ${error.message}`);
    process.exit(1);
  },
);
