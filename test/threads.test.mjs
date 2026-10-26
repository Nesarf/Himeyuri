// 真线程的验收：另一个核上跑完，结果交回，隔离是硬的。
//
// 三条最要紧的：
//   一、结果对（算的是 1 到 n-1 之和）
//   二、隔离是硬的（worker 里有自己的名字，与主线程无关）
//   三、取消与句柄的边界说得清
//
// 注意送达那条通道：worker 把结果写成文件，共享内存只发「写完了」。
// 靠 postMessage 不行——那个回调在主线程的事件循环里，而主线程正堵在 Atomics.wait 上。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-thr-");
const 写 = (n, 内容) => { const p = path.join(临, n); fs.writeFileSync(p, 内容, "utf8"); return p.replace(/\\/g, "/"); };
const 跑 = (src) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) return { error: "解析报错 " + errs.map((x) => x.c).join(",") };
  let out = "";
  const rt = new Runtime({});
  rt.write = (s) => { out += s; };
  rt.registerModule(ast);
  try { rt.callFunction(rt.functions.get("main"), [], null); return { out }; }
  catch (e) { return { error: (e.code || "") + " " + e.message, out }; }
};

try {
  const 任务 = 写("task.hmoca", "fn work() -> Int {\n  var i = 0\n  var s = 0\n  while i < 100 {\n    s = s + i\n    i = i + 1\n  }\n  return s\n}\n");

  console.log("线程跑完，结果对");
  {
    const r = 跑('fn main() -> Int effects(thread, file) {\n  let 源码 = read_text("' + 任务 + '", "utf8")\n  let 手 = thr_spawn(源码, "work")\n  print(thr_join(手, 30000))\n  return 0\n}\n');
    ok("跑通了", !r.error, String(r.error).slice(0, 90));
    ok("交回 4950（一加到 99，等差数列对）", String(r.out).trim() === "4950", JSON.stringify(String(r.out).trim()));
  }

  console.log("隔离是硬的：worker 里有自己的名字");
  {
    // 主线程有一个 x；worker 里也有一个 x，值不同。各自算各自的。
    const 隔离任务 = 写("iso.hmoca", "fn work() -> Int {\n  var x = 100\n  x = x + 1\n  return x\n}\n");
    const r = 跑('fn main() -> Int effects(thread, file) {\n  var x = 1\n  let 源码 = read_text("' + 隔离任务 + '", "utf8")\n  let 手 = thr_spawn(源码, "work")\n  let 果 = thr_join(手, 30000)\n  print(果 + "|" + str(x))\n  return 0\n}\n');
    ok("worker 算出 101，而主线程的 x 还是 1", String(r.out).trim() === "101|1", JSON.stringify(String(r.out).trim()));
  }

  console.log("两个线程同时活着");
  {
    const r = 跑('fn main() -> Int effects(thread, file) {\n  let 源码 = read_text("' + 任务 + '", "utf8")\n  let 甲 = thr_spawn(源码, "work")\n  let 乙 = thr_spawn(源码, "work")\n  print(str(thr_count()))\n  let 一 = thr_join(甲, 30000)\n  let 二 = thr_join(乙, 30000)\n  print("|" + 一 + "|" + 二)\n  return 0\n}\n');
    ok("两个都活着", String(r.out).trim().startsWith("2"), JSON.stringify(String(r.out).trim()));
    ok("两个结果都一样且对", String(r.out).includes("|4950|4950"), JSON.stringify(String(r.out).trim()));
  }

  console.log("边界");
  {
    const r = 跑('fn main() -> Int effects(thread) {\n  print(str(thr_join(999, 100)))\n  return 0\n}\n');
    ok("不存在的句柄给 R0221", r.error && r.error.includes("HMYR-R0221"), String(r.error).slice(0, 70));
  }
  {
    const r = 跑('fn main() -> Int effects(thread) {\n  print(str(thr_count()))\n  return 0\n}\n');
    ok("没有线程时计数是零", String(r.out).trim() === "0", JSON.stringify(String(r.out).trim()));
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("超时：等不到就报编号，而不是一直挂着");
{
  // 这一段在 finally 之后（临时目录已经删了），所以它自己造自己的文件。
  const 慢路径 = "E:/DaShaoHuo/cache/tmp/hmyr-thr-slow.hmoca";
  fs.writeFileSync(慢路径, "fn work() -> Int {\n  var i = 0\n  var s = 0\n  while i < 200000 {\n    s = s + i\n    i = i + 1\n  }\n  return s\n}\n", "utf8");
  const 慢 = 慢路径;
  const r = 跑('fn main() -> Int effects(thread, file) {\n  let 源码 = read_text("' + 慢 + '", "utf8")\n  let 手 = thr_spawn(源码, "work")\n  print(str(thr_join(手, 1)))\n  return 0\n}\n');
  ok("等不到就报 R0222（不挂死）", r.error && r.error.includes("HMYR-R0222"), String(r.error).slice(0, 80));
  fs.rmSync(慢路径, { force: true });
}

console.log("派生处：没声明 thread 就不许派生");
{
  // 效果在并发下只落一层，而今天落的就是这一层（SPEC 2.9 的 [定]）：
  // thr_spawn 带 thread 效果，所以没声明的函数调它会被 R0201 拒。
  // 更细的那一层（任务能碰的东西不许超出派生者）今天做不到 —— 任务是一段源码
  // 字符串，它的 effects 在字符串里，派生时看不见。理由写在 CONCURRENCY.txt 的 2.1.6。
  const r = 跑('fn main() -> Int {\n  let 手 = thr_spawn("(fn work() -> Int { 1 })", "work")\n  return 0\n}\n');
  ok("没声明 thread 的派生被拒（R0201）", r.error && r.error.includes("HMYR-R0201"), String(r.error).slice(0, 100));

  // 声明了就过得去 —— 这一句是上一条的对照，少了它判据会往「一律拒」偏。
  const 好 = 跑('fn main() -> Int effects(thread) {\n  let 手 = thr_spawn("(fn work() -> Int { 1 })", "work")\n  return 0\n}\n');
  ok("声明了 thread 就不报 R0201", !好.error || !好.error.includes("HMYR-R0201"), String(好.error).slice(0, 100));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
