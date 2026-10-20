// 大栈之下：六份全对。
//
// 这是「它认得自己那份源码」这句话的验收——六份文件，自举算出来的函数名，
// 与宿主算出来的完全一致（名字与顺序）。
//
// 为什么要另起子进程：--stack-size 是进程启动参数，运行中改不了。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、默认栈下 lex 撞栈，8 MB 栈下不撞");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-stk-"));
  const 脚本 = path.join(临, "p.mjs");
  const 根 = ROOT.split(path.sep).join("/");
  fs.writeFileSync(脚本, [
    'import fs from "node:fs";',
    'const { loadUnit, runUnit } = await import("file:///' + 根 + '/src/loader.mjs");',
    'const rt = runUnit(loadUnit("' + 根 + '/self/run.hmyr"), { maxDepth: 20000, stepLimit: 3000000000 });',
    'let 撞 = "跑得动";',
    'try { rt.callFunction(rt.functions.get("函数名们"), [fs.readFileSync("' + 根 + '/self/lex.hmyr", "utf8")], null); }',
    'catch (e) { 撞 = String(e && e.message ? e.message : e).slice(0, 40); }',
    'process.stdout.write(撞);',
  ].join("\n"), "utf8");
  const 小 = spawnSync(process.execPath, [脚本], { encoding: "utf8", timeout: 300000 });
  const 大 = spawnSync(process.execPath, ["--stack-size=8000", 脚本], { encoding: "utf8", timeout: 300000 });
  // 尾调用之后，默认栈下 lex 也跑得动了——自举里那些递归大多是尾递归，
  // 于是它们不再吃宿主栈。这一条原来钉「默认栈下撞墙」，现在钉「不必放大栈也能过」。
  ok("默认栈下 lex 现在也跑得动（尾调用的功劳）", String(小.stdout).trim() === "跑得动", String(小.stdout).slice(0, 40));
  ok("8 MB 栈下仍然跑得动", String(大.stdout).trim() === "跑得动", String(大.stdout).slice(0, 40));
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("二、六份全对：名字与顺序都与宿主一致");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-six-"));
  const 脚本 = path.join(临, "six.mjs");
  const 根 = ROOT.split(path.sep).join("/");
  fs.writeFileSync(脚本, [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'const { loadUnit, runUnit } = await import("file:///' + 根 + '/src/loader.mjs");',
    'const rt = runUnit(loadUnit("' + 根 + '/self/run.hmyr"), { maxDepth: 20000, stepLimit: 3000000000 });',
    'const 结 = {};',
    'for (const 名 of ["lex", "chain", "stmt", "body", "eval", "run"]) {',
    '  const 路 = path.resolve("' + 根 + '/self/" + 名 + ".hmyr");',
    '  const 甲 = Array.from(rt.callFunction(rt.functions.get("函数名们"), [fs.readFileSync(路, "utf8")], null));',
    '  const 宿 = loadUnit(路);',
    '  const 乙 = 宿.modules.get(路).decls.filter((d) => d.kind === "Fn").map((d) => d.name);',
    '  结[名] = { 个数: 甲.length, 同: JSON.stringify(甲) === JSON.stringify(乙) };',
    '}',
    'process.stdout.write(JSON.stringify(结));',
  ].join("\n"), "utf8");
  const r = spawnSync(process.execPath, ["--stack-size=8000", 脚本], { encoding: "utf8", timeout: 600000 });
  let 结 = null;
  try { 结 = JSON.parse(String(r.stdout || "null")); } catch (e) { 结 = null; }
  ok("子进程跑得出来", 结 !== null, String(r.stderr || "").slice(0, 100));
  if (结) {
    const 期 = { lex: 25, chain: 20, stmt: 10, body: 14, eval: 26, run: 28 };
    for (const 名 of Object.keys(期)) {
      ok(名 + ".hmyr 认出 " + 期[名] + " 个", 结[名].个数 === 期[名], String(结[名].个数));
      ok(名 + ".hmyr 与宿主名字一致", 结[名].同 === true, String(结[名].同));
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
