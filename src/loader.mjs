// 模块系统的第一步：加载。
//
// 规格 6.4 把它排在这里，理由是自举一「把几块拼起来」就撞上了它：两个文件里同名函数互相覆盖，
// 而函数表是扁平的。第一步只做三件事，做完就能让加载有确定性：
//
//   ・import 真的加载本地文件（路径形式；包名留给包管理器那一步）
//   ・**只加载一次**：同一个文件被两处 import，只跑一遍
//   ・**循环引用被拒**：HMYR-E0301
//
// 它**不做**的事情写在明处：没有命名空间。所以扁平函数表下，两个模块声明同名函数时会互相覆盖——
// 这一步的处理是**把这件事说出来**（HMYR-W0302），而不是让它静默发生。可见性与命名空间是第二步。
import { Diagnostics } from "./diagnostics.mjs";
import { Runtime } from "./eval.mjs";
import { 本机能力 } from "./capabilities.mjs";
import { 切 } from "./subset-lex.mjs";
import { 子集解 } from "./subset-parse.mjs";
import { 展开模块 } from "./expand.mjs";
import { 区检查 } from "./zone-check.mjs";

const short = (file) => file.split(/[\\/]/).pop() || file;

/** 只处理路径形式的 import；包名留给包管理器。 */
function resolveImport(cap, fromFile, spec) {
  if (spec.startsWith("./") || spec.startsWith("../") || /^[A-Za-z]:[\\/]/.test(spec) || cap.path.isAbsolute(spec)) {
    return cap.path.resolve(cap.path.dirname(fromFile), spec);
  }
  return null;
}

/**
 * Load a file and everything it imports, in dependency order.
 * Returns { ok, order, modules, diagnostics }.
 */
export function loadUnit(entry, options = {}) {
  const diagnostics = options.diagnostics || new Diagnostics();
  // 加载器也借世界：它读文件、拼路径。于是它也拿一份能力，而不是自己去 import fs。
  // 默认给本机那一份；换掉它就能让「加载一份工程」这件事发生在没有文件系统的地方。
  const cap = options.capabilities || 本机能力();
  const modules = new Map();     // absolute path -> ast
  const loading = new Set();     // the chain currently being loaded, for cycle detection
  const order = [];
  // 「怎么把一段源码变成一棵树」现在是子集那两层（src/subset-lex.mjs + src/subset-parse.mjs），
  // 于是 Stage 0 这条路上没有宿主的 lexer 与 parser 了。
  //
  // 换过去的依据不是「它看起来行」：六份 token 逐个相同、六份的树逐节点相同（含位置）、
  // 八种语法错同一个码同一个位置，以及仓库里 37 份 .hmyr 全部读得进。
  //
  // 子集那一层是「认得窄而说清」：宿主读得动、而它还不认的构造会抛，不是静默地读错。
  // 于是这里不接住它——一个 loader 把「我不认」讲成别的东西，比它直接抛更糟。
  const reader = options.reader || ((source) => {
    const 解 = 子集解(切(source));
    // 子集那一层的诊断要并进调用方拿到的那一份，不然「读进来了但有抱怨」会被吞掉。
    for (const d of 解.diagnostics.items) diagnostics.add(d.severity, d.code, d.message, d.line, d.column);
    // 宏在这里展开：加载一次就展开一次，下游（求值器与字节码那台）看到的是同一棵没有宏的树。
    // 展开期的错记成语法那类 —— 它与「这段源码的形状不对」是同一件事。
    let ast = 解.ast;
    try {
      ast = 展开模块(解.ast);
    } catch (e) {
      diagnostics.error("HMYR-E0103", String(e.message).replace(/^HMYR-E0103\s*/, ""), 0, 0);
    }
    return { ...解, ast };
  });

  function visit(file) {
    const abs = cap.path.resolve(file);
    if (modules.has(abs)) return;                       // loaded once, and that is the only time
    if (loading.has(abs)) {
      diagnostics.error("HMYR-E0301", "circular import: " + short(abs) + " is already being loaded", 0, 0);
      return;
    }
    if (!cap.file.exists(abs)) {
      diagnostics.error("HMYR-E0302", "imported file does not exist: " + abs, 0, 0);
      return;
    }
    loading.add(abs);
    const source = String(cap.file.read(abs));
    const { ast } = reader(source, abs);

    // 三区模型的编译期那一半（design/MEMORY.txt 第一条硬规则）：装载时走一遍树，
    // 把「逃逸」与「循环里建 arena」说出来。放在这一层是因为这里所有走 loader 的路
    // 都会经过 —— 主路径、--compile、以及每一套拿源码造工程的验收。
    //
    // 逃生口是 options.zoneCheck === false，而不是一条永远不触发的开关：
    // 一条误报会把整条路堵死，而堵死之后人会去改加载器，不会去改那条判据。
    if (options.zoneCheck !== false) {
      for (const d of 区检查(ast, { 文件: short(abs) })) {
        if (d.severity === "error") diagnostics.error(d.code, d.message, d.line, d.column);
        else diagnostics.warn(d.code, d.message, d.line, d.column);
      }
    }

    for (const imp of ast.imports) {
      const target = resolveImport(cap, abs, imp.path);
      if (!target) {
        diagnostics.warn("HMYR-W0301", "import of '" + imp.path + "' is not a path; the package manager will own that", 0, 0);
        continue;
      }
      visit(target);
      // 版本协商：调用方要第 M 版，模块提供到第 N 版，M <= N 就成 ——
      // 模块向下兼容，所以「N 能提供 M」这一条是可判的。
      //
      // 这条规矩出自 design/RELAY.txt 那句中继站的 A2：取双方都支持的最高版本，
      // 没有交集就拒绝。这门语言没有范围语法，所以「交集」就是 M <= N 这一个比较。
      // 不写 rev 的那一边不提要求 —— 老代码一行都不用改，这一点是故意的。
      const 目标 = modules.get(target);
      if (目标 && 目标.rev !== null && 目标.rev !== undefined &&
          imp.rev !== null && imp.rev !== undefined && imp.rev > 目标.rev) {
        diagnostics.error("HMYR-E0303",
          "module '" + imp.path + "' offers revision " + 目标.rev + ", but the import asks for " + imp.rev +
          "; there is no version both sides support", imp.line || 0, imp.column || 0);
      }
    }

    loading.delete(abs);
    modules.set(abs, ast);
    order.push(abs);
  }

  visit(entry);

  // The flat function table means a shared name is a silent overwrite. Say it out loud instead.
  const declared = new Map();
  for (const file of order) {
    for (const decl of modules.get(file).decls) {
      if (decl.kind !== "Fn" && decl.kind !== "Const" && decl.kind !== "TypeAlias") continue;
      if (declared.has(decl.name)) {
        diagnostics.warn("HMYR-W0302",
          "two modules declare '" + decl.name + "' (" + short(declared.get(decl.name)) + " and " + short(file) +
          "); the later one wins until namespaces exist", 0, 0);
      } else {
        declared.set(decl.name, file);
      }
    }
  }

  return { ok: diagnostics.errors.length === 0, order, modules, diagnostics };
}

/** Run every loaded module into one evaluator, in dependency order. */
export function runUnit(unit, options = {}) {
  const runtime = new Runtime(options);
  for (const file of unit.order) runtime.registerModule(unit.modules.get(file));
  return runtime;
}

/** A one-line summary, the way the CLI and the tests want it. */
export function describeUnit(unit) {
  return unit.order.map((f, i) => (i + 1) + ". " + short(f)).join("  ");
}
