// 一个线程：在那边用同一台字节码机跑一段源码里的入口函数，结果写成文件。
//
// 与 thr-worker.mjs 的分工：那一份跑宿主求值器，这一份跑字节码机。
// 分开成两个文件而不是加一个开关，理由是它们各自 import 的机器不同 ——
// 一个 worker 引两种机器，等于把两台都拖进每一个线程的内存里。
//
// 为什么不靠 postMessage：on("message") 的回调也在主线程的事件循环里，
// 而主线程此刻正堵在 Atomics.wait 上，那个回调永远不跑。所以结果走文件，
// 共享内存只负责「写完了」这一个信号。这一条与宿主那一份同源。
import fs from "node:fs";
import { workerData } from "node:worker_threads";
import { lex } from "./lexer.mjs";
import { parse } from "./parser.mjs";
import { 编译模块, 合并程序 } from "./bytecode.mjs";
import { 虚拟机 } from "./vm.mjs";
import { 本机能力 } from "./capabilities.mjs";

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
    const 程序 = 合并程序([编译模块(ast)]);
    let out = "";
    const vm = new 虚拟机(程序, { capabilities: 本机能力(), write: (s) => { out += s; } });
    const r = vm.调用(entry, [], null);
    if (r.ok) 报(true, String(r.值), out);
    else 报(false, r.码 + " " + r.话, out);
  }
} catch (err) {
  报(false, "线程里抛错：" + String(err && err.message ? err.message : err), "");
}
