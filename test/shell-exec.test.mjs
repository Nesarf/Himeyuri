// 执行层的验收：动世界的地方都带着申请，而输出与退出只是判定。
//
// cd 会真的改动这个进程的工作目录，所以每一步之后都恢复原样——
// 套件之间不该互相影响，这一点在这里尤其要紧。
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "shell-builtins.hmoca")));
rt.registerModule(loadUnit(path.join(ROOT, "term.hmoca")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 执行 = (行) => call("执行命令", [call("认命令", [行])]);
const 原目录 = process.cwd();
const 恢复 = () => { try { process.chdir(原目录); } catch (err) { /* 恢复不了也要继续报 */ } };

try {
  console.log("不动世界的命令：只交回一个判定");
  ok("空行什么也不做", 执行("").kind === "nothing");
  ok("echo 交回输出", 执行("echo hi").kind === "output" && 执行("echo hi").text === "hi", JSON.stringify(执行("echo hi")));
  ok("echo 不带参数时输出空串", 执行("echo").text === "");
  ok("pwd 交回当前目录", 执行("pwd").text === process.cwd(), JSON.stringify(执行("pwd").text));
  ok("help 交回内建清单", 执行("help").text.includes("cd") && 执行("help").text.includes("exit"));
  ok("clear 交回清屏与归位", 执行("clear").text.startsWith(ESC + "[2J"), JSON.stringify(执行("clear").text.slice(0, 10)));
  ok("exit 交回退出码零", 执行("exit").kind === "exit" && 执行("exit").code === 0);
  ok("exit 3 交回三", 执行("exit 3").code === 3, String(执行("exit 3").code));

  console.log("不认识的命令交出去，不装作认识");
  {
    const r = 执行("ls -la");
    ok("ls 是 external", r.kind === "external" && r.name === "ls", JSON.stringify(r));
  }

  console.log("cd：真的改目录，而且失败不悄悄吞掉");
  {
    const 目标 = path.join(ROOT, "test").replace(/\\/g, "/");
    const r = 执行("cd " + 目标);
    // 比路径一致，不比字面字符串：Windows 上 cwd() 交回的是反斜杠。
    ok("cd 之后是 nothing，但带着新目录", r.kind === "nothing" && path.resolve(r.text) === path.resolve(目标), JSON.stringify(r));
    ok("进程的工作目录真的变了", path.resolve(process.cwd()) === path.resolve(目标), process.cwd());
    ok("pwd 跟着变", 执行("pwd").text === process.cwd());
    恢复();
    ok("恢复回原目录", path.resolve(process.cwd()) === path.resolve(原目录), process.cwd());
  }
  {
    let raised = null;
    try { 执行("cd E:/definitely-no-such-dir-9f3a"); } catch (err) { raised = (err.code || "") + " " + err.message; }
    ok("进不去的目录被拒绝，编号 HMYR-內-009", !!raised && raised.includes("HMYR-內-009"), String(raised));
    恢复();
  }
  {
    ok("cd 不带参数回家（宿主给的主目录）", 执行("cd").text === process.cwd(), JSON.stringify(执行("cd").text));
    恢复();
  }

  console.log("效果：这一层真的带着声明");
  {
    // 同一行代码，在只给 file 的宿主里应当被拒（chdir 要 process）
    const src = 'fn main() -> Int effects(file) { print(执行命令(认命令("cd /"))) return 0 }\n';
    const { lex } = await import("../src/lexer.mjs");
    const { parse } = await import("../src/parser.mjs");
    const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
    const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
    const errs = d.items.filter((x) => x.s === "error");
    ok("那段小程序本身解析得动", errs.length === 0, errs.map((x) => x.c).join(","));
    const 求值器 = runUnit(loadUnit(path.join(ROOT, "shell-builtins.hmoca")));
    求值器.registerModule(loadUnit(path.join(ROOT, "term.hmoca")).modules.values().next().value);
    求值器.write = () => {};
    求值器.registerModule(ast);
    let 被拒 = null;
    try { 求值器.callFunction(求值器.functions.get("main"), [], null); } catch (err) { 被拒 = (err.code || "") + " " + err.message; }
    ok("声明只有 file 时，调用 chdir 被拒绝", !!被拒 && (被拒.includes("process") || 被拒.includes("effect")), String(被拒));
  }
} finally {
  恢复();
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
