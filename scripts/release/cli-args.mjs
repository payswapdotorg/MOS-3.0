/**
 * 通用 CLI 参数解析（scripts/release 工具共用）。
 *
 * 仅支持 `--flag value` / `--flag=value` / 布尔 `--flag` 三种形式；与仓库其它 CLI 一样，
 * 未知参数直接报错（fail loudly），不做静默忽略。
 */

export function parseReleaseCliArgs(argv, { required = [], optional = [] } = {}) {
  const flags = new Map();
  const allowed = new Set([...required, ...optional, "help"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      flags.set("help", "true");
      continue;
    }
    if (arg.startsWith("--")) {
      let name = arg.slice(2);
      let value;
      const equals = name.indexOf("=");
      if (equals >= 0) {
        value = name.slice(equals + 1);
        name = name.slice(0, equals);
      } else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) {
        value = "true";
      } else {
        value = argv[++i];
      }
      if (!allowed.has(name)) throw new Error(`未知参数：--${name}`);
      if (value === "") throw new Error(`--${name} 不能为空`);
      flags.set(name, value);
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  const missing = required.filter((name) => !flags.has(name));
  if (missing.length) throw new Error(`缺少必选参数：${missing.map((name) => `--${name}`).join(" ")}`);
  return Object.fromEntries(flags);
}

export function printUsageAndExit(usage) {
  console.log(`用法：${usage}`);
  return 0;
}
