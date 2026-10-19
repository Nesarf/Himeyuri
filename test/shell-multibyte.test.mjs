// 退格与删除按「字」算，不按码位。
//
// 为什么这不是细节：组合字符在码位上是两个、在屏幕上是一个字。
// 只删一个码位会留下一个孤零零的重音符，它粘到前面那个字上——
// 用户看到的是「屏幕自己变了」，而代码里没有任何一步出错。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "shell.hmyr"));
ok("shell 那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 打 = (文本) => {
  let s = call("空状态", []);
  for (const ch of 文本) s = call("插入", [s, ch]);
  return s;
};

const 组合 = "e" + String.fromCharCode(0x0301);
const 单码位 = "é";

console.log("一、普通字符照旧");
{
  let s = 打("abc");
  s = call("退格", [s]);
  ok("abc 退一格得 ab", s[0] === "ab" && s[1] === 2, s[0] + " · " + s[1]);
  s = call("删除", [s]);
  ok("ab 删一格（光标在末尾）不变", s[0] === "ab", s[0]);
}

console.log("二、组合字整个删掉");
{
  const s0 = 打(组合);
  ok("组合字在码位上是二", s0[0].length === 2, String(s0[0].length));
  const s1 = call("退格", [s0]);
  ok("退一格之后整个字都没了", s1[0] === "" && s1[1] === 0, JSON.stringify(s1[0]) + " · " + s1[1]);
  ok("而且没有留下孤零零的重音符", s1[0].indexOf(String.fromCharCode(0x0301)) < 0);
}

console.log("三、单码位的 é 也照删");
{
  const s0 = 打(单码位);
  ok("单码位的 é 是码位一", s0[0].length === 1, String(s0[0].length));
  const s1 = call("退格", [s0]);
  ok("退一格之后没了", s1[0] === "" && s1[1] === 0, JSON.stringify(s1[0]));
}

console.log("四、删除也按字");
{
  // 光标停在组合字之前，按 Del 该把整个字删掉
  let s = 打(组合);
  s = call("左移", [s]);
  s = call("左移", [s]);
  ok("光标回到最前", s[1] === 0, String(s[1]));
  const s2 = call("删除", [s]);
  ok("Del 一次删掉整个字", s2[0] === "" && s2[1] === 0, JSON.stringify(s2[0]));
}

console.log("五、显示宽度");
{
  const 宽 = (s) => call("显示宽", [s]);
  ok("abc 占三列", 宽("abc") === 3, String(宽("abc")));
  ok("两个中文占四列", 宽("中文") === 4, String(宽("中文")));
  ok("ab中占四列（一宽两个、二宽一个）", 宽("ab中") === 4, String(宽("ab中")));
  ok("全角标点也是二宽", 宽("，。！") === 6, String(宽("，。！")));
  ok("组合符号是零宽", 宽(组合) === 1, String(宽(组合)));
  ok("混合串对得上", 宽("a中b，") === 6, String(宽("a中b，")));
  // 显示列：这是光标该去的地方，与码位下标不是一回事
  ok("「ab中」的末列是四，而码位是三", call("显示列", ["ab中", 3]) === 4, String(call("显示列", ["ab中", 3])));
  ok("而在第二个码位处是一列", call("显示列", ["中中", 1]) === 2, String(call("显示列", ["中中", 1])));
}

console.log("六、光标按字移动");
{
  // a + 组合 e + b 一共四个码位：a(0) e(1) 重音符(2) b(3)
  let s = call("空状态", []);
  for (const ch of ("a" + 组合 + "b")) s = call("插入", [s, ch]);
  ok("打了三个字、四个码位", s[0].length === 4 && s[1] === 4, s[0].length + " · " + s[1]);
  s = call("左移", [s]);
  ok("左一格停在 b 之前（位 3）", s[1] === 3, String(s[1]));
  s = call("左移", [s]);
  ok("再左一格跨过整个组合字（位 1）", s[1] === 1, String(s[1]));
  s = call("左移", [s]);
  ok("再左一格到最前（位 0）", s[1] === 0, String(s[1]));
  s = call("右移", [s]);
  ok("右一格到组合字之前（位 1）", s[1] === 1, String(s[1]));
  s = call("右移", [s]);
  ok("再右一格跨过整个组合字（位 3）", s[1] === 3, String(s[1]));
  s = call("右移", [s]);
  ok("再右一格到末尾（位 4）", s[1] === 4, String(s[1]));
  ok("而且停在组合符号中间的情况一次都没有", [1, 3].indexOf(call("左一字", ["a" + 组合 + "b", 3])) >= 0 || call("左一字", ["a" + 组合 + "b", 3]) === 1);
}

console.log("");
console.log("七、列与位之间的换算");
{
  const 位 = (s, 列) => call("列到位", [s, 列]);
  ok("窄字：第零列是第零位", 位("abcd", 0) === 0, String(位("abcd", 0)));
  ok("窄字：第二列是第二位", 位("abcd", 2) === 2, String(位("abcd", 2)));
  ok("超过宽度就停在末尾", 位("abcd", 9) === 4, String(位("abcd", 9)));
  ok("全角：第一列只能停在开头", 位("中文", 1) === 0, String(位("中文", 1)));
  ok("全角：第二列才进到第位一", 位("中文", 2) === 1, String(位("中文", 2)));
  ok("全角：第四列是第位二", 位("中文", 4) === 2, String(位("中文", 4)));
  ok("混合：第二列停在中的前面", 位("a中b", 2) === 1, String(位("a中b", 2)));
  ok("折行：三列刚好放下 a 与中", call("折行位", ["a中b", 3]) === 2, String(call("折行位", ["a中b", 3])));
  ok("折行与列到位是同一个换算", call("折行位", ["a中b", 2]) === 位("a中b", 2));
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
