// 内建命令的认法验收：只认，不执行。
//
// 因为它不执行任何东西，所以每一行文本的判定都能被断言——
// 而真正的执行（改目录、退出）由调用方带着效果去申请。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "shell-builtins.hmoca")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 判 = (行) => call("认命令", [行]);

console.log("空行与全空白");
ok("空行是 empty", 判("").kind === "empty");
ok("只有空格也是 empty", 判("     ").kind === "empty");
ok("只有制表符也是 empty", 判("\t\t").kind === "empty");
ok("empty 的命令名与参数都是空串", call("命令名", [判("")]) === "" && call("参数", [判("")]) === "");

console.log("内建：认得出名字与参数");
{
  const a = 判("cd /tmp");
  ok("cd 带参数", a.kind === "builtin" && a.name === "cd" && call("参数", [a]) === "/tmp", JSON.stringify(a));
  const b = 判("cd");
  ok("cd 不带参数时参数是空串", b.kind === "builtin" && call("参数", [b]) === "", JSON.stringify(b));
  const c = 判("echo hello world");
  ok("echo 的参数原样保留", call("参数", [c]) === "hello world", JSON.stringify(call("参数", [c])));
  const d = 判("  echo   a   b  ");
  ok("首尾空白与连续空白都被归一", call("参数", [d]) === "a b", JSON.stringify(call("参数", [d])));
  ok("exit 认得", 判("exit").name === "exit");
  ok("help 认得", 判("help").name === "help");
  ok("clear 认得", 判("clear").name === "clear");
  ok("pwd 认得", 判("pwd").name === "pwd");
}

console.log("不是内建的交出去，不装作认识");
{
  const a = 判("ls -la");
  ok("ls 是 unknown", a.kind === "unknown" && a.name === "ls", JSON.stringify(a));
  ok("unknown 的参数是空串（这一层不替它解释）", call("参数", [a]) === "");
  ok("路径打头也不装作认识", 判("./a.sh").kind === "unknown");
}

console.log("帮助文字：说清有哪些，不假装知道怎么用");
{
  const h = call("帮助文字", []);
  ok("六个名字都在", ["cd", "pwd", "echo", "clear", "help", "exit"].every((n) => h.includes(n)), JSON.stringify(h));
  ok("开头是「内建：」", h.startsWith("内建："), JSON.stringify(h.slice(0, 12)));
  ok("而且说清了其余交给调用方", h.includes("交给调用方"));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
