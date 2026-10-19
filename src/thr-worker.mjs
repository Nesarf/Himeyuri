// 一个线程：在里面跑一段 Himeyuri 源码的入口函数，把结果写成文件。
//
// 为什么不靠 postMessage：on("message") 的回调也在主线程的事件循环里，
// 而主线程此刻正堵在 Atomics.wait 上——那个回调永远不跑。
// 所以结果走文件，而共享内存只负责「写完了」这一个信号。
import fs from "node:fs";
import { workerData } from "node:worker_threads";
import { Runtime } from "./eval.mjs";
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
    const rt = new Runtime({});
    rt.write = (s) => { out += s; };
    rt.registerModule(ast);
    const fn = rt.functions.get(entry);
    if (!fn) 报(false, "没有这个函数：" + entry, out);
    else 报(true, String(rt.callFunction(fn, [], null)), out);
  }
} catch (err) {
  报(false, "线程里抛错：" + String(err && err.message ? err.message : err), "");
}
