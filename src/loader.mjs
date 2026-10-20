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
import fs from "node:fs";
import path from "node:path";
import { lex, Diagnostics } from "./lexer.mjs";
import { parse } from "./parser.mjs";
import { Runtime } from "./eval.mjs";

const short = (file) => path.basename(file);

/** 只处理路径形式的 import；包名留给包管理器。 */
function resolveImport(fromFile, spec) {
  if (spec.startsWith("./") || spec.startsWith("../") || /^[A-Za-z]:[\\/]/.test(spec) || path.isAbsolute(spec)) {
    return path.resolve(path.dirname(fromFile), spec);
  }
  return null;
}

/**
 * Load a file and everything it imports, in dependency order.
 * Returns { ok, order, modules, diagnostics }.
 */
export function loadUnit(entry, options = {}) {
  const diagnostics = options.diagnostics || new Diagnostics();
  const modules = new Map();     // absolute path -> ast
  const loading = new Set();     // the chain currently being loaded, for cycle detection
  const order = [];
  // 「怎么把一段源码变成一棵树」是一个可以换的东西，而不是这里写死的一步。
  // 默认还是宿主那两层；换掉它的是子集那两层（src/subset-lex.mjs + src/subset-parse.mjs），
  // 而换的理由只有一个：证明子集那一份真能顶替这两层，而不是只在套件里对得上。
  // 换掉时若那两层被一份源码难住，它会抛——子集的立场是报错而不是猜，于是这里不接住它。
  const reader = options.reader || ((source, abs) => {
    const lexed = lex(source, { path: abs });
    return parse(lexed.tokens, { diagnostics });
  });

  function visit(file) {
    const abs = path.resolve(file);
    if (modules.has(abs)) return;                       // loaded once, and that is the only time
    if (loading.has(abs)) {
      diagnostics.error("HMYR-E0301", "circular import: " + short(abs) + " is already being loaded", 0, 0);
      return;
    }
    if (!fs.existsSync(abs)) {
      diagnostics.error("HMYR-E0302", "imported file does not exist: " + abs, 0, 0);
      return;
    }
    loading.add(abs);
    const source = fs.readFileSync(abs, "utf8");
    const { ast } = reader(source, abs);

    for (const imp of ast.imports) {
      const target = resolveImport(abs, imp.path);
      if (!target) {
        diagnostics.warn("HMYR-W0301", "import of '" + imp.path + "' is not a path; the package manager will own that", 0, 0);
        continue;
      }
      visit(target);
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
