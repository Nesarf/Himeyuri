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
import { 实时检查 } from "./realtime-check.mjs";
import { 持有格检查 } from "./owned-check.mjs";

const short = (file) => file.split(/[\\/]/).pop() || file;

/**
 * 从某个文件往上找「包根」：最外层的那个含 hmyr.hmkit 的目录；找不到就用仓库根。
 *
 * 「最外层」这三个字是必要的，不是谨慎：每个包自己在 hmyr.hmkit 里说明身份
 * （design/PKGMAN.txt），所以「第一个含清单的目录」会是包自己 —— 于是
 * import "乙包" 会被解析成 甲包/乙包/index.hmoca。往上走到底、取最后遇到的那个，
 * 才是这个工程的外壳。
 */
function 找包根(cap, fromFile) {
  let 目录 = cap.path.dirname(fromFile);
  let 最后 = null;
  for (let i = 0; i < 64; i++) {
    if (cap.file.exists(cap.path.join(目录, "hmyr.hmkit"))) 最后 = 目录;
    const 上 = cap.path.dirname(目录);
    if (上 === 目录) break;
    目录 = 上;
  }
  return 最后 || cap.path.root();
}

/**
 * 读一个包的清单，并做「形状」那一半的校验（design/PKGMAN.txt 第三节）。
 *
 * 装载器不计算哈希 —— 那要一个密码学库，而它至今只借文件与路径两样能力。
 * 哈希由 tools/hmkit-check.mjs 算。这里只验：能读、四项齐、名字与目录一致、
 * 版本是整数、许可非空、哈希的形状对。
 */
function 读包清单(cap, 包根, 名, diagnostics) {
  const 路 = cap.path.join(包根, 名, "hmyr.hmkit");
  if (!cap.file.exists(路)) {
    diagnostics.error("HMYR-E0304", "package '" + 名 + "' has no hmyr.hmkit beside its index.hmoca", 0, 0);
    return null;
  }
  let 清单;
  try { 清单 = JSON.parse(String(cap.file.read(路))); }
  catch {
    diagnostics.error("HMYR-E0304", "package '" + 名 + "' has a manifest that is not JSON", 0, 0);
    return null;
  }
  if (!清单 || typeof 清单 !== "object" || Array.isArray(清单)) {
    diagnostics.error("HMYR-E0304", "package '" + 名 + "' has a manifest that is not an object", 0, 0);
    return null;
  }
  if (清单.名字 !== 名) {
    diagnostics.error("HMYR-E0304",
      "package '" + 名 + "' declares its name as '" + String(清单.名字) + "'; the directory and the manifest must agree, or 'which package did I import' becomes a guess", 0, 0);
  }
  if (!Number.isInteger(清单.版本)) {
    diagnostics.error("HMYR-E0304", "package '" + 名 + "' has no integer 版本 in its manifest", 0, 0);
  }
  if (typeof 清单.许可 !== "string" || 清单.许可.length === 0) {
    diagnostics.error("HMYR-E0304", "package '" + 名 + "' has no 许可 in its manifest", 0, 0);
  }
  if (typeof 清单.哈希 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(清单.哈希)) {
    diagnostics.error("HMYR-E0304", "package '" + 名 + "' has no sha256:<64 lowercase hex> 哈希 in its manifest", 0, 0);
  }
  return 清单;
}

/**
 * 把一个 import 说明解析成一个绝对路径。
 *
 * 两种形式：路径（相对、绝对、带盘符），与包名。
 * 包名的规则只有一句：是包根下面的一个目录，入口是那个目录里的 index.hmoca。
 * 一条规则、一个约定文件名 —— 因为它要在四台机器上给出同一个答案，
 * 而任何「按清单字段去猜」的写法都会把答案藏进解析顺序里。
 */
function resolveImport(cap, fromFile, spec, diagnostics) {
  if (spec.startsWith("./") || spec.startsWith("../") || /^[A-Za-z]:[\\/]/.test(spec) || cap.path.isAbsolute(spec)) {
    return cap.path.resolve(cap.path.dirname(fromFile), spec);
  }
  // 包名：只认「像名字」的形状，其余仍然交给包管理器（与以前一样）。
  // 允许非 ASCII —— 这门语言的标识符本来就能写中文，包名没有理由更窄。
  const 名 = spec.replace(/\/+$/, "");
  if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(名)) return null;
  const 包根 = 找包根(cap, fromFile);
  // 有诊断出口时顺手把清单读一遍 —— 那件事只有包名这一支需要。
  if (diagnostics) 读包清单(cap, 包根, 名, diagnostics);
  return cap.path.join(包根, 名, "index.hmoca");
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
  // 别名：`import "x" as y` 里的 y 指到哪个文件（SPEC 6.4 第二步的最后一步）。
  // 它是在解析 import 时顺手记下的 —— 那是唯一一个「说明文字与文件」同时在场的地方。
  const 别名表 = new Map();
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

  // 跨模块的借用分析要两张跨模块的表：被调者可能先在别的模块里装载过。
  // 它们按装载顺序累积 —— 所以「被调者先装载」时能看透，「后装载」时看不见。
  // 那是单趟遍历的局限，写在 design/MEMORY.txt 第 2 节，而不是假装它不存在。
  const 跨模块 = { 签名: new Map(), 脏: new Map() };

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

    // 实时档位那四条（design/MEMORY.txt 第 3 节）。开关与区检查分开：
    // 一条管「内存跑出区」，一条管「实时回调碰了会等的东西」—— 两件事关掉的理由不同。
    if (options.realtimeCheck !== false) {
      for (const d of 实时检查(ast, { 文件: short(abs) })) {
        diagnostics.error(d.code, d.message, d.line, d.column);
      }
    }

    for (const imp of ast.imports) {
      const target = resolveImport(cap, abs, imp.path, diagnostics);
      if (!target) {
        diagnostics.warn("HMYR-W0301", "import of '" + imp.path + "' is not a path; the package manager will own that", 0, 0);
        continue;
      }
      visit(target);
      // 别名：`import "x" as y` 的 y 现在指向一个真实的文件。
      // 记在这里，因为这是「说明文字」与「解析出来的文件」同时在场的唯一一处。
      if (imp.alias) 别名表.set(imp.alias, target);
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

    // 清单的版本与入口顶部的 rev 必须一致（design/PKGMAN.txt 第二节）。
    // 两处写同一件事看着冗余，但它们的读者不同：清单给包管理看，rev 给装载器看。
    // 让它们必须一致，是唯一能让两边都不说谎的办法。
    if (short(abs) === "index.hmoca") {
      const 目录 = cap.path.dirname(abs);
      const 清单路 = cap.path.join(目录, "hmyr.hmkit");
      if (cap.file.exists(清单路)) {
        let 清单 = null;
        try { 清单 = JSON.parse(String(cap.file.read(清单路))); } catch { 清单 = null; }
        if (清单 && Number.isInteger(清单.版本) && ast.rev !== null && ast.rev !== undefined && ast.rev !== 清单.版本) {
          diagnostics.error("HMYR-E0304",
            "package '" + short(目录) + "' declares 版本 " + 清单.版本 + " but its index.hmoca says rev " + ast.rev +
            "; the two readers must not disagree", 0, 0);
        }
      }
    }

    // owned 的第一趟：只收集签名与脏，不报。跨模块的借用分析要一张填满的表，
    // 而「填满」要等所有模块都装载完 —— 所以句子留到第二趟。
    if (options.ownedCheck !== false) {
      持有格检查(ast, { 文件: short(abs), 外部: 跨模块, 只收集: true });
    }
  }

  visit(entry);

  // owned 的第二趟（design/MEMORY.txt 第 2 节）：这时候表已经填满，
  // 所以「被调者在调用者之后装载」也看得见 —— 那个缺口就是这一趟补上的。
  // 它必须在 visit(entry) 之后：在那之前 order 还是空的，而空的 order 会让这一趟
  // 一条都不报，看上去像「检查没生效」。
  if (options.ownedCheck !== false) {
    for (const file of order) {
      const ast = modules.get(file);
      if (!ast) continue;
      for (const d of 持有格检查(ast, { 文件: short(file), 外部: 跨模块 })) {
        diagnostics.error(d.code, d.message, d.line, d.column);
      }
    }
  }

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

  // 可见性的第一步（SPEC 6.4 第二步）：非 pub 的声明被别的模块用到时，说一声。
  //
  // 它是提示，不是拒绝 —— 求值器的函数表还是扁平的，所以那个名字照样能调到。
  // 说一声的价值在于：等命名空间真的做了，这份清单就是「要改哪些地方」的名单，
  // 而不是到时候从零去查。
  //
  // pub 与 as 今天是同一档：都被记下来、都不影响能不能看见。两者的差别在代价上，
  // 而那一句写在 SPEC 6.4 里。
  {
    const 非公开 = new Map();     // 名字 -> 它所在的文件
    for (const file of order) {
      for (const decl of modules.get(file).decls) {
        if (decl.kind !== "Fn" && decl.kind !== "Const" && decl.kind !== "TypeAlias") continue;
        if (decl.pub) continue;
        非公开.set(decl.name, file);
      }
    }
    for (const file of order) {
      const 报引用 = (n) => {
        const 家 = 非公开.get(n.callee.name);
        if (家 && 家 !== file) {
          diagnostics.warn("HMYR-W0303",
            "'" + n.callee.name + "' is declared in " + short(家) + " without pub, and it is called in " + short(file) +
            "; the flat table still lets it through, so this is a notice rather than a refusal", n.line || 0, n.column || 0);
        }
      };
      const 走 = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { for (const x of n) 走(x); return; }
        // 只把「调用」算作引用。
        //
        // 第一版把所有 Ident 都算，于是局部变量与参数被当成了对同名全局声明的引用
        // （'行'、'列' 这种名字最容易撞），盘出来一半是误报。可见性这件事问的是
        // 「这个名字是从哪儿来的」，而局部变量从作用域来 —— 那要作用域分析，
        // 而调用点的 callee 不需要：`f(...)` 里的 f 只可能是函数。
        if (n.kind === "Ident") return;
        if (n.kind === "Call" && n.callee && n.callee.kind === "Ident") 报引用(n);
        for (const [k, v] of Object.entries(n)) {
          if (k === "line" || k === "column" || k === "kind") continue;
          走(v);
        }
      };
      走(modules.get(file));
    }
  }

  return { ok: diagnostics.errors.length === 0, order, modules, 别名表, diagnostics };
}

/** Run every loaded module into one evaluator, in dependency order. */
export function runUnit(unit, options = {}) {
  const runtime = new Runtime(options);
  for (const file of unit.order) runtime.registerModule(unit.modules.get(file), file);
  // 别名要在注册之后交过去：它查的是「这个名字来自哪个模块」，
  // 而那正是注册时填的那张表。
  for (const [名, 文件] of (unit.别名表 || [])) runtime.登记别名(名, 文件);
  return runtime;
}

/** A one-line summary, the way the CLI and the tests want it. */
export function describeUnit(unit) {
  return unit.order.map((f, i) => (i + 1) + ". " + short(f)).join("  ");
}
