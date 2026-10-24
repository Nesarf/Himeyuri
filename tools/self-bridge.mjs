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

// 字节码是不是还新鲜：比的是 self/ 下所有 .hmyr 里最新的那个，而不是只看 run.hmyr。
// 这条是被咬出来的：改了 chain.hmyr 而 run.hmyr 没动，产物里含着 chain 的代码，
// 却因为「源没变」被判成新鲜 —— 于是桥拿一份旧字节码跑得很欢。
function 源最新时间() {
  let 新 = 0;
  const 目录 = path.join(ROOT, "self");
  for (const 名 of fs.readdirSync(目录)) {
    if (!名.endsWith(".hmyr")) continue;
    const t = fs.statSync(path.join(目录, 名)).mtimeMs;
    if (t > 新) 新 = t;
  }
  return 新;
}

let 引导 = null;
function 取引导() {
  if (引导) return 引导;
  const 最新 = 源最新时间();
  const 有字节 = fs.existsSync(字节路) && 最新 > 0 && fs.statSync(字节路).mtimeMs >= 最新;
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
  // 仓库下的文件用相对路径（与 order 的说法一致）；仓库外的用绝对路径 ——
  // 测试常把临时文件交进来，那些不在 ROOT 下，转成 ../ 反而让加载器读不到。
  const 绝对 = path.resolve(entry);
  const 可能相对 = path.relative(ROOT, 绝对).split("\\").join("/");
  const 相对 = (可能相对.startsWith("..") || path.isAbsolute(可能相对)) ? 绝对.split(path.sep).join("/") : 可能相对;
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
  // order 用真实路径（与宿主 loader 同一个说法）。加载器交回的路径带 "./" 前缀，去掉。
  const modules = new Map();
  const order = [];
  const 路径们 = Array.from(树.路径们 || []);
  Array.from(树.模块们).forEach((m, i) => {
    const 原 = 路径们[i] || (相对 + "#" + i);
    const 键 = String(原).startsWith("./") ? String(原).slice(2) : String(原);
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
