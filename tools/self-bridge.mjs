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
import { 是码元序列, 成宿主 } from "../src/units.mjs";
import { 是源码 } from "./file-kind.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit as 宿主载, runUnit as 宿主跑 } from "../src/loader.mjs";
import { 逐模块检查, 全树检查 } from "../src/loader-checks.mjs";
import { 展开模块 } from "../src/expand.mjs";
import { resolveImport } from "../src/loader.mjs";
import { 找包根, 读包清单 } from "../src/loader.mjs";
import { Diagnostics } from "../src/diagnostics.mjs";
import { Runtime } from "../src/eval.mjs";
import { 读程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 源路 = path.join(ROOT, "self/run.hmoca");
const 字节路 = path.join(ROOT, "runtime/run.hmoks");

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

// 宏模板里的字面量补 value（只在桥这一层做，理由见模块循环里那段）。
const 补字面量 = (n) => {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) {
    for (const x of n) 补字面量(x);
    return;
  }
  if (n.kind === "Literal" && n.value === undefined && typeof n.text === "string") {
    if (n.type === "int") n.value = Number(n.text);
    else if (n.type === "string") n.value = n.text;
  }
  for (const [k, v] of Object.entries(n)) {
    if (k === "line" || k === "column" || k === "kind") continue;
    补字面量(v);
  }
};

// 桥自己的诊断袋。原来 error 与 warn 是空函数 —— 于是「第二趟的检查」报了等于没报：
// zonestatic、realtime、ownedcheck 三套的判据要的是「装载应当失败」，而它们拿到的
// 永远是 ok:true 与一个空数组（2026-11-02 实测）。现在按 Diagnostics 的形状收集。
const 新诊断 = () => {
  const 袋 = { errors: [], warnings: [], items: [] };
  袋.add = (severity, code, message, line, column) => {
    const 条 = { code, message, line: line || 0, column: column || 0 };
    if (severity === "error") 袋.errors.push(条);
    else 袋.warnings.push(条);
    袋.items.push(条);
  };
  袋.error = (code, message, line, column) => 袋.add("error", code, message, line, column);
  袋.warn = (code, message, line, column) => 袋.add("warn", code, message, line, column);
  return 袋;
};

// 两台执行器交回的记录长得不一样：解释器给普通对象与数组，字节码机给它自己的
// 类记录（fields 是一个 Map）与类元组（items）。宿主的 Runtime 只认前一种，
// 所以走字节码这条路时把形状翻一遍 —— 翻一次，量的是模块树，不随程序规模走。
const 深转 = (v) => {
  // 字符串默认住在码元序列里（00c0552 之后）。桥必须把它们折回宿主串 ——
  // 不折的话，宿主看到的 kind 是 {0:70,1:110}，而那个东西永远不等于 "Fn"，
  // 于是「函数名一模一样」拿到空列表、Runtime 在 params 上撞 undefined。
  // 这一条是 2026-10-26 才补的：字符串换底那次，这一层没跟上，
  // 而它一直藏在「产物旧 → 退回解释器」后面，直到产物被重新生成才露出来。
  if (是码元序列(v)) return 成宿主(v);
  // nil 在宿主那边是 {type:"nil", value:null}；这一侧没有 null，所以到 JS 这一层才补上。
  //
  // 比较的那一边要先折成宿主串：type 的值在字节码那台是码元序列，拿它去和 "nil"
  // 比永远不相等 —— 于是这个分支从来没进去过，nil 字面量走了下面那个通用 record 分支，
  // value 成了 []（空元组转成的数组）。而编译器按 {type:"nil", value:null} 编常量，
  // 拿到 [] 就编错：str(nil) 在桥那条路上给出空字符串的码元（长度 0），
  // 而宿主的树上给的是空括号的两个码元（长度 2）。2026-11-02 实测。
  const 若码元则折 = (x) => (是码元序列(x) ? 成宿主(x) : x);
  if (v && v.tag === "record" && v.fields && 若码元则折(v.fields.get("type")) === "nil") {
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
  // reader 是「换解析器」的钩子，而桥的解析固定在自举层那一份 —— 它认不得的语法
  // （比如 match）会直接变成「没有这个名字」。这种场景下让给宿主 loader：
  // 桥要换的是「装载与求值由谁做」，不是「解析器能不能被换掉」（2026-11-02：
  // stage0eval 那套就是用 reader 喂一份含 match 的源码，而桥这边报 R0104）。
  if (options && typeof options.reader === "function") return 宿主载(entry, options);
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
    // 宏在装载时展开一次，下游（宿主 Runtime、最小求值器、字节码那台）看到的是
    // 同一棵没有宏的树。宿主那一路把它放在 reader 里（src/loader.mjs 第 244 行），
    // 而桥的树是自举层造的，没人做过这一遍 —— 于是 macro 那套在桥这条路上
    // 「没有这个名字 两次」（2026-11-02）。
    // 参数的 passing 也要折：自举层没有 null，没有前缀时给的是空元组，深转之后
    // 成了空数组 —— 而空数组是真值，宿主那边是 null。求值器里凡按「有没有 passing」
    // 判的地方，在这条路上都会走错分支（2026-11-02：macro 那套「模板里带一次真调用」
    // 报 HMYR-R0130 expected a number, found undefined，而两边的树形状是一样的）。
    for (const decl of m.decls || []) {
      for (const p of decl.params || []) {
        if (Array.isArray(p.passing) && p.passing.length === 0) p.passing = null;
      }
    }
    let 模 = m;
    try {
      模 = 展开模块(m);
    } catch (e) {
      诊断.error("HMYR-形-006", String(e.message).replace(/^HMYR-形-006\s*/, ""), 0, 0);
      模 = m;
    }
    // 宏模板里的字面量没有 value：模板是 self/chain.hmoca 的 atom 解析的，而那里只给
    // text 与 raw（普通函数体走 run.hmoca 的 翻表达式，那一份有 value）。宿主求值器读
    // Literal 时读 value，缺了它就是 undefined，于是「模板里带一次真调用」报
    // HMYR-R0130（2026-11-02 实测）。
    //
    // 补在这一层而不是自举层：这是桥的形状转换处，与 pub 的 1/0、passing 的空数组
    // 是同一类对齐 —— 而且试过改 self/chain.hmoca，两次都弄坏了别的套件。
    // 展开之后补：展开会产出模板里的新字面量。
    补字面量(模);
    modules.set(键, 模);
    // 自举层交回的 pub 是 1 / 0（它那一侧没有 JS 的 true / false），而宿主的可见性检查
    // 是严格比较 true（src/eval.mjs 第 129 行）—— 不折的话，一个写了 pub 的跨模块调用
    // 照样被拒成 HMYR-R0250（2026-11-02 实测）。折一次，量与树同大，不随程序走。
    for (const decl of m.decls || []) {
      if (typeof decl.pub === "number") decl.pub = decl.pub !== 0;
    }
    // 区与实时那两条编译期检查：宿主在 visit 里做，桥这条路上原来一样也没有 ——
    // 于是 zonestatic / realtime 那两套的判据看到的是 ok:true（2026-11-02）。
    逐模块检查(m, path.basename(键), 诊断, options);
    // 同一个模块挂两个门牌：order 里用相对形式，而多数套件拿绝对路径来 get。
    // 但别名只挂在查询上，不进 Map 本身 —— 否则 modules.size 会翻倍，
    // 而 bootstrap 那套正是拿 size 数「带进几份文件」。
    const 绝对键 = path.resolve(键);
    if (绝对键 !== 键) 别名.set(绝对键, m);
    order.push(键);
  });
  // 重名声明（W0302）与可见性（W0303）、持有格的两趟，都搬到 src/loader-checks.mjs 了：
  // 这里原来还有一份自己的版本，于是同一个文件被报两次「两个模块声明了同一个名字」。
  // 两条 loader 要做的第二趟一模一样，抄第二份就是让两份知识分叉。
  // 「写了 rev 但没有数字」是一条语法错，不是「不提要求」。
  for (const 键 of order) {
    for (const d of Array.from(modules.get(键).decls || [])) void d;
  }
  for (const 键 of order) {
    const 模块 = modules.get(键);
    if (模块.rev === -1) {
      const 条 = { code: "HMYR-載-023", message: "rev is not followed by a revision number", file: 键 };
      诊断.errors.push(条);
      诊断.items.push(条);
      模块.rev = null;
    }
    for (const imp of Array.from(模块.imports || [])) {
      if (imp && imp.rev === -1) {
        const 条 = { code: "HMYR-載-023", message: "rev is not followed by a revision number", file: 键 };
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
      // 目标要用 resolveImport 拿 —— 它懂包名（包根/名/index.hmoca），而在这里
      // 手工拼路径对包名会少拼一段：import "甲包" 拼成 ...\甲包，而模块表里那一项是
      // ...\甲包\index.hmoca，于是查不到、版本协商一条也不报（2026-11-02 实测：
      // 探针打出 目标键=无、有目标=false，而 order 里明明有 index.hmoca）。
      // 路径形式与包名都交给它，两边一条规矩。
      const 目标路 = resolveImport(本机能力(), 键, p, null);
      if (!目标路) continue;
      const 目标键 = order.find((k) => path.resolve(k) === 目标路);
      const 目标 = 目标键 ? modules.get(目标键) : undefined;
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
  // 顺便记下「哪些文件是靠包名进来的」：清单检查只该对它们做（见下面那段）。
  const 包名目标 = new Set();
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
        const 解 = resolveImport(本机能力(), 键, p, null);
        if (解) 包名目标.add(path.resolve(解));
      }
    }
  }
  // 第二趟：共享名字、可见性、持有格。与 src/loader-self.mjs 用的是同一份实现
  // （src/loader-checks.mjs）—— 两条路要做的第二趟一模一样，抄第二份就是让知识分叉。
  全树检查(modules, order, 诊断, options);

  // 别名表与包清单：这两件与「import 说明怎么解析成一个文件」有关，所以留在各层。
  // 桥这边的解析在 HMYR 里，而清单校验是宿主的那一份 —— 借它跑一遍，形状不同不影响
  // 「这棵树能不能用」，只影响诊断。
  const 别名表 = new Map();
  {
    const 能力 = 本机能力();
    for (const 键 of order) {
      const ast = modules.get(键);
      if (!ast) continue;
      for (const imp of Array.from(ast.imports || [])) {
        const p = String((imp && imp.path) || "");
        if (!p) continue;
        const 目标 = resolveImport(能力, 键, p, 诊断);
        if (!目标) continue;
        if (imp.alias) {
          // 别名的值必须是 order 里那个键**本身**：Runtime.模块声明 的键就是它，
          // 而 模块成员 拿别名去查那张表。自己拼一个「差不多」的相对路径不行 ——
          // 临时目录里的文件会拼成 ../.. 形式，与键差一点点就查不到（2026-11-02）。
          const 真 = path.resolve(目标);
          const 对应 = order.find((k) => path.resolve(k) === 真);
          别名表.set(imp.alias, 对应 || 目标);
        }
      }
    }
  }

  // 清单的版本与入口顶部的 rev 必须一致（宿主 src/loader.mjs 第 325 到 340 行）。
  // 两处写同一件事看着冗余，但它们的读者不同：清单给包管理看，rev 给装载器看。
  // 只对「靠包名 import 进来的入口」做 —— 宿主那一路也是这样，清单校验挂在
  // resolveImport 的包名分支里。
  {
    const 能力 = 本机能力();
    for (const 键 of order) {
      if (path.basename(键) !== "index.hmoca") continue;
      // 只查「靠包名 import 进来的入口」—— 宿主那一路也是这样：清单校验挂在
      // resolveImport 的包名分支里。原来对每个 index.hmoca 都查，于是
      // ownedcheck 那条「包名版本 → E0303」拿到的是清单的 E0304（2026-11-02）。
      if (!包名目标.has(path.resolve(键))) continue;
      const 包目录 = path.dirname(键);
      // 用绝对路径找包根：order 的键是相对仓库的，而 找包根 要一层层往上问
      // hmyr.hmkit 在不在 —— 从相对路径出发会问错地方，从而把一个合规的包
      // 判成「没有清单」（E0304）。这是桥报 E0304 而判据要 E0303 的原因
      // （2026-11-02）。
      const 包根 = 找包根(能力, path.resolve(键));
      const 清单路 = path.join(包根, path.basename(包目录), "hmyr.hmkit");
      if (!fs.existsSync(清单路)) continue;
      const 清单 = 读包清单(能力, 包根, path.basename(包目录), 诊断);
      const ast = modules.get(键);
      if (清单 && Number.isInteger(清单.版本) && ast && ast.rev !== null && ast.rev !== undefined && ast.rev !== 清单.版本) {
        诊断.error(
          "HMYR-E0304",
          "package '" + path.basename(包目录) + "' declares 版本 " + 清单.版本 + " but its index.hmoca says rev " + ast.rev +
            "; the two places that name a revision have to agree",
          0,
          0,
        );
      }
    }
  }

  // 有错就不是一条能用的加载结果 —— 宿主那边 ok 与 diagnostics 是同一个判断。
  const 好用 = 诊断.errors.length === 0;
  return { ok: 好用, order, modules, 别名表, diagnostics: 诊断 };
}

export function runUnit(unit, options = {}) {
  const rt = new Runtime(options);
  // 第二个参数是「这个声明属于哪个文件」—— 归属表靠它填，而「招牌来自哪个文件」
  // 与「跨模块可见性」两条判据问的都是它。不传的话归属者是 null（2026-11-02 实测）。
  for (const key of unit.order) rt.registerModule(unit.modules.get(key), key);
  // 别名要登记进运行时，否则 命名空间::名字 这种写法全报「没有这个名字」——
  // 宿主 loader 的 runUnit 也做这一件（src/loader.mjs 第 435 行）。
  for (const [名, 文件] of unit.别名表 || []) rt.登记别名(名, 文件);
  return rt;
}

export function describeUnit(unit) {
  return unit.order.map((k, i) => (i + 1) + ". " + k).join("  ");
}
