// shell 行编辑与历史的验收：状态进、新状态出，于是每次按键都能断言。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "shell.hmoca")));
rt.registerModule(loadUnit(path.join(ROOT, "term.hmoca")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 打 = (状态, 文字) => { let s = 状态; for (const c of 文字) s = call("插入", [s, c]); return s; };

console.log("插入与光标");
{
  const 空 = call("空状态", []);
  ok("空状态是空缓冲、光标在零", call("缓冲", [空]) === "" && call("光标", [空]) === 0);
  const ab = 打(空, "ab");
  ok("打两个字符之后缓冲是 ab", call("缓冲", [ab]) === "ab", call("缓冲", [ab]));
  ok("光标在末尾（二）", call("光标", [ab]) === 2);
  const 左 = call("左移", [ab]);
  ok("左移一格", call("光标", [左]) === 1);
  const axb = call("插入", [左, "x"]);
  ok("在中间插入", call("缓冲", [axb]) === "axb", call("缓冲", [axb]));
  ok("光标跟着右移", call("光标", [axb]) === 2);
  // 分步写：三层嵌套挤在一行时括号数不过来，而这是套件，不是代码高尔夫。
  const 左1 = call("左移", [ab]);
  const 左2 = call("左移", [左1]);
  const 左3 = call("左移", [左2]);
  ok("左移到头就停住", call("光标", [左3]) === 0, String(call("光标", [左3])));
  const 右1 = call("右移", [ab]);
  const 右2 = call("右移", [右1]);
  const 右3 = call("右移", [右2]);
  ok("右移到尾就停住", call("光标", [右3]) === 2, String(call("光标", [右3])));
  const 首 = call("到首", [ab]);
  ok("到首与到尾", call("光标", [首]) === 0 && call("光标", [call("到尾", [首])]) === 2);
}
console.log("退格与删除");
{
  const ab = 打(call("空状态", []), "ab");
  const 退 = call("退格", [ab]);
  ok("退格删掉末尾那个", call("缓冲", [退]) === "a" && call("光标", [退]) === 1, call("缓冲", [退]));
  const 空退 = call("退格", [call("空状态", [])]);
  ok("空缓冲上退格不崩", call("缓冲", [空退]) === "");
  const 中 = call("插入", [call("左移", [ab]), "x"]);
  // 光标停在 x 后面（位置二），所以删除删掉的是 b，留下 ax。
  const 删了 = call("删除", [中]);
  ok("删除删掉光标所在那个（b），留下 ax", call("缓冲", [删了]) === "ax", call("缓冲", [删了]));
  ok("末尾删除不崩", call("缓冲", [call("删除", [ab])]) === "ab");
}
console.log("历史");
{
  let h = call("空历史", []);
  ok("一开始是空的", call("历史条数", [h]) === 0);
  h = call("记住", [h, "one"]);
  h = call("记住", [h, "two"]);
  ok("记住两条", call("历史条数", [h]) === 2);
  h = call("记住", [h, "two"]);
  ok("与最近一条相同就不重复记", call("历史条数", [h]) === 2);
  h = call("记住", [h, ""]);
  ok("空行不记", call("历史条数", [h]) === 2);
  const 上1 = call("上翻", [h]);
  ok("上翻一次得到最近那条", call("历史行", [上1]) === "two", call("历史行", [上1]));
  const 上2 = call("上翻", [上1]);
  ok("再上翻得到更早那条", call("历史行", [上2]) === "one");
  const 上3 = call("上翻", [上2]);
  ok("到顶就停住", call("历史行", [上3]) === "one");
  const 下1 = call("下翻", [上3]);
  ok("下翻回到较晚那条", call("历史行", [下1]) === "two");
  const 下2 = call("下翻", [下1]);
  ok("再下翻就是新的空行", call("历史行", [下2]) === "");
  ok("空历史上翻不崩", call("历史条数", [call("上翻", [call("空历史", [])])]) === 0);
}
console.log("喂键：把按键串成编辑过程");
{
  let s = call("空状态", []);
  let 回车 = false;
  for (const k of ["h", "i", "LEFT", "LEFT", "END", "!", "ENTER"]) {
    const r = call("喂键", [s, k]);
    s = r[0];
    回车 = r[1];
  }
  ok("一串按键之后缓冲是 hi!", call("缓冲", [s]) === "hi!", call("缓冲", [s]));
  ok("回车被认出来了", 回车 === true);
  ok("喂退格能删掉", call("缓冲", [call("喂键", [s, "BACKSPACE"])[0]]) === "hi", call("缓冲", [call("喂键", [s, "BACKSPACE"])[0]]));
}
console.log("渲染一行提示");
{
  const 打了 = 打(call("空状态", []), "ls");
  const 左了一格 = call("左移", [打了]);
  const 帧 = call("渲染提示行", ["> ", 左了一格]);
  ok("以清屏开头", 帧.startsWith(ESC + "[2J"), JSON.stringify(帧.slice(0, 10)));
  ok("含提示符与缓冲", 帧.includes("> ") && 帧.includes("ls"));
  ok("末尾是光标定位（列从 1 起算）", /\u001b\[1;\d+H$/.test(帧) || 帧.includes(ESC + "[1;"), JSON.stringify(帧.slice(-12)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
