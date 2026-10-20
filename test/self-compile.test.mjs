// 「编译自己」在默认配置下的现状：六份里两份过。
//
// 这一套钉的是默认栈的事实——别人不调 --stack-size 就会撞到这里。
// 而在 8 MB 栈下六份全过，那件事由 self-compile-stack 那套钉。
//
// 两套分开是有意的：抹掉「默认栈下过不去」等于让人以为开箱就能编译自己。
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

const 自举 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")), { maxDepth: 20000 });
const 试一 = (名) => {
  try {
    const 名们 = 自举.callFunction(自举.functions.get("函数名们"), [fs.readFileSync(path.join(ROOT, "self", 名 + ".hmyr"), "utf8")], null);
    return { 跑: true, 个数: 名们.length };
  } catch (e) { return { 跑: false, 说法: String(e && e.message ? e.message : e).slice(0, 46) }; }
};

console.log("一、默认栈下：这两份过");
{
  for (const 名 of ["stmt", "body"]) {
    const r = 试一(名);
    ok(名 + ".hmyr 在默认栈下跑得动", r.跑 === true, JSON.stringify(r).slice(0, 60));
  }
  ok("stmt.hmyr 认出十个", 试一("stmt").个数 === 10, String(试一("stmt").个数));
  ok("body.hmyr 认出十四个", 试一("body").个数 === 14, String(试一("body").个数));
}

console.log("二、默认栈下：另外四份撞栈");
{
  // 每份只调一次，把结果存下来——连调两次说法会变，那种不稳定不该被钉成断言。
  const 结果 = {};
  for (const 名 of ["lex", "chain", "eval", "run"]) 结果[名] = 试一(名);
  for (const 名 of ["lex", "chain", "eval", "run"]) {
    ok(名 + ".hmyr 在默认栈下跑不动", 结果[名].跑 === false, 结果[名].说法 || "");
  }
  ok("而它们在 8 MB 栈下跑得动（见 self-compile-stack）", fs.existsSync(path.join(ROOT, "test/self-compile-stack.test.mjs")));
}

console.log("三、说明文档在，且写着今天的实况");
{
  const 文档 = path.join(ROOT, "design/SELFCOMPILE.txt");
  ok("design/SELFCOMPILE.txt 在", fs.existsSync(文档));
  const 文 = fs.readFileSync(文档, "utf8");
  ok("写了「六份全对」", 文.includes("六份全对"), "在");
  ok("也写了默认栈下过不去", 文.includes("默认栈"), "在");
  ok("也写了「这些数字会变」", 文.includes("这些数字会变"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
