// else 之前可以有换行。
//
// 这是 SPEC 2.2 那条边界被放宽的那一次：换行仍然是 token、仍然是语句分界，
// 但「if 块之后」这个位置不是 —— 于是 } 换行 else { 与 } else { 读成同一棵树。
//
// 验收两条：两种写法都编得过、都跑得出同一个答案；以及无障碍的那一种（else 同行）没被改坏。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { run } from "../src/eval.mjs";
import { 平台参数, 编C机器 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 同行 = "fn 选(n: Int) -> Int {\n  if n > 0 { return 1 } else { return 2 }\n}\n\nfn main() -> Int {\n  print(str(选(1)) + str(选(0)) + chr(10))\n  return 0\n}\n";
const 换行 = "fn 选(n: Int) -> Int {\n  if n > 0 { return 1 }\n  else { return 2 }\n}\n\nfn main() -> Int {\n  print(str(选(1)) + str(选(0)) + chr(10))\n  return 0\n}\n";

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-else-"));
const 甲路 = path.join(临, "same.hmoca");
const 乙路 = path.join(临, "next.hmoca");
fs.writeFileSync(甲路, 同行, "utf8");
fs.writeFileSync(乙路, 换行, "utf8");

console.log("一、两种写法都能读成树");
const 甲 = loadUnit(甲路);
ok("} else { 能编", 甲.ok, JSON.stringify(甲.diagnostics.errors.slice(0, 1).map((e) => e.code)));
const 乙 = loadUnit(乙路);
ok("} 换行 else { 也能编", 乙.ok, JSON.stringify(乙.diagnostics.errors.slice(0, 1).map((e) => e.code)));
ok("两种写法的 diagnostic 都干净", 甲.diagnostics.errors.length === 0 && 乙.diagnostics.errors.length === 0, "");

// 2026-11-02：上面三条走的是 loadUnit，而它默认用子集解析器（src/subset-parse.mjs）——
// 于是「else 前换行」在宿主解析器那一层一直是坏的，判据看不见。下面三条把那一层也盯上。
// 同一个形状的毛病在「签名与 { 之间换行」上也有，第三节管那一处。
{
  const 空诊断 = () => ({
    items: [], errors: [], warnings: [],
    add(s, c, m) { this.items.push({ s, c, m }); if (s === "error") this.errors.push({ c, m }); },
    error(c, m) { this.add("error", c, m); },
    warn(c, m) { this.add("warning", c, m); },
  });
  const 宿主读 = (源) => {
    const d = 空诊断();
    const { ast } = parse(lex(源).tokens, { diagnostics: d });
    return { ast, 错: d.errors };
  };
  const 宿甲 = 宿主读(同行), 宿乙 = 宿主读(换行);
  ok("宿主解析器读同行那份没有诊断", 宿甲.错.length === 0, JSON.stringify(宿甲.错));
  ok("宿主解析器读换行那份没有诊断", 宿乙.错.length === 0, JSON.stringify(宿乙.错));
  const 取若 = (ast) => {
    const s = ast.decls[0].body.statements[0];
    return s && s.kind === "表达式语句" ? s.expr : s;
  };
  ok("两边都读出了 otherwise", !!(取若(宿甲.ast) || {}).otherwise && !!(取若(宿乙.ast) || {}).otherwise, "");
}

console.log("二、它们跑出同一个答案");
const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const exe = path.join(临, "hmyr.exe");
  const c = 编C机器(exe);
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 跑 = (路, 名) => {
      const 码 = path.join(临, 名 + ".hmoks");
      const e = spawnSync("node", [path.join(ROOT, "tools/emit-code.mjs"), 路, 码], { encoding: "utf8" });
      if (e.status !== 0) return { 错: String(e.stderr).slice(0, 200) };
      const r = spawnSync(exe, [码], { encoding: "utf8", timeout: 60000, env: { ...process.env, HMYR_STEPS: "2000000000" } });
      return { 码: r.status, 出: String(r.stdout || "") };
    };
    const 甲跑 = 跑(甲路, "same");
    const 乙跑 = 跑(乙路, "next");
    ok("同行那一份跑得出 12", 甲跑.码 === 0 && 甲跑.出 === "12\n", JSON.stringify(甲跑));
    ok("换行那一份跑得出同一个 12", 乙跑.码 === 0 && 乙跑.出 === "12\n", JSON.stringify(乙跑));
  }
}
console.log("三、签名与 { 之间也可以有换行");
{
  // 与 else 那一处同一类：换行在这个位置不是语句分界。
  // 以前宿主解析器把体读成空（body 为 null），而子集那一层读得动 —— 于是同一份源码
  // 在两条路上给出两种形状，而绕开的办法是给签名塞一条契约把换行吃掉，
  // 那等于让「怎么写」变成了语义。
  const 挤 = "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int effects(process) {\n  print(str(加(20, 22)) + chr(10))\n  return 0\n}\n";
  const 分 = "fn 加(a: Int, b: Int) -> Int\n{\n  return a + b\n}\nfn main() -> Int effects(process)\n{\n  print(str(加(20, 22)) + chr(10))\n  return 0\n}\n";
  const 空诊断2 = () => ({
    items: [], errors: [], warnings: [],
    add(s, c, m) { this.items.push({ s, c, m }); if (s === "error") this.errors.push({ c, m }); },
    error(c, m) { this.add("error", c, m); },
    warn(c, m) { this.add("warning", c, m); },
  });
  const 宿主读 = (源) => {
    const d = 空诊断2();
    const { ast } = parse(lex(源).tokens, { diagnostics: d });
    return { ast, 错: d.errors };
  };
  const 宿挤 = 宿主读(挤), 宿分 = 宿主读(分);
  ok("挤在一行那一份没有诊断", 宿挤.错.length === 0, JSON.stringify(宿挤.错));
  ok("分行那一份也没有诊断", 宿分.错.length === 0, JSON.stringify(宿分.错));
  ok("两份都读出了体", !!(宿挤.ast.decls[0].body) && !!(宿分.ast.decls[0].body), "");
  ok("两份的体语句数一样",
    !!宿挤.ast.decls[0].body && !!宿分.ast.decls[0].body &&
    宿挤.ast.decls[0].body.statements.length === 宿分.ast.decls[0].body.statements.length, "");

  const 跑关 = (源) => run(源, {}).output.join("");
  ok("两份跑出同一段且是 42", 跑关(挤) === 跑关(分) && 跑关(挤) === "42\n", JSON.stringify([跑关(挤), 跑关(分)]));
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
