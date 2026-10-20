// 栈这道墙：放大之后 lex 与 chain 过得去，而在默认栈下过不去。
//
// 两件事都是事实，分开钉住：
//   一、默认栈下它们撞栈
//   二、给了 8 MB 栈之后它们跑完，而与宿主名字一致
//
// 为什么不干脆整套都在大栈上跑：因为「默认栈下过不去」本身是别人会撞到的事实，
// 抹掉它等于让人以为这门语言在默认配置下就能编译自己。
//
// 这一套起子进程带 --stack-size 跑第二件事——Node 的栈是进程启动时的参数，
// 不能在运行中改，所以要另起一个进程。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、默认栈下：lex 与 chain 撞栈");
{
  const rt = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")), { maxDepth: 20000 });
  for (const 名 of ["lex", "chain"]) {
    let 说法 = "跑得动";
    try { rt.callFunction(rt.functions.get("函数名们"), [fs.readFileSync(path.join(ROOT, "self", 名 + ".hmyr"), "utf8")], null); }
    catch (e) { 说法 = String(e && e.message ? e.message : e).slice(0, 40); }
    ok(名 + ".hmyr 在默认栈下跑不动", 说法 !== "跑得动", 说法);
  }
}

console.log("二、给了大栈之后：它们跑完，而与宿主名字一致");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-stack-"));
  const 脚本 = path.join(临, "probe.mjs");
  const 根 = ROOT.split(path.sep).join("/");
  fs.writeFileSync(脚本, [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'const { loadUnit, runUnit } = await import("file:///' + 根 + '/src/loader.mjs");',
    'const rt = runUnit(loadUnit("' + 根 + '/self/run.hmyr"), { maxDepth: 20000, stepLimit: 50000000 });',
    'const 结 = {};',
    'for (const 名 of ["lex", "chain"]) {',
    '  const 路 = path.resolve("' + 根 + '/self/" + 名 + ".hmyr");',
    '  const 甲 = Array.from(rt.callFunction(rt.functions.get("函数名们"), [fs.readFileSync(路, "utf8")], null));',
    '  const 宿 = loadUnit(路);',
    '  const 本 = 宿.modules.get(路);',
    '  const 乙 = 本.decls.filter((d) => d.kind === "Fn").map((d) => d.name);',
    '  结[名] = { 个数: 甲.length, 同: JSON.stringify(甲) === JSON.stringify(乙) };',
    '}',
    'process.stdout.write(JSON.stringify(结));',
  ].join("\n"), "utf8");
  const r = spawnSync(process.execPath, ["--stack-size=8000", 脚本], { encoding: "utf8", timeout: 300000 });
  let 结 = null;
  try { 结 = JSON.parse(String(r.stdout || "null")); } catch (e) { 结 = null; }
  ok("子进程跑得出来", 结 !== null, String(r.stderr || "").slice(0, 80));
  if (结) {
    ok("lex.hmyr 认出二十五个", 结.lex.个数 === 25, String(结.lex.个数));
    ok("lex.hmyr 与宿主名字一致", 结.lex.同 === true, String(结.lex.同));
    ok("chain.hmyr 认出二十个", 结.chain.个数 === 20, String(结.chain.个数));
    ok("chain.hmyr 与宿主名字一致", 结.chain.同 === true, String(结.chain.同));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
