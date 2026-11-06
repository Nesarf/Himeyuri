// probes/ 下的诊断探针：每一份都要编得动。
//
// 这些文件原来是 examples/probe-*.hmoca —— 它们是当时为了缩一个问题写的一次性诊断，
// 不是给新人的示例。2026-11-04 把它们搬到 probes/，因为它们是 examples 判据从 41 秒
// 涨到 232 秒的原因：其中两份（probe-decls2 与 probe-row）真的 引入 ../self/run.hmoca，
// 于是每跑一次都要把整份自举层加载一遍。
//
// 搬走之后 examples 只跑真正的示例，而这一份守住「探针不是坏文件」这条底线：
// 每一份都过一遍装载器，编得动就算过，不执行。为什么只编不跑：探针的价值是当时
// 的诊断记录，而它们跑起来要么慢（加载自举层），要么需要参数（probe-argv 之类）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 目录 = path.join(ROOT, "probes");
const 份簇 = fs.existsSync(目录)
  ? fs.readdirSync(目录).filter((f) => f.endsWith(".hmoca")).sort()
  : [];

console.log("一、probes/ 下有一批探针");
ok("至少十份", 份簇.length >= 10, String(份簇.length) + " 份");

console.log("二、每一份都编得动（不执行）");
{
  const 坏例 = [];
  for (const f of 份簇) {
    const u = loadUnit(path.join(目录, f));
    if (!u.ok) {
      const 码 = u.diagnostics.errors.slice(0, 1).map((e) => e.code).join(",");
      坏例.push(f + "(" + 码 + ")");
    }
  }
  ok("这一批都编得动（" + 份簇.length + " 份）", 坏例.length === 0, 坏例.join(" · "));
}

console.log("三、examples/ 里不再有 probe-*（搬干净了）");
{
  const 例子 = path.join(ROOT, "examples");
  const 剩 = fs.readdirSync(例子).filter((f) => f.startsWith("probe-"));
  ok("examples/ 下一个 probe-* 都没有", 剩.length === 0, 剩.join(" "));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
