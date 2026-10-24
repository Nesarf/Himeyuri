// 一座同形状的桥：loadUnit 与 runUnit 的签名不变，里面换成 HMYR 自己那一套。
//
// 这是「换掉 src/loader.mjs」的第一块实地。引导那一层还得借宿主 —— 要跑 HMYR 写的加载器，
// 总得先有个东西跑它 —— 但从「读 .hmyr 文件、搭出树」这一步起，做主的已经是 self/run.hmyr
// 的 造整棵：递归、去重、环拒绝、后序，都按它自己的规矩来。
//
// 交出的形状与 src/loader.mjs 一样宽：{ ok, order, modules, diagnostics }。
// 差别在 modules 里装的东西 —— 那边是 subset-parse 的 ast，这边是 造整棵 交出的 Module。
// runUnit 只做一件事：按 order 依次 registerModule 到同一个 Runtime。
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
