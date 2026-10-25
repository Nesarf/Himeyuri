// 脱敏：诊断里的路径可以说也可以不说，而编号一个都不动。
//
// 这一套钉三件事：
//   一、默认不脱敏 —— 本地看自己的日志，路径是有用的信息。
//   二、打开之后引号里那一截带分隔符的串变成 <path>，而编号还在。
//   三、启动器那条路也生效：自举层自己拼的 no such file 不知道开关，
//      所以启动器在把 stderr 交出去之前替它遮一次。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 设脱敏, 在用脱敏, 藏路径, 脱线 } from "../src/redact.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、开关本身");
{
  设脱敏(false);
  ok("默认是关的", 在用脱敏() === false);
  ok("关着的时候路径原样交回", 藏路径("C:\\a\\b.txt") === "C:\\a\\b.txt");
  ok("关着的时候整条消息原样", 脱线("cannot read 'C:\\a\\b.txt'") === "cannot read 'C:\\a\\b.txt'");
  设脱敏(true);
  ok("打开之后路径变成占位符", 藏路径("C:\\a\\b.txt") === "<path>");
  ok("一条消息里的路径被换掉", 脱线("cannot read 'C:\\a\\b.txt': no such file") === "cannot read '<path>': no such file");
  // 编号不在引号里，所以它不动 —— 这一条是这功能能成立的前提。
  ok("编号不受影响", 脱线("HMYR-R0211 cannot read 'C:\\a\\b.txt'") === "HMYR-R0211 cannot read '<path>'");
  // 没有分隔符的引号内容不动：那是普通词，不是路径。
  ok("普通引号内容不动", 脱线("no field 'a' on that record") === "no field 'a' on that record");
  设脱敏(false);
  ok("能关回去", 在用脱敏() === false);
}

console.log("二、启动器两条路都生效");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-redact-"));
  const 缺 = path.join(临, "没有这个.hmoca");
  const 启动 = (args, env) => spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), ...args],
    { encoding: "utf8", env: { ...process.env, ...(env || {}) } });
  try {
    const 甲 = 启动([缺]);
    ok("默认时消息里带着那个路径", String(甲.stderr).includes("没有这个.hmoca"), JSON.stringify(String(甲.stderr).slice(0, 80)));
    ok("默认时编号照旧", String(甲.stderr).includes("HMYR-R0211"));

    const 乙 = 启动(["--redact", 缺]);
    ok("--redact 之后路径不见了", !String(乙.stderr).includes("没有这个.hmoca"), JSON.stringify(String(乙.stderr).slice(0, 80)));
    ok("--redact 之后占位符在", String(乙.stderr).includes("<path>"));
    ok("--redact 之后编号还在", String(乙.stderr).includes("HMYR-R0211"));

    const 丙 = 启动([缺], { HMYR_REDACT: "1" });
    ok("环境变量也能开", String(丙.stderr).includes("<path>") && !String(丙.stderr).includes("没有这个.hmoca"));
    ok("环境变量开着时，退出码仍是失败", 丙.status === 1, String(丙.status));
  } finally {
    fs.rmSync(临, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
