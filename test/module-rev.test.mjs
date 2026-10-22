// 模块的版本协商：「取双方都支持的最高版本，没有交集就拒绝」。
//
// 这条规矩来自 design/RELAY.txt 记的中继站 A2。搬到这里的时候它变简单了：
// 这门语言没有范围语法，所以「双方都支持」就是「调用方要的版本 <= 模块提供的版本」
// 这一个比较 —— 模块向下兼容，于是「提供了第 N 版」就意味着「1 到 N 版都给得出」。
//
// 三条要验的：
//   一、要的版本比模块给的低（或相等）→ 通过
//   二、要的版本比模块给的高 → 拒绝，并且说清楚两边各是哪一版
//   三、不写 rev 的那一边不提要求 → 老代码一行都不用改
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadUnit } from "../src/loader.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-rev-"));

// 造一对文件：一个模块，一个用它的人。
const 造 = (模块头, 导入子句, 模块体 = "fn 甲() -> Int {\n  return 1\n}\n") => {
  const 模块路 = path.join(临, "lib.hmyr");
  fs.writeFileSync(模块路, 模块头 + 模块体, "utf8");
  const 用路 = path.join(临, "use.hmyr");
  fs.writeFileSync(用路, 导入子句 + "\nfn main() -> Int {\n  return 甲()\n}\n", "utf8");
  return loadUnit(用路);
};

console.log("一、要的版本不比模块给的高，就通过");
{
  const a = 造("rev 2\n", 'import "./lib.hmyr" rev 2');
  ok("模块给 2、要 2", a.ok, JSON.stringify(a.diagnostics.errors.map((e) => e.code)));
  const b = 造("rev 3\n", 'import "./lib.hmyr" rev 1');
  ok("模块给 3、要 1（向下兼容）", b.ok, JSON.stringify(b.diagnostics.errors.map((e) => e.code)));
  const c = 造("rev 1\n", 'import "./lib.hmyr"');
  ok("调用方不提要求", c.ok, JSON.stringify(c.diagnostics.errors.map((e) => e.code)));
  const d = 造("", 'import "./lib.hmyr" rev 9');
  ok("模块不提版本时，要什么都放过", d.ok, JSON.stringify(d.diagnostics.errors.map((e) => e.code)));
}

console.log("二、要的版本比模块给的高，就拒绝，并且说清楚");
{
  const a = 造("rev 1\n", 'import "./lib.hmyr" rev 2');
  ok("模块给 1、要 2 → 加载失败", !a.ok, JSON.stringify(a.diagnostics.errors.map((e) => e.code)));
  const 错 = a.diagnostics.errors.find((e) => e.code === "HMYR-E0303");
  ok("用的是 E0303 这个编号", Boolean(错), JSON.stringify(a.diagnostics.errors.map((e) => e.code)));
  ok("消息里说了模块给的是第几版", Boolean(错) && 错.message.includes("revision 1"), JSON.stringify(错 ? 错.message : ""));
  ok("消息里说了 import 要的是第几版", Boolean(错) && 错.message.includes("asks for 2"), JSON.stringify(错 ? 错.message : ""));
}

console.log("三、rev 写错的时候有话说");
{
  const 模块路 = path.join(临, "bad.hmyr");
  fs.writeFileSync(模块路, "rev\nfn f() -> Int {\n  return 1\n}\n", "utf8");
  const r = loadUnit(模块路);
  ok("rev 后面没写数字 → 报错而不是静默当成 0", !r.ok, JSON.stringify(r.diagnostics.errors.map((e) => e.code)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
