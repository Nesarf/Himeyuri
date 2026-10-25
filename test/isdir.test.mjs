// is_dir 的验收：三个实现交回同一个答案。
//
// 这一条是递归的地基：read_dir 给名字，而「要不要走进去」得先问这一句。
// 三个结局都要能分开 —— 目录是 true，文件是 false，不存在的路径也是 false（问不到就是没有）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-isdir-"));
const 目录 = path.join(临, "箱");
fs.mkdirSync(目录);
const 文件 = path.join(临, "一份.txt");
fs.writeFileSync(文件, "x");
const 中文目录 = path.join(临, "琥珀");
fs.mkdirSync(中文目录);
const 没有 = path.join(临, "并不存在");

const 程序 = [
  "fn main() -> Int effects(file, process) {",
  "  let 参 = argv()",
  "  if len(参) < 5 { return 2 }",
  "  var i = 1",
  "  while i < 5 {",
  '    if is_dir(参[i]) { print("目录" + chr(10)) } else { print("不是" + chr(10)) }',
  "    i = i + 1",
  "  }",
  "  return 0",
  "}",
].join("\n") + "\n";
const 程序路 = path.join(临, "probe.hmoca");
fs.writeFileSync(程序路, 程序, "utf8");

// 目录、文件、中文名目录、不存在的路径 —— 四条各一种结局。
const 期望 = "目录\n不是\n目录\n不是\n";
const 参数们 = [目录, 文件, 中文目录, 没有];

console.log("一、宿主解释器");
const 层 = loadUnit(程序路);
ok("程序读得动", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
let 出A = "";
const rt = runUnit(层, { write: (t) => { 出A += t; }, capabilities: 本机能力() });
rt.argv = ["hmyr", ...参数们];
const 码A = rt.callFunction(rt.functions.get("main"), [], null);
ok("退出码 0", 码A === 0, String(码A));
ok("目录是 true，文件与不存在是 false，中文名目录也是 true", 出A === 期望, JSON.stringify(出A));

console.log("二、字节码机器");
const 出B = [];
const vm = 跑字节码(层, {
  write: (t) => 出B.push(t), writeErr: () => {},
  argv: ["hmyr", ...参数们], capabilities: 本机能力(), stepLimit: 2000000,
});
const rB = vm.调用("main", [], null);
ok("退出码 0", rB.ok, rB.ok ? "" : rB.码 + " " + rB.话);
ok("与解释器逐字相同", 出B.join("") === 出A, JSON.stringify(出B.join("")));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("三、C 那一台");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const exe = path.join(临, "hmyr.exe");
  const g = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", g.status === 0, String(g.stderr || "").slice(0, 160));
  if (g.status === 0) {
    const 码路 = path.join(临, "probe.hmoks");
    const e = spawnSync("node", ["tools/emit-code.mjs", 程序路, 码路], { cwd: ROOT, encoding: "utf8" });
    ok("字节码落盘", e.status === 0 && fs.existsSync(码路), String(e.stderr || "").slice(0, 160));
    if (e.status === 0) {
      const r = spawnSync(exe, [码路, ...参数们], { encoding: "utf8" });
      ok("C 那台退出码 0", r.status === 0, String(r.stderr || "").slice(0, 160));
      ok("C 那台与另两台逐字相同", String(r.stdout || "") === 期望, JSON.stringify(String(r.stdout || "")));
    }
  }
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
