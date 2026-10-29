// loadUnit 的自举替身（2026-11-01）。
//
// 顺序取自 self/ 的 加载顺序公开 —— 那一条与宿主的 order 已经对齐过（selfmod 那套
// 量具比的是 order 逐项相同），所以顺序这一层不必再证。
// 语法树仍由宿主的 subset-parse 建：自举层只交回「顺序」，树由宿主自己解析，
// 形状才自动一致（design/FULLSELF.txt 第五节）。
//
// 它需要一台 C 机器：自举层的词法器在最小求值器上跑不动真文件（每个 token 一层
// 递归，而那边只有五百层），所以走字节码。机器路径由 HMYR_C_VM 给出；
// 没有它的时候这一层只交回 order，不交回 ast —— 那仍然够 FULLSELF 那 115 个
// 「只要顺序」的调用方用。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Diagnostics } from "./lexer.mjs";
import { 切 } from "./subset-lex.mjs";
import { 子集解 } from "./subset-parse.mjs";
import { 展开模块 } from "./expand.mjs";
import { 区检查 } from "./zone-check.mjs";
import { 实时检查 } from "./realtime-check.mjs";
import { 持有格检查 } from "./owned-check.mjs";
import { 本机能力 } from "./capabilities.mjs";
// 包名与包清单从 loader.mjs 借同一份实现 —— 复制一份就等于两份知识，而两份知识
// 迟早会分叉。循环 import 在这里是安全的：那边 import 的是这一层的 loadUnitSelf
// （函数声明，提升），这里 import 的也是函数声明，两边都只在调用时求值。
import { resolveImport, 找包根, 读包清单 } from "./loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 适配源 = path.join(ROOT, "self", "adapter.hmoca");
const 缓存目录 = process.env.HMYR_CACHE || path.join(ROOT, ".cache");

// 适配层的字节码是「adapter.hmoca 加它 import 的整条链」合并出来的，所以判断
// 「还能不能用」必须看整条链的最新修改时间，不能只看 adapter.hmoca 一个。
//
// 为什么（2026-11-01）：原来只比较 adapter.hmoca，于是改了 self/run.hmoca 与
// self/lex.hmoca 之后字节码从不重编 —— 一整轮实验都跑在旧码上，读数全是假的。
// 这里用「整个 self/ 目录里最晚的 .hmoca」当判据：链的成员随时会变，
// 而多编一次的代价只有一秒，比读到一份假读数便宜得多。
function 链最新() {
  let 新 = 0;
  try {
    const 目录 = path.join(ROOT, "self");
    for (const 名 of fs.readdirSync(目录)) {
      if (!名.endsWith(".hmoca")) continue;
      const m = fs.statSync(path.join(目录, 名)).mtimeMs;
      if (m > 新) 新 = m;
    }
  } catch {
    /* 目录读不出来就当作没有更新，走下面那条「不重编」的路。 */
  }
  return 新;
}

function 编适配层() {
  const 码 = path.join(缓存目录, "adapter-self.hmoks");
  try {
    if (fs.existsSync(码) && fs.statSync(码).mtimeMs >= 链最新()) return 码;
  } catch {
    /* 缓存目录不存在或读不到 —— 往下走，去编一份。 */
  }
  try {
    fs.mkdirSync(缓存目录, { recursive: true });
  } catch {
    return null;
  }
  if (process.env.HMYR_SELF_TRACE) console.error("[self] 编适配层 → " + 码);
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "emit-code.mjs"), 适配源, 码], {
    encoding: "utf8",
    // 没有超时的时候，一次坏掉的编译可以把整个套件挂住（2026-11-01 实测：三十分钟无输出）。
    timeout: 120000,
  });
  return r.status === 0 && fs.existsSync(码) ? 码 : null;
}

// 缓存：同一个入口文件、同一个 mtime，它的 order 不会变 —— 而 check-all 里每个套件
// 都是一个独立进程，所以进程内的 Map 没有用，要落到磁盘上（2026-11-01）。
// 键里带 mtime：文件一改就是新键，旧的留着无害。
//
// 键里还要带适配层字节码的 mtime（2026-11-01 深夜补）。为什么：order 是那段字节码
// 算出来的，而它的语义会变 —— 把 加载走 从先序改成后序那次，缓存里的旧 order 就
// 一直是先序的，于是 loadUnitSelf 交出 [stmt, chain, lex]，而 selfmod 那八项
// 却全过（它直接跑自举层，不过这层缓存）。症状是「改了源码没效果」的另一种写法：
// 缓存的语义来自它的生产者，生产者变了，缓存就得跟着失效。
function 缓存路(绝对) {
  let stamp = 0;
  try {
    stamp = Math.floor(fs.statSync(绝对).mtimeMs);
  } catch {
    stamp = 0;
  }
  let 产者 = 0;
  try {
    产者 = Math.floor(fs.statSync(path.join(缓存目录, "adapter-self.hmoks")).mtimeMs);
  } catch {
    产者 = 0;
  }
  const 名 = createHash("sha1").update(绝对 + ":" + stamp + ":" + 产者).digest("hex").slice(0, 16);
  return path.join(缓存目录, "loader-self", 名 + ".json");
}

// 自举层交回的 order：一个路径一行。它的 拼路径 不做归一（会留下 /a/../b 这种），
// 所以这里补一次 path.resolve —— 那是这一层唯一要替它做的事。
// 子进程的环境：别把 HMYR_LOADER 传下去。
//
// 为什么（2026-11-01）：那个开关会传染 —— 子进程也会用自举加载器，而每用一次
// 又起一个 C 机器。量起点数那一次就是这样把机器推到五百个 node 进程的。
// 步限也给足：默认的五百万步对 self/ 下几百行的文件不够。
function 子环境() {
  const 环境 = { ...process.env, HMYR_STEPS: "200000000" };
  delete 环境.HMYR_LOADER;
  return 环境;
}

function 取顺序(机器, 码, 目录, 相对, 绝对) {
  const 存 = 缓存路(绝对);
  try {
    const 旧 = JSON.parse(fs.readFileSync(存, "utf8"));
    if (Array.isArray(旧) && 旧.length) return { order: 旧.map((s) => path.resolve(s)) };
  } catch {
    /* 没有缓存或读坏了 —— 往下走，去问自举层。 */
  }
  if (process.env.HMYR_SELF_TRACE) console.error("[self] 取顺序 → " + 绝对);
  const r = spawnSync(机器, [码, 目录, 相对], {
    encoding: "utf8",
    // 步限提到启动器主路径那一档：默认的五百万步对 self/ 下几百行的文件不够，
    // 症状是 HMYR-R0102 the program ran for too long（2026-11-01 实测）。
    env: 子环境(),
    // 同上：一次运行没有上限，就是一颗能挂住整个套件的钉子。
    timeout: 120000,
  });
  if (r.status !== 0) {
    return { 错: String(r.stderr || r.stdout || "").trim() || "适配层退出码 " + r.status };
  }
  const 行们 = String(r.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (行们.length === 1 && 行们[0].startsWith("错 ")) return { 错: 行们[0].slice(2) };
  const order = 行们.map((s) => path.resolve(s));
  try {
    fs.mkdirSync(path.dirname(存), { recursive: true });
    fs.writeFileSync(存, JSON.stringify(order), "utf8");
  } catch {
    /* 缓存写不进去不影响这一次的结果。 */
  }
  return { order };
}

/**
 * 与 src/loader.mjs 的 loadUnit 同形状：{ ok, order, modules, 别名表, diagnostics }。
 *
 * 差别写在这里：别名表 这一层不产出（那是包清单的事，还没搬）；没有 C 机器时
 * modules 是空 Map，而 order 仍然是对的。
 */
export function loadUnitSelf(entry, options = {}) {
  const diagnostics = options.diagnostics || new Diagnostics();
  const 机器 = options.机器 || process.env.HMYR_C_VM || "";
  const 绝对 = path.resolve(entry);
  if (!fs.existsSync(绝对)) {
    diagnostics.error("E0302", "cannot read " + 绝对);
    return { ok: false, order: [], modules: new Map(), 别名表: new Map(), diagnostics };
  }

  const 目录 = path.dirname(绝对);
  const 相对 = "./" + path.basename(绝对);
  const 码 = 机器 ? 编适配层() : null;
  if (!机器 || !码) {
    diagnostics.error("E0303", "自举侧的适配层需要一台 C 机器（HMYR_C_VM 未给出）");
    return { ok: false, order: [], modules: new Map(), 别名表: new Map(), diagnostics };
  }

  const 结果 = 取顺序(机器, 码, 目录, 相对, 绝对);
  if (结果.错) {
    /* 自举层交回的错码是 E0301（环）与 E0302（缺文件），与本仓库宿主那一侧同码。 */
    const 码名 = 结果.错.slice(0, 5);
    diagnostics.error(码名 === "E0301" ? "E0301" : "E0302", 结果.错);
    return { ok: false, order: [], modules: new Map(), 别名表: new Map(), diagnostics };
  }

  // 树照宿主那条路建，而且调用方给了解析器就听它的（2026-11-01 深夜两处补齐）。
  //
  // 一、为什么必须与 src/loader.mjs 的 reader 一模一样：树是 loader 交出去的东西里
  //     唯一会被 runUnit 拿去装满一个运行环境的那一件。原来这里用完整词法器的 lex，
  //     宿主用子集那层的 切 —— 形状不同，于是 self/eval.hmoca 的 modules 明明有一项、
  //     ok 也是 true，runUnit 却装出零个函数（探针五：宿主五十七个、自举零个，
  //     两档的 order 与 modules 计数都相同）。宏展开也一样：宿主展开，这里不展开。
  //
  // 二、为什么 options.reader 要透传：宿主那一层允许调用方换掉「怎么把源码变成树」，
  //     而这一层原来把这个选择吞掉了。三条套件（minimal-eval、stage0-eval、
  //     subset-load）正是靠它递进宿主的完整解析器 —— 它们自己的用例里有子集不认的
  //     写法（match），于是吞掉 reader 的后果是「子集不含 match」当场抛出去。
  const modules = new Map();
  const 默认读 = (源) => {
    const 解 = 子集解(切(源));
    for (const d of 解.diagnostics.items) diagnostics.add(d.severity, d.code, d.message, d.line, d.column);
    let ast = 解.ast;
    try {
      ast = 展开模块(解.ast);
    } catch (e) {
      diagnostics.error("HMYR-E0103", String(e.message).replace(/^HMYR-E0103\s*/, ""), 0, 0);
    }
    return { ...解, ast };
  };
  const reader = options.reader || 默认读;
  const 是路径形式 = (s) =>
    typeof s === "string" && (s.startsWith("./") || s.startsWith("../") || s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s));
  // 包名补件（2026-11-02）：自举层的 加载走 把非路径形式的 import 当成「不是文件」
  // 跳过（那段注释写着「报 E0302 会把包当成缺文件」），于是 order 里从来没有包名那一支。
  // 而 pkg-manifest 与 owned-check 剩下的判据全在那一支上。
  //
  // 这里补：用宿主那份 resolveImport 解析成 包根/名/index.hmoca，读清单时那些
  // E0304 到 E0307 的诊断由同一份实现给出。
  //
  // 这一补是过渡，不是终点：包名解析本该住在 self/run.hmoca 的 加载走 里 ——
  // 「关于 HMYR 的知识归 HMYR」。眼下先在适配层，理由是自举层要重写一遍得连
  // JSON 解析一起搬，那是另一段工程（design/FULLSELF.txt 第五节记着这笔账）。
  // 顺序上有一处仍是临时形状：包里的入口排在被它引用的那一份之后，而后序要求
  // 相反；今天没有判据测这个次序，所以先留着，跟着那条待办一起搬。
  const 能力 = 本机能力();
  const order = [];
  const 已见 = new Set();
  const 队列 = [...结果.order];
  while (队列.length) {
    const abs = 队列.shift();
    if (已见.has(abs)) continue;
    已见.add(abs);
    let 源 = "";
    try {
      源 = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const ast = reader(源, abs).ast;
    // 区与实时那两条编译期检查：宿主在 visit 里做（src/loader.mjs 第 282 与 291 行），
    // 而这一层原来没做 —— 于是换掉 loader 之后那些诊断就没人报了。
    //
    // 症状（2026-11-01 实测）：zone-static 两条判据要的是「装载应当失败，诊断里应当有
    // R0301」，拿到的却是 ok:true 与一个空数组。而 zone-static 在宿主档下四十三项全过、
    // 在自举档下四十一项 —— 差的正是这两条。
    //
    // 持有格检查（owned-check）不在这里：它要两张跨模块的表，是装载的第二趟，
    // 照抄过来得连那两张表一起搬，那是另一件事。
    if (options.zoneCheck !== false) {
      for (const d of 区检查(ast, { 文件: path.basename(abs) })) {
        if (d.severity === "error") diagnostics.error(d.code, d.message, d.line, d.column);
        else diagnostics.warn(d.code, d.message, d.line, d.column);
      }
    }
    if (options.realtimeCheck !== false) {
      for (const d of 实时检查(ast, { 文件: path.basename(abs) })) {
        diagnostics.error(d.code, d.message, d.line, d.column);
      }
    }
    modules.set(abs, ast);
    order.push(abs);
    // 清单的版本与入口顶部的 rev 必须一致（宿主第 325 到 340 行，design/PKGMAN.txt 第二节）。
    // 两处写同一件事看着冗余，但它们的读者不同：清单给包管理看，rev 给装载器看。
    // 只对「某个包的 index.hmoca」做这一条 —— 别的文件没有清单可对。
    if (path.basename(abs) === "index.hmoca") {
      const 包目录 = path.dirname(abs);
      const 包根 = 找包根(能力, abs);
      // 先问一句「这真的是某个包的入口吗」：判据是它旁边有没有 hmyr.hmkit。
      // 为什么（2026-11-02 实测）：套件写的临时文件往往就叫 index.hmoca，而没有清单 ——
      // 少了这一句，检查会对着一个临时文件报 E0304，c-vm 那套当场变红（它不检查 ok）。
      const 清单路 = path.join(包根, path.basename(包目录), "hmyr.hmkit");
      if (fs.existsSync(清单路)) {
        const 清单 = 读包清单(能力, 包根, path.basename(包目录), diagnostics);
        if (清单 && Number.isInteger(清单.版本) && ast.rev !== null && ast.rev !== undefined && ast.rev !== 清单.版本) {
          diagnostics.error(
            "HMYR-E0304",
            "package '" + path.basename(包目录) + "' declares 版本 " + 清单.版本 + " but its index.hmoca says rev " + ast.rev +
              "; the two places that name a revision have to agree",
            0,
            0,
          );
        }
      }
    }
    // 包名那一支：解析出来排到队头，让它先于后面那些被处理（尽量靠前，见上面那条
    // 关于顺序的说明）。解析失败（不是「像名字」的形状）就交给包管理器，这里不管。
    for (const imp of ast.imports || []) {
      if (!imp || 是路径形式(imp.path)) continue;
      const 目标 = resolveImport(能力, abs, imp.path, diagnostics);
      if (目标 && !已见.has(目标) && fs.existsSync(目标)) 队列.unshift(目标);
    }
  }

  // 第二趟：别名、共享名字。宿主在 visit 与 return 之间做这两件
  // （src/loader.mjs 第 305 行与第 366 行），而适配层原来一件都没做。
  //
  // 症状（2026-11-01 实测）：namespace 那五条判据全部报 HMYR-R0104「没有这个名字」——
  // 因为 命名空间::名字 这种写法要靠别名表才认得出，而交回的是一个空 Map；
  // 而 self-chain2 要的 HMYR-W0302（两个模块声明同一个名字）从来没出现过。
  const 别名表 = new Map();
  for (const abs of order) {
    const ast = modules.get(abs);
    if (!ast) continue;
    for (const imp of ast.imports || []) {
      if (!imp) continue;
      // 包名也要走同一套：别名、版本协商都与路径形式一样，只是「解析成哪个文件」
      // 这一步交给 resolveImport（它懂包根与清单）。诊断传 null —— 清单那半边在
      // 第一趟已经报过了，这里只需要路径。
      const 目标 = 是路径形式(imp.path)
        ? path.resolve(path.dirname(abs), imp.path)
        : resolveImport(能力, abs, imp.path, null);
      if (!目标) continue;
      if (imp.alias) 别名表.set(imp.alias, 目标);
      // 版本协商：调用方要第 M 版，模块提供到第 N 版，M <= N 就成 ——
      // 模块向下兼容，所以「N 能提供 M」这一条是可判的（宿主第 313 到 317 行同样的判断）。
      const 被引 = modules.get(目标);
      if (
        被引 && 被引.rev !== null && 被引.rev !== undefined &&
        imp.rev !== null && imp.rev !== undefined && imp.rev > 被引.rev
      ) {
        diagnostics.error(
          "HMYR-E0303",
          "module '" + imp.path + "' offers revision " + 被引.rev + ", but the import asks for " + imp.rev +
            "; there is no version both sides support",
          imp.line || 0,
          imp.column || 0,
        );
      }
    }
  }
  // 函数表是扁平的，所以两个模块声明同一个名字就是一次静默覆盖 —— 说一声。
  const 已声明 = new Map();
  for (const abs of order) {
    const ast = modules.get(abs);
    if (!ast) continue;
    for (const decl of ast.decls || []) {
      if (decl.kind !== "Fn" && decl.kind !== "Const" && decl.kind !== "TypeAlias") continue;
      if (已声明.has(decl.name)) {
        diagnostics.warn(
          "HMYR-W0302",
          "two modules declare '" + decl.name + "' (" + path.basename(已声明.get(decl.name)) + " and " + path.basename(abs) +
            "); the later one wins until namespaces exist",
          0,
          0,
        );
      } else {
        已声明.set(decl.name, abs);
      }
    }
  }
  // 可见性的第一步（SPEC 6.4 第二步，宿主第 380 到 423 行）：非 pub 的声明被别的
  // 模块用到时说一声。它是提示不是拒绝 —— 函数表还是扁平的，那个名字照样调得到。
  //
  // 这一条在适配层原来完全没有，而 namespace 那两条判据要的正是它（报 W0303，
  // 并且那句话里要出现两个文件名）。只把「调用」算作引用：局部变量与参数不是
  // 对全局声明的引用，把它们算进去会盘出一半误报（宿主那一版踩过这个坑）。
  {
    const 非公开 = new Map();
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      for (const decl of ast.decls || []) {
        if (decl.kind !== "Fn" && decl.kind !== "Const" && decl.kind !== "TypeAlias") continue;
        if (decl.pub) continue;
        非公开.set(decl.name, abs);
      }
    }
    const 走 = (n, 报) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        for (const x of n) 走(x, 报);
        return;
      }
      if (n.kind === "Ident") return;
      if (n.kind === "Call" && n.callee && n.callee.kind === "Ident") 报(n);
      for (const [k, v] of Object.entries(n)) {
        if (k === "line" || k === "column" || k === "kind") continue;
        走(v, 报);
      }
    };
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      走(ast, (n) => {
        const 家 = 非公开.get(n.callee.name);
        if (家 && 家 !== abs) {
          diagnostics.warn(
            "HMYR-W0303",
            "'" + n.callee.name + "' is declared in " + path.basename(家) + " without pub, and it is called in " +
              path.basename(abs) + "; the flat table still lets it through, so this is a notice rather than a refusal",
            n.line || 0,
            n.column || 0,
          );
        }
      });
    }
  }
  // 持有格检查（design/MEMORY.txt 那条硬规则，宿主第 345 与 355 行）：它要两张跨模块的
  // 表，所以是两趟 —— 先把每个模块的签名收集起来，再回来报错。一趟报不了，因为
  // 「被调者可能先在别的模块里装载过」这件事只有收齐了才知道。
  const 跨模块 = { 签名: new Map(), 脏: new Map() };
  if (options.ownedCheck !== false) {
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      持有格检查(ast, { 文件: path.basename(abs), 外部: 跨模块, 只收集: true });
    }
    for (const abs of order) {
      const ast = modules.get(abs);
      if (!ast) continue;
      for (const d of 持有格检查(ast, { 文件: path.basename(abs), 外部: 跨模块 })) {
        diagnostics.error(d.code, d.message, d.line, d.column);
      }
    }
  }

  return { ok: diagnostics.errors.length === 0, order, modules, 别名表, diagnostics };
}
