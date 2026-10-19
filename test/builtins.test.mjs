// 内置的三面对照：代码、规格第一圈、能力契约。
//
// 一个内置若只存在于代码里，它就是隐形的；若只写在文档里，它就是假的。
// 这一套把那份对照工具接进全量，于是每次跑套件都会查一遍。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const r = spawnSync(process.execPath, [path.join(ROOT, "tools/check-builtins.mjs")], { encoding: "utf8" });
const 输出 = String(r.stdout || "") + String(r.stderr || "");
ok("对照工具跑得动", r.status === 0 || r.status === 1, String(r.status));
ok("三面一致（代码、第一圈、契约）", r.status === 0, 输出.split("\n").filter((l) => l.includes("不通过")).join(" | ").slice(0, 200));
// 顺带把数字说出来，好让人看得出它真的查了东西而不是空跑
const m = /代码里的内置 (\d+) 个/.exec(输出);
ok("而且真的数出了内置的个数", m && Number(m[1]) > 40, m ? m[0] : "没找到那一行");

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
