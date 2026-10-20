// 「编译自己」现在到哪儿：把当下的数字钉住。
//
// 这一套钉的是同尺度对照：只算「这一份文件自己的声明」。
// 上一版这里错在把「单文件」与「整棵 import 树」放在一起比，
// 于是比出了十对五十五这种假差距。
//
// 它不钉「该通过」，它钉「现在是这样」——将来补上时它会红，
// 而那时改它的人会先读 design/SELFCOMPILE.txt 里那一段。
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
const 自举名 = (路) => Array.from(自举.callFunction(自举.functions.get("函数名们"), [fs.readFileSync(路, "utf8")], null));
const 宿主名 = (路) => {
  const 宿 = loadUnit(路);
  const 本 = 宿.modules.get(路);
  if (!本) return null;
  return 本.decls.filter((d) => d.kind === "Fn").map((d) => d.name);
};

console.log("一、同尺度对照：这两份，自举与宿主名字与顺序都对得上");
{
  for (const 名 of ["stmt", "body"]) {
    const 路 = path.join(ROOT, "self", 名 + ".hmyr");
    const 甲 = 自举名(路);
    const 乙 = 宿主名(路);
    ok(名 + ".hmyr：两边数量一致（" + 甲.length + "）", 乙 !== null && 甲.length === 乙.length, 甲.length + " vs " + (乙 ? 乙.length : "取不到"));
    ok(名 + ".hmyr：名单与顺序完全一致", JSON.stringify(甲) === JSON.stringify(乙), JSON.stringify(甲).slice(0, 60));
  }
}

console.log("二、四个大文件撞墙，而说法落在「栈」或「步数」两类");
{
  const 试一次 = (名) => {
    try { 自举名(path.join(ROOT, "self", 名 + ".hmyr")); return { 跑: true, 说法: "跑得动" }; }
    catch (e) { return { 跑: false, 说法: String(e && e.message ? e.message : e).slice(0, 46) }; }
  };
  const 结果 = {};
  for (const 名 of ["lex", "chain", "eval", "run"]) 结果[名] = 试一次(名);
  for (const 名 of ["lex", "chain", "eval", "run"]) {
    ok(名 + ".hmyr 当下跑不动", 结果[名].跑 === false, 结果[名].说法);
  }
  const 说法们 = Object.values(结果).map((r) => r.说法);
  const 认得出 = 说法们.every((s) => s.includes("call stack") || s.includes("ran for too long") || s.includes("depth"));
  ok("每种说法都在「栈」或「步数」这两类里", 认得出, 说法们.join(" / "));
}

console.log("三、已经成立的那一半：它认得自己写的程序");
{
  const 路 = path.join(ROOT, "test/self-agree.test.mjs");
  ok("对照那一套还在", fs.existsSync(路));
  const 文 = fs.readFileSync(路, "utf8");
  ok("而它钉的是「两边同一个答案」", 文.includes("两边同一个答案") || 文.includes("同一个数"), "在");
}

console.log("四、说明文档在，且记着那次量法错");
{
  const 文档 = path.join(ROOT, "design/SELFCOMPILE.txt");
  ok("design/SELFCOMPILE.txt 在", fs.existsSync(文档));
  const 文 = fs.readFileSync(文档, "utf8");
  ok("里面写了「量错过一次」", 文.includes("量错过一次"), "在");
  ok("也写了「还差两步」", 文.includes("还差两步"), "在");
  ok("也写了「这些数字会变」", 文.includes("这些数字会变"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
