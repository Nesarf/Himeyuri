// 一座同形状的桥：loadUnit 与 runUnit 的签名不变，里面换成 HMYR 自己那一套。
//
// 引导有两种走法，选哪个看产物在不在、新不新：
//   一、runtime/run.hmyrb 在，且不比 self/run.hmyr 旧 → 直接上字节码机（快，一个文件约 0.35 秒）；
//   二、否则退回解释器（慢，一到两秒一个文件，但不需要任何产物）。
// 回退那一条是故意的：一份过期或缺失的字节码不该让加载器说谎，宁可慢。它也保证了
// 「刚改完 self/run.hmyr、还没重新生成字节码」的中间状态仍然是对的。
//
// 字节码这条路 2026-10-24 一度走不通：那时虚拟机没有尾调用，而 tokenize 是「每读一个 token
// 递归一次」，lex.hmyr 一千多个 token 就是一千多层，深度一过 4000 就撞 JS 栈。补上尾调用
// （src/vm.mjs 里「CALLF 后紧跟 RET 就复用这一帧」）之后，那 0.35 秒才真的能用。
//
// 从「读 .hmyr 文件、搭出树」这一步起，做主的已经是 HMYR 自己：递归、去重、环拒绝、后序。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit as 宿主载, runUnit as 宿主跑 } from "../src/loader.mjs";
import { Runtime } from "../src/eval.mjs";
import { 读程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 源路 = path.join(ROOT, "self/run.hmyr");
const 字节路 = path.join(ROOT, "runtime/run.hmyrb");

let 引导 = null;
function 取引导() {
  if (引导) return 引导;
  const 有字节 = fs.existsSync(字节路) && fs.existsSync(源路) &&
    fs.statSync(字节路).mtimeMs >= fs.statSync(源路).mtimeMs;
  if (有字节) {
    // 深度：尾调用之后 tokenize 那条不再吃栈，四千层对「造一棵树」绰绰有余；
    // 再高会撞 JS 栈（这台机器上 12000 就撞过）。
    const vm = new 虚拟机(读程序(fs.readFileSync(字节路)), {
      capabilities: 本机能力(), stepLimit: 40000000000, maxDepth: 4000,
    });
    // vm.调用 交回的是 {ok, 值} 这层包装，解释器的 callFunction 交回的是值本身。
    // 桥对上面统一成「值或抛」，于是「包装」这件事只在这一行里。
    引导 = { 走法: "字节码", 调: (名, 参) => {
      const r = vm.调用(名, 参, null);
      if (!r || !r.ok) throw new Error(r && r.码 ? r.码 + " " + r.话 : "字节码机停机");
      return r.值;
    } };
  } else {
    const rt = 宿主跑(宿主载(源路), { stepLimit: 40000000000 });
    引导 = { 走法: "解释器", 调: (名, 参) => rt.callFunction(rt.functions.get(名), 参, null) };
  }
  return 引导;
}

const 新诊断 = () => ({ errors: [], warnings: [], items: [], add() {}, error() {}, warn() {} });

// 两台执行器交回的记录长得不一样：解释器给普通对象与数组，字节码机给它自己的
// 类记录（fields 是一个 Map）与类元组（items）。宿主的 Runtime 只认前一种，
// 所以走字节码这条路时把形状翻一遍 —— 翻一次，量的是模块树，不随程序规模走。
const 深转 = (v) => {
  if (v && v.tag === "tuple") return v.items.map(深转);
  if (v && v.tag === "record") {
    const o = {};
    for (const [k, x] of v.fields) o[k] = 深转(x);
    return o;
  }
  if (Array.isArray(v)) return v.map(深转);
  return v;
};

export function 引导走法() {
  return 取引导().走法;
}

export function loadUnit(entry, options = {}) {
  const 诊断 = 新诊断();
  const 相对 = path.relative(ROOT, path.resolve(entry)).split("\\").join("/");
  let 树 = null;
  try {
    树 = 深转(取引导().调("造整棵", [相对]));
  } catch (e) {
    诊断.errors.push({ code: "HMYR-SELF", message: String(e && e.message).slice(0, 160) });
    return { ok: false, order: [], modules: new Map(), diagnostics: 诊断 };
  }
  if (!树 || !树.ok) {
    诊断.errors.push({ code: "HMYR-SELF", message: String(树 && 树.错 ? 树.错 : "造整棵没有交回结果") });
    return { ok: false, order: [], modules: new Map(), diagnostics: 诊断 };
  }
  const modules = new Map();
  const order = [];
  Array.from(树.模块们).forEach((m, i) => {
    const 键 = 相对 + "#" + i;
    modules.set(键, m);
    order.push(键);
  });
  return { ok: true, order, modules, diagnostics: 诊断 };
}

export function runUnit(unit, options = {}) {
  const rt = new Runtime(options);
  for (const key of unit.order) rt.registerModule(unit.modules.get(key));
  return rt;
}

export function describeUnit(unit) {
  return unit.order.map((k, i) => (i + 1) + ". " + k).join("  ");
}
