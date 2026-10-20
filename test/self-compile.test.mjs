// 「编译自己」现在到哪儿：把当下的数字钉住。
//
// 这一套不钉「该通过」，它钉「现在是这样」。
// 于是将来补上时它会红，而那时改它的人会先读设计文档里那一段。
//
// 为什么值得有一套这样的测试：一个写着「快好了」的说明，
// 会让下一个人从这里接手时以为只差一行。数字不会。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 自举 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")), { maxDepth: 3000 });
const 算名 = (路) => {
  const 源 = fs.readFileSync(路, "utf8");
  return 自举.callFunction(自举.functions.get("函数名们"), [源], null);
};
const 宿名 = (路) => {
  const 宿 = loadUnit(路);
  if (!宿.ok) return -1;
  return Array.from(宿.modules.values()).reduce((a, m) => a + m.decls.filter((d) => d.kind === "Fn").length, 0);
};

console.log("一、自举认得的那两份，与宿主差多少");
{
  const stmt路 = path.join(ROOT, "self/stmt.hmyr");
  const stmt自举 = 算名(stmt路).length;
  const stmt宿 = 宿名(stmt路);
  ok("stmt.hmyr：自举认出十个（当下）", stmt自举 === 10, String(stmt自举));
  ok("stmt.hmyr：宿主认出五十五个（当下）", stmt宿 === 55, String(stmt宿));
  ok("于是它们不一致，而那不是演算错", stmt自举 !== stmt宿, stmt自举 + " vs " + stmt宿);

  const body路 = path.join(ROOT, "self/body.hmyr");
  ok("body.hmyr：自举认出十四个（当下）", 算名(body路).length === 14, String(算名(body路).length));
  ok("body.hmyr：宿主认出六十九个（当下）", 宿名(body路) === 69, String(宿名(body路)));
}

console.log("二、两个天花板：深文件在借宿主跑时撞墙");
{
  // 每一份只调一次，把结果存下来。连调两次说法会变（第一次撞栈、第二次撞步数），
  // 那种不稳定不该被钉成一条断言——它会让这一套测试自己变成随机红的那种。
  const 试一次 = (名) => {
    try { 算名(path.join(ROOT, "self", 名)); return { 跑: true, 说法: "跑得动" }; }
    catch (e) { return { 跑: false, 说法: (e && e.message ? e.message : String(e)).slice(0, 46) }; }
  };
  const 结果 = {};
  for (const 名 of ["lex.hmyr", "chain.hmyr", "eval.hmyr", "run.hmyr"]) 结果[名] = 试一次(名);

  ok("lex.hmyr 当下跑不动", 结果["lex.hmyr"].跑 === false, 结果["lex.hmyr"].说法);
  ok("chain.hmyr 当下跑不动", 结果["chain.hmyr"].跑 === false, 结果["chain.hmyr"].说法);
  ok("eval.hmyr 当下跑不动", 结果["eval.hmyr"].跑 === false, 结果["eval.hmyr"].说法);
  ok("run.hmyr 当下跑不动", 结果["run.hmyr"].跑 === false, 结果["run.hmyr"].说法);

  // 而「哪种说法」是有信息量的：栈与步数是两道不同的墙，解法也不同。
  // 所以这里不钉具体哪一个，只钉「每一种说法都属于这两类之一」。
  const 说法们 = Object.values(结果).map((r) => r.说法);
  const 认得出 = 说法们.every((s) => s.includes("call stack") || s.includes("ran for too long") || s.includes("depth"));
  ok("每一种说法都落在「栈」或「步数」这两类里", 认得出, 说法们.join(" / "));
}

console.log("三、已经成立的那一半：它认得自己写的程序");
{
  // 求值那一半不在这里重测——test/self-agree.test.mjs 已经钉了十一例。
  // 这里只确认那条路还在，于是「一半真一半不真」这个句子有据。
  const 路 = path.join(ROOT, "test/self-agree.test.mjs");
  ok("对照那一套还在", fs.existsSync(路));
  const 文 = fs.readFileSync(路, "utf8");
  ok("而它钉的是「两边同一个答案」", 文.includes("两边同一个答案") || 文.includes("同一个数"), "在");
}

console.log("四、说明文档在，而且写着数字");
{
  const 文档 = path.join(ROOT, "design/SELFCOMPILE.txt");
  ok("design/SELFCOMPILE.txt 在", fs.existsSync(文档));
  const 文 = fs.readFileSync(文档, "utf8");
  ok("里面写了「还差三步」", 文.includes("还差三步"), "在");
  ok("也写了「这份数字会变」", 文.includes("这些数字会变"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
