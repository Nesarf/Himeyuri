// 一个线程：在最小求值器里跑一段 Himeyuri 源码的入口函数，把结果写成文件。
//
// 与 thr-worker.mjs 是同一件事的两份，差别只在用哪台机器。这一份不抽共用，
// 理由与 vm-builtins.mjs 里那段相同：抽出来的那层要同时满足「宿主的 Runtime」
// 与「最小运行时」两套接口，而两份各三十行比那层抽象好读。
//
// 两个选项与 bin/hmyr.mjs 的主路径对齐：字符串住码元序列、关掉内置效果检查
// （这一层在跑解释器，它替目标程序执行，必然碰得到全部效果）。
//
// 为什么不靠 postMessage：on("message") 的回调也在主线程的事件循环里，
// 而主线程此刻正堵在 Atomics.wait 上 —— 那个回调永远不跑。所以结果走文件，
// 共享内存只负责「写完了」这一个信号。
import fs from "node:fs";
import { workerData } from "node:worker_threads";
import { 最小运行时 } from "./minimal-eval.mjs";
import { 本机能力 } from "./capabilities.mjs";
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";

const { source, entry, outPath, flag } = workerData;
const 报 = (ok, text, out) => {
  try {
    fs.writeFileSync(outPath, JSON.stringify({ ok, text, out }), "utf8");
  } catch (err) { /* 写不进去就只剩失败信号 */ }
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
};

try {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(source, { diagnostics: d }).tokens, { diagnostics: d });
  const errs = d.items.filter((x) => x.s === "error");
  if (errs.length) {
    报(false, "解析报错 " + errs.map((x) => x.c).join(","), "");
  } else {
    let out = "";
    const rt = new 最小运行时({
      capabilities: 本机能力(),
      检查效果: false,
      字符串用码元序列: true,
    });
    rt.write = (s) => { out += s; };
    rt.registerModule(ast);
    const fn = rt.functions.get(entry);
    if (!fn) 报(false, "没有这个函数：" + entry, out);
    else 报(true, String(rt.callFunction(fn, [], null)), out);
  }
} catch (err) {
  报(false, "线程里抛错：" + String(err && err.message ? err.message : err), "");
}
