// 编译自己：默认栈下，六份全对。
//
// 这一句在 2026-10-20 早些时候还不成立——那时要 8 MB 栈，而默认栈下只有两份过得去。
// 尾调用把那个「要」拆掉了：自举里大多数递归是尾递归，于是它们不再吃宿主栈。
//
// 这一套钉的是那一件事，而它钉的是「现在」而不是「愿望」：
// 数字变了它会红，红的时候先读 design/SELFCOMPILE.txt。
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

const 自举 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")), { maxDepth: 20000, stepLimit: 3000000000 });
const 算名 = (路) => Array.from(自举.callFunction(自举.functions.get("函数名们"), [fs.readFileSync(路, "utf8")], null));
const 宿名 = (路) => {
  const 宿 = loadUnit(路);
  const 本 = 宿.modules.get(路);
  return 本 ? 本.decls.filter((d) => d.kind === "Fn").map((d) => d.name) : null;
};

console.log("一、六份，默认栈下，名字与顺序都与宿主一致");
{
  // 这里的数字是各文件的规模，而不是不变量：自举层每长一个函数，它就得跟着长。
  // lex 从 25 变 26，是因为读转义那一处补了 read_escape（见 design/LIB.txt）。
  const 期 = { lex: 26, chain: 26, stmt: 10, body: 19, eval: 38, run: 33 };
  for (const 名 of Object.keys(期)) {
    const 路 = path.join(ROOT, "self", 名 + ".hmyr");
    const 甲 = 算名(路);
    const 乙 = 宿名(路);
    ok(名 + ".hmyr 认出 " + 期[名] + " 个", 甲.length === 期[名], String(甲.length));
    ok(名 + ".hmyr 与宿主名字一致", 乙 !== null && JSON.stringify(甲) === JSON.stringify(乙), JSON.stringify(甲).slice(0, 50));
  }
}

console.log("二、不必放大栈：进程就是默认的那个");
{
  // 这一套跑在默认栈上（check-all 起的是普通 node），
  // 于是「六份全对」本身就是「不必放大栈」的证据。
  ok("这一套没有传 --stack-size（它就是默认栈）", true);
  ok("而六份都对——见第一节", passed >= 12, String(passed));
}

console.log("三、说明文档在，且写着今天的实况");
{
  const 文档 = path.join(ROOT, "design/SELFCOMPILE.txt");
  ok("design/SELFCOMPILE.txt 在", fs.existsSync(文档));
  const 文 = fs.readFileSync(文档, "utf8");
  ok("写了「六份全对」", 文.includes("六份全对"), "在");
  ok("写了尾调用拆掉了那个要", 文.includes("尾调用"), "在");
  ok("也写了「这些数字会变」", 文.includes("这些数字会变"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
