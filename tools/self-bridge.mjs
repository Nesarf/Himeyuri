// 一座同形状的桥：loadUnit 与 runUnit 的签名不变，里面换成 HMYR 自己那一套。
//
// 2026-10-24 试过「引导走字节码机」这条路 —— 把 self/run.hmyr 编成 runtime/run.hmyrb 再跑。
// 单文件确实快：0.33 秒，对解释器的一到两秒。但它撞在一个更硬的地方：字节码机没有尾调用优化，
// 而 tokenize 是「每读一个 token 递归一次」，lex.hmyr 一千多个 token 就是一千多层。
// 解释器把尾递归吃掉（src/eval.mjs 的 TailCall），字节码机老实压栈 —— depth 过 4000 就撞
// JS 栈，而在桥这样的调用深度里，4000 也不稳（实测 3000 抛、4000 过、12000 抛，边界不干净）。
//
// 所以这里走回解释器：慢，但稳。要让字节码这条路成立，先得给虚拟机补尾调用 —— 那是独立的
// 一件活，不是一次配置调整。字节码产物（runtime/run.hmyrb）因此不入库：一份用不上的产物
// 摆在那里，只会让人以为它已经在跑。
//
// 从「读 .hmyr 文件、搭出树」这一步起，做主的仍然是 HMYR 自己：递归、去重、环拒绝、后序。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit as 宿主载, runUnit as 宿主跑 } from "../src/loader.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let 引导 = null;
function 取引导() {
  if (!引导) {
    引导 = 宿主跑(宿主载(path.join(ROOT, "self/run.hmyr")), { stepLimit: 40000000000 });
  }
  return 引导;
}

const 新诊断 = () => ({ errors: [], warnings: [], items: [], add() {}, error() {}, warn() {} });

export function 引导走法() {
  取引导();
  return "解释器";
}

export function loadUnit(entry, options = {}) {
  const 诊断 = 新诊断();
  const 相对 = path.relative(ROOT, path.resolve(entry)).split("\\").join("/");
  let 树 = null;
  try {
    树 = 取引导().callFunction(取引导().functions.get("造整棵"), [相对], null);
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
