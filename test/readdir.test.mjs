// read_dir 的验收：三个实现交回同一份名字。
//
// 难处不在读目录，而在「名字是什么」：文件系统给的是字节，语言里是 UTF-16 的串。
// 这条路要跨一次编码，而且要在宿主解释器、字节码机器、C 那一台上跨得一样。
// 排序也是承诺：两台机器必须交回同一个顺序，否则清单无法逐字节比对。
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

// 临时件放仓库里（.tmp- 前缀已在 .gitignore 里），不去占 C 盘的临时目录。
const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-readdir-"));
const 目录 = path.join(临, "箱");
fs.mkdirSync(目录);
// 创建顺序故意与排序不同：顺序若来自文件系统而不是排序，这一条就会露。
for (const 名 of ["b.txt", "a.txt", "c.txt", "琥珀.txt"]) fs.writeFileSync(path.join(目录, 名), "x");
const 空目录 = path.join(临, "空");
fs.mkdirSync(空目录);

const 程序 = [
  "fn main() -> Int effects(file, process) {",
  "  let 参 = argv()",
  "  if len(参) < 2 { return 2 }",
  "  let 名们 = read_dir(参[1])",
  "  var i = 0",
  "  while i < len(名们) {",
  '    print(str(i) + ":" + 名们[i] + chr(10))',
  "    i = i + 1",
  "  }",
  '  print("共 " + str(len(名们)) + chr(10))',
  "  return 0",
  "}",
].join("\n") + "\n";
const 程序路 = path.join(临, "probe.hmoca");
fs.writeFileSync(程序路, 程序, "utf8");

// a < b < c < 琥珀：ASCII 在 UTF-16 码元序与 UTF-8 字节序里都排在汉字前面，
// 所以两台机器给的是同一个顺序，这一条同时钉住两件事。
const 期望 = ["0:a.txt", "1:b.txt", "2:c.txt", "3:琥珀.txt", "共 4", ""].join("\n");
const 期望空 = "共 0\n";

console.log("一、宿主解释器");
const 层 = loadUnit(程序路);
ok("程序读得动", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
let 出A = "";
// argv 在 Runtime 上是一个可后赋的字段（构造参数里只收 write 与 capabilities），
// 照 bytecode.test.mjs 那条既有的写法：先构造，再把 argv 放上去。
const rt = runUnit(层, { write: (t) => { 出A += t; }, capabilities: 本机能力() });
rt.argv = ["hmyr", 目录];
const 码A = rt.callFunction(rt.functions.get("main"), [], null);
ok("退出码 0", 码A === 0, String(码A));
ok("名字排好序，中文名也列出来了", 出A === 期望, JSON.stringify(出A));

console.log("二、字节码机器");
const 出B = [];
const vm = 跑字节码(层, {
  write: (t) => 出B.push(t), writeErr: () => {},
  argv: ["hmyr", 目录], capabilities: 本机能力(), stepLimit: 2000000,
});
const rB = vm.调用("main", [], null);
ok("退出码 0", rB.ok && (rB.值 === null || rB.值 === undefined || 数0(rB.值) === 0), rB.ok ? "" : rB.码 + " " + rB.话);
ok("与解释器逐字相同", 出B.join("") === 出A, JSON.stringify(出B.join("")));

function 数0(v) { return v; }

console.log("三、空目录是「零条」，不是错");
{
  const 出 = [];
  const vm2 = 跑字节码(层, { write: (t) => 出.push(t), writeErr: () => {}, argv: ["hmyr", 空目录], capabilities: 本机能力(), stepLimit: 1000000 });
  const r = vm2.调用("main", [], null);
  ok("退出码 0", r.ok, r.ok ? "" : r.码 + " " + r.话);
  ok("交回共 0 条", 出.join("") === 期望空, JSON.stringify(出.join("")));
}

console.log("四、打不开的目录要报错，而且报的是文件这一类的错");
{
  let 报 = "", 码 = "";
  const rt2 = runUnit(层, { write: () => {}, capabilities: 本机能力() });
  rt2.argv = ["hmyr", path.join(临, "并不存在的目录")];
  try { rt2.callFunction(rt2.functions.get("main"), [], null); }
  catch (e) { 报 = String((e && e.message) || e); 码 = String((e && e.code) || ""); }
  // 错误码在外层对象上（与其它内置同一套），消息里只有那句白话。
  ok("解释器报 HMYR-內-011", 码 === "HMYR-內-011", 码 + " / " + 报.slice(0, 80));
  ok("消息里说的是列目录，不是读文件", 报.includes("cannot list"), 报.slice(0, 100));
}

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("五、C 那一台");
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
      const r = spawnSync(exe, [码路, 目录], { encoding: "utf8" });
      ok("C 那台退出码 0", r.status === 0, String(r.stderr || "").slice(0, 160));
      ok("C 那台与另两台逐字相同", String(r.stdout || "") === 期望, JSON.stringify(String(r.stdout || "")));
      const r空 = spawnSync(exe, [码路, 空目录], { encoding: "utf8" });
      ok("C 那台的空目录也是零条", r空.status === 0 && String(r空.stdout || "") === 期望空, JSON.stringify(String(r空.stdout || "")));
      const r坏 = spawnSync(exe, [码路, path.join(临, "并不存在的目录")], { encoding: "utf8" });
      ok("C 那台打不开时会失败", r坏.status !== 0, "exit=" + r坏.status);
    }
  }
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
