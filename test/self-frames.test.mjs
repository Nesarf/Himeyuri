// 一层 Himeyuri 递归值多少帧宿主栈。
//
// 这一套钉的是一个**量出来的数字**，而且刻意钉成一个区间而不是精确值：
// 精确到一位小数会随任何一次实现调整而变，那个区间能活得更久。
//
// 它同时钉住「为什么没从这儿下手」——那个决定比数字更容易被忘。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 二分找「还能跑」的最大深度，两边都用同一份栈。
const 找界 = (试, 低, 高) => {
  while (低 + 1 < 高) {
    const 中 = Math.floor((低 + 高) / 2);
    if (试(中)) 低 = 中; else 高 = 中;
  }
  return 低;
};

const 试宿主 = (n) => {
  const f = (k) => (k === 0 ? 0 : 1 + f(k - 1));
  try { f(n); return true; } catch (e) { return false; }
};
const 试语言 = (n) => {
  const 程序 = "fn d(n: Int) -> Int {\n  if n == 0 {\n    return 0\n  }\n  return 1 + d(n - 1)\n}\nfn main() -> Int {\n  return d(" + n + ")\n}\n";
  try {
    const r = run(程序, { maxDepth: 1000000000 });
    return r.diagnostics.items.length === 0;
  } catch (e) { return false; }
};

console.log("一、两边在同一份栈上各能到多深");
let 宿主深 = 0, 语言深 = 0;
{
  宿主深 = 找界(试宿主, 100, 200000);
  语言深 = 找界(试语言, 10, 100000);
  ok("宿主纯递归能到一千层以上", 宿主深 > 1000, String(宿主深));
  ok("语言递归能到五百层以上", 语言深 > 500, String(语言深));
  ok("而语言比宿主浅（栈被吃掉了）", 语言深 < 宿主深, 语言深 + " 对 " + 宿主深);
}

console.log("二、一层值多少帧：区间而不是精确值");
{
  const 帧 = 宿主深 / 语言深;
  ok("一层在八帧以上", 帧 > 8, 帧.toFixed(1));
  ok("而不到二十帧", 帧 < 20, 帧.toFixed(1));
  console.log("    （量到的是 " + 帧.toFixed(1) + " 帧，约合 " + 宿主深 + " ÷ " + 语言深 + "）");
}

console.log("三、那个决定也记着：不从这儿下手");
{
  const 文档 = path.join(ROOT, "design/SELFCOMPILE.txt");
  ok("design/SELFCOMPILE.txt 在", fs.existsSync(文档));
  const 文 = fs.readFileSync(文档, "utf8");
  // 这一节的意思在尾调用之后变了：十一帧仍成立，而对非尾递归成立。
  // 于是断言跟着换——钉的是文档现在说的那件事，不是它曾经说过的。
  ok("写了第六节", 文.includes("六、一层递归值多少帧"), "在");
  ok("说明十一帧对非尾递归仍成立", 文.includes("对非尾递归而言") || 文.includes("只影响非尾递归"), "在");
  ok("并说了尾递归不走那条环", 文.includes("尾递归不走那条环") || 文.includes("走的是一层循环"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
