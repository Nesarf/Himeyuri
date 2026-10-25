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
import { 是源码 } from "./file-kind.mjs";
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
    if (!是源码(名)) continue;
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
    // 字节码优先：同样一份 self/run.hmyr，解释器要近三秒，而 vm 跑同一份字节只要零点几秒。
    // 当初这条路撞栈是因为虚拟机没有尾调用；148a1c7 补上之后，深度不再是问题。
    // 深度留四千：尾调用之后 tokenize 不涨栈，而再高会撞 JS 栈（12000 撞过）。
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
  // nil 在宿主那边是 {type:"nil", value:null}；这一侧没有 null，所以到 JS 这一层才补上。
  if (v && v.tag === "record" && v.fields && v.fields.get("type") === "nil") {
    const o = {};
    for (const [k, x] of v.fields) o[k] = 深转(x);
    o.value = null;
    return o;
  }
  if (v && v.tag === "tuple") return v.items.map(深转);
  if (v && v.tag === "record") {
    const o = {};
    for (const [k, x] of v.fields) o[k] = 深转(x);
    // 无 else 的 if：这一侧包成「空 Block」，而宿主的编译按「有没有 otherwise」决定
    // 要不要在假分支补 CONST。空 Block 是真值，会被当成「有」，于是少一条指令；
    // 折成 null 才是宿主自己的说法。
    if (o.kind === "If" && o.otherwise && Array.isArray(o.otherwise.statements) && o.otherwise.statements.length === 0) {
      o.otherwise = null;
    }
    // rev 0 在这一侧表示「没写」；宿主用 null 表示不提要求。
    // -1 原样留着 —— 它是「写了 rev 但没有数字」，由 loadUnit 报成一条语法错。
    // 这里不能碰 诊断：深转 是模块级函数，那个变量不在它的作用域里。
    if ((o.kind === "Module" || o.kind === "Import") && o.rev === 0) o.rev = null;
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
    // 加载器已经说清是哪一种错（E0301 环、E0302 缺文件），桥不该把它折成自己的名字 ——
    // 那样一来「环」与「桥坏了」就分不出来，而调用方正是靠这个码决定怎么办。
    const 错 = String(树 && 树.错 ? 树.错 : "");
    const m = /^(E\d{4})\s+(.*)$/.exec(错);
    // 宿主的 diagnostics.error() 是两处都放：errors 给「有没有错」，items 给「有哪几条」。
    // 只写一处的话，读另一处的人就会看到「没有错」。
    const 条 = m
      ? { code: "HMYR-" + m[1], message: 错, file: m[2] }
      : { code: "HMYR-SELF", message: 错 || "造整棵没有交回结果" };
    诊断.errors.push(条);
    诊断.items.push(条);
    return { ok: false, order: [], modules: new Map(), diagnostics: 诊断 };
  }
  // order 用真实路径（与宿主 loader 同一个说法）。加载器交回的路径带 "./" 前缀，去掉。
  const modules = new Map();
  const 别名 = new Map();
  // get 先查正式表，再查别名 —— 对外仍是 Map，size 仍只数正式记录。
  const 原get = modules.get.bind(modules);
  modules.get = (k) => 原get(k) || 别名.get(k);
  const order = [];
  const 路径们 = Array.from(树.路径们 || []);
  Array.from(树.模块们).forEach((m, i) => {
    const 原 = 路径们[i] || (相对 + "#" + i);
    // 加载器用的是 /（HMYR 里没有反斜杠），而调用方拿 path.join / path.resolve 得到的是本机形式。
    // order 与 modules 的键都用本机形式，这样 indexOf(path.join(...)) 才找得到。
    let 键 = String(原).startsWith("./") ? String(原).slice(2) : String(原);
    键 = 键.split("/").join(path.sep);
    modules.set(键, m);
    // 同一个模块挂两个门牌：order 里用相对形式，而多数套件拿绝对路径来 get。
    // 但别名只挂在查询上，不进 Map 本身 —— 否则 modules.size 会翻倍，
    // 而 bootstrap 那套正是拿 size 数「带进几份文件」。
    const 绝对键 = path.resolve(键);
    if (绝对键 !== 键) 别名.set(绝对键, m);
    order.push(键);
  });
  // 重名声明：与宿主 src/loader.mjs 同一句话、同一个位置（diagnostics.items）。
  // 时机也一样 —— 整棵树的模块都建好之后再判，而不是边读边判。
  const 声明过 = new Map();
  for (const 键 of order) {
    for (const d of Array.from(modules.get(键).decls || [])) {
      if (!d || (d.kind !== "Fn" && d.kind !== "Const" && d.kind !== "TypeAlias")) continue;
      if (声明过.has(d.name)) {
        诊断.items.push({
          code: "HMYR-W0302",
          message: "two modules declare '" + d.name + "' (" + 声明过.get(d.name) + " and " + 键 +
            "); the later one wins until namespaces exist",
        });
      } else {
        声明过.set(d.name, 键);
      }
    }
  }
  // 「写了 rev 但没有数字」是一条语法错，不是「不提要求」。
  for (const 键 of order) {
    for (const d of Array.from(modules.get(键).decls || [])) void d;
  }
  for (const 键 of order) {
    const 模块 = modules.get(键);
    if (模块.rev === -1) {
      const 条 = { code: "HMYR-E0100", message: "rev is not followed by a revision number", file: 键 };
      诊断.errors.push(条);
      诊断.items.push(条);
      模块.rev = null;
    }
    for (const imp of Array.from(模块.imports || [])) {
      if (imp && imp.rev === -1) {
        const 条 = { code: "HMYR-E0100", message: "rev is not followed by a revision number", file: 键 };
        诊断.errors.push(条);
        诊断.items.push(条);
        imp.rev = null;
      }
    }
  }
  // 版本协商：import 要第 M 版，模块提供到第 N 版，M <= N 才成。
  // 宿主在 visit 之后做这件事，桥原来不做 —— 于是「模块 rev 对不上」这条它从不开口。
  for (const 键 of order) {
    const 模块 = modules.get(键);
    for (const imp of Array.from(模块.imports || [])) {
      const p = String((imp && imp.path) || "");
      if (!p) continue;
      const 算路径 = p.startsWith("./") || p.startsWith("../") || /^[A-Za-z]:[\\/]/.test(p) || path.isAbsolute(p);
      if (!算路径) continue;
      const 目标路 = path.resolve(path.dirname(键), p.split("/").join(path.sep));
      const 目标 = modules.get(目标路);
      if (!目标) continue;
      const 有 = 目标.rev;
      const 要 = imp.rev;
      if (有 !== null && 有 !== undefined && 要 !== null && 要 !== undefined && 要 > 有) {
        const 条 = {
          code: "HMYR-E0303",
          message: "module '" + p + "' offers revision " + 有 + ", but the import asks for " + 要 +
            "; there is no version both sides support",
          file: 键,
        };
        诊断.errors.push(条);
        诊断.items.push(条);
      }
    }
  }
  // 非路径的 import：加载器跳过它（那是包管理器的事），但那句话要说出来 —— 宿主用的是 W0301。
  for (const 键 of order) {
    for (const imp of Array.from(modules.get(键).imports || [])) {
      const p = String((imp && imp.path) || "");
      if (!p) continue;
      const 算路径 = p.startsWith("./") || p.startsWith("../") || /^[A-Za-z]:[\\/]/.test(p) || path.isAbsolute(p);
      if (!算路径) {
        诊断.items.push({
          code: "HMYR-W0301",
          message: "import of '" + p + "' is not a path; the package manager will own that",
        });
      }
    }
  }
  // 有错就不是一条能用的加载结果 —— 宿主那边 ok 与 diagnostics 是同一个判断。
  const 好用 = 诊断.errors.length === 0;
  return { ok: 好用, order, modules, diagnostics: 诊断 };
}

export function runUnit(unit, options = {}) {
  const rt = new Runtime(options);
  for (const key of unit.order) rt.registerModule(unit.modules.get(key));
  return rt;
}

export function describeUnit(unit) {
  return unit.order.map((k, i) => (i + 1) + ". " + k).join("  ");
}
