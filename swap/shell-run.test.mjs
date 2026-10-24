// shell 会话的验收：喂一串注入的按键，整条线都能断言。
//
// 这与 term 那条线同一个立场——输入可注入、输出可断言。真终端那一半要人手敲，
// 所以这里只验注入的那条路，并顺便确认「接不上终端时它如实说」。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "shell-run.hmyr"));
ok("会话那一层加载得动（import 三件都成立）", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 会话 = (键们) => call("跑一次会话", [键们]);

console.log("打字：每喂一个键画一帧");
{
  const r = 会话(["h", "i"]);
  ok("两个键画了两帧", r[0].length === 2, String(r[0].length));
  ok("缓冲是 hi", call("缓冲", [r[1]]) === "hi", call("缓冲", [r[1]]));
  ok("历史还是空的（没按回车）", call("历史条数", [r[2]]) === 0);
  ok("帧都以清屏开头", r[0].every((f) => f.startsWith(ESC + "[2J")));
  ok("帧里有提示符与已打的字", r[0][1].includes("> ") && r[0][1].includes("hi"), JSON.stringify(r[0][1].slice(-24)));
}

console.log("回车：认命令、执行、记住、清空");
{
  const r = 会话(["h", "i", "ENTER"]);
  ok("回车之后缓冲清空", call("缓冲", [r[1]]) === "");
  ok("历史记了一条", call("历史条数", [r[2]]) === 1);
  ok("记的正是那一行", call("历史行", [call("上翻", [r[2]])]) === "hi", call("历史行", [call("上翻", [r[2]])]));
  ok("没有退出", r[3] === false);
}
console.log("内建与外部");
{
  const r = 会话(["l", "s", "ENTER"]);
  ok("ls 被认成外部命令，不执行", JSON.stringify(r[0]).includes("外部命令") && JSON.stringify(r[0]).includes("ls"), "帧里没找到");
  const r2 = 会话(["e", "x", "i", "t", "ENTER"]);
  ok("exit 让会话收工", r2[3] === true);
  ok("收工时也只画到最后一步", r2[0].length === 5, String(r2[0].length));
}
console.log("编辑键真的生效");
{
  const r = 会话(["a", "b", "LEFT", "x"]);
  ok("左移之后插入，缓冲是 axb", call("缓冲", [r[1]]) === "axb", call("缓冲", [r[1]]));
  const r2 = 会话(["a", "b", "BACKSPACE"]);
  ok("退格删掉一个", call("缓冲", [r2[1]]) === "a", call("缓冲", [r2[1]]));
}
console.log("历史上下翻");
{
  // 一次会话里打两行——两次独立会话各有各的历史，那测的就不是累加了。
  const r = 会话(["o", "n", "e", "ENTER", "t", "w", "o", "ENTER"]);
  ok("两条历史", call("历史条数", [r[2]]) === 2);
  const 上 = call("上翻", [r[2]]);
  ok("上翻拿到最近那条", call("历史行", [上]) === "two", call("历史行", [上]));
}
console.log("接不上终端时如实说");
{
  // 接不上终端时返回 1（零是「正常跑完」，不能混），并说明原因。
  const 码 = call("真会话", []);
  ok("不是终端时返回 1，不装作跑完了", 码 === 1, String(码));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
