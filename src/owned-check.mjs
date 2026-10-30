// owned 的单次使用检查：装载时把「一个持有格被放两次」或「被取两次」拦下来。
//
// 与 src/zone-check.mjs 同构，理由也同一条：能静态看的事情不该等到运行时。
// 而它比区那一条更窄 —— 这里做的是一份很小的状态追踪，不是借用分析：
//
//   一个变量在一个函数体的直行序列里，状态只有三种：空、满、说不清。
//   let X = owned()   空
//   X.放(v)           满（而若它已经是满的，就是错）
//   X.取()            空（而若它已经是空的，就是错）
//   别的用法           说不清 —— 之后不再对它下判断
//   if / while 的体里   一律不判，并把外面那些变量的状态改成说不清
//
// 「说不清」是关键：一份会误报的检查会被关掉，而关掉的检查等于没有。
// 所以只要有任何一条路径可能让状态变了而这里看不见，就退回「不判」。
//
// 现在的边界（写在这里，而不是留给读的人去撞）：
//   ・只认 let X = owned() 这一种来源；从参数、返回值、字段来的一律说不清
//   ・分支里的动作不追，只把状态降级
//   ・循环体一次也不追 —— 零次与多次都可能，两种都说不出结论

export const 检查码 = "HMYR-載-021";

import { 转移, 空, 满, 关, 移 } from "./owned-state.mjs";

const 是方法调用 = (n) =>
  n && n.kind === "调用" && n.callee && n.callee.kind === "Field" &&
  n.callee.target && n.callee.target.kind === "名";

/**
 * 一棵模块树里的 owned 单次使用检查。
 *
 * 交回 [{ severity, code, message, line, column }]，severity 一律 "error"。
 */
export function 持有格检查(ast, 选项 = {}) {
  const 出 = [];
  const 文件 = 选项.文件 || "";
  const 前缀 = 文件 ? 文件 + ": " : "";
  // 只收集：第一趟装载时用。那时跨模块的表还没填完，报了也不算数 ——
  // 所以这一档只走一遍树把签名与脏交出去，句子一条都不发。
  const 只收集 = 选项.只收集 === true;
  const 报 = (message, 节点) => {
    if (只收集) return;
    出.push({
      severity: "error", code: 检查码, message: 前缀 + message,
      line: (节点 && 节点.line) || 0, column: (节点 && 节点.column) || 0,
    });
  };
  if (!ast || !Array.isArray(ast.decls)) return 出;

  // 签名表：哪些函数把某个参数标成了 own。转移只对它们成立 ——
  // borrow 与普通参数的调用之后，源这边的格子仍然归自己，继续用是对的。
  //
  // 外面那张表（选项.外部）是跨模块用的：被调者可能在别的模块里先装载过。
  // 本模块的名字优先（扁平函数表里也是先到者赢），所以先写本模块、再补外面的。
  const 签名表 = new Map();
  for (const decl of ast.decls) {
    if (decl.kind === "Fn") 签名表.set(decl.name, decl.params || []);
  }
  const 外部 = 选项.外部;
  if (外部 && 外部.签名) {
    for (const [名, 参们] of 外部.签名) if (!签名表.has(名)) 签名表.set(名, 参们);
  }

  for (const decl of ast.decls) {
    if (decl.kind !== "Fn" || !decl.body) continue;
    走块(decl.body.statements || [], new Map(), 报, 签名表);
  }

  // 本模块的签名与脏要交给下一个模块 —— 那是「跨模块」这件事的全部内容。
  if (外部 && 外部.签名 && 外部.脏) {
    for (const decl of ast.decls) {
      if (decl.kind === "Fn") 外部.签名.set(decl.name, decl.params || []);
    }
  }

  // 第四层：借用的承诺要在被调者那一侧兑现，而且沿调用链走到底。
  // 上面几层都在调用者那一侧看 ——「borrow 之后我还能继续用」，那是信任；
  // 这一层验承诺本身，于是它变成证明。
  查借用承诺(ast, 签名表, 报, 外部);
  return 出;
}

// 一次 放 / 取 对状态的影响。返回 true 表示这一步被认出来了。
// 两处用到它：语句本身是方法调用，以及 `let a = 格.取()` 这种把调用放在右值里的形状 ——
// 少了第二处，正例「放→取→放」会被误报成「放两次」。
function 处理方法调用(调, 状态, 报) {
  if (!是方法调用(调)) return false;
  const 名 = 调.callee.target.name;
  const 方法 = 调.callee.name;
  if (!状态.has(名)) return false;
  if (方法 !== "放" && 方法 !== "取" && 方法 !== "关") {
    // 别的方法：之后说不清（这一层不认识它们，也不假装认识）。
    状态.delete(名);
    return false;
  }
  const 现在 = 状态.get(名);
  // 判定本身不在这里 —— 它在 src/owned-state.mjs，那是唯一真相，
  // 而 tools/owned-state.hmoca 是它的 HMYR 镜像（两份对同一批输入必须给出同一份判定）。
  // 这里只负责把动作翻译过去、把交回的错拼成一句诊断。
  const 判 = 转移(现在, 方法);
  if (判.错) {
    报("'" + 名 + "' " + 判.错 + "; and that is knowable at load time", 调);
    return true;
  }
  if (判.态 === null) 状态.delete(名);
  else 状态.set(名, 判.态);
  return true;
}

// 两条路径汇合时，一个变量的状态只在两条都一样的时候才保得住 —— 其余一律说不清。
// 这一条是数据流分析的全部内容，而它保守的方向仍然是「宁可漏」：
// 一侧满一侧空就是「可能满可能空」，不判。
function 合并状态(甲, 乙) {
  const 出 = new Map();
  for (const [名, 态] of 甲) {
    if (乙.get(名) === 态) 出.set(名, 态);
  }
  return 出;
}

// 一个直行序列：按顺序更新状态表，遇到错就报，遇到看不透的东西就降级。
function 走块(语句们, 状态, 报, 签名表) {
  for (const 句 of 语句们) {
    if (!句) continue;

    // let X = … —— 先看右值里有没有 放 / 取，再决定 X 自己是什么状态。
    if ((句.kind === "Let" || 句.kind === "Var") && 句.value) {
      if (句.value.kind === "调用" && 句.value.callee &&
          句.value.callee.kind === "名" && 句.value.callee.name === "owned") {
        状态.set(句.name, 空);
        continue;
      }
      处理方法调用(句.value, 状态, 报);
      状态.delete(句.name);
      continue;
    }

    // 方法调用：X.放(v) / X.取()。
    const 调 = 句.kind === "ExprStmt" ? 句.expr : (句.kind === "Assign" ? 句.value : null);
    if (处理方法调用(调, 状态, 报)) continue;

    // 跨函数的转移：调用一个把某参数标成 own 的函数，而实参是一条被追踪的持有格时，
    // 源这边就是「已经交出去了」。这是借用分析的第一步 —— 它只用签名上那个词，
    // 不去看被调函数体里到底做了什么。所以它是一个承诺，不是一个证明。
    //
    // 而普通参数（没写 own 也没写 borrow）要降级：被调函数可能往里放了东西，
    // 静态这一层看不见。实测撞到的正是这个 —— 一个 `造(盒)` 在别处往盒里放了值，
    // 回到调用者这边还以为它是空的，于是把一次合法的取判成了 HMYR-碼-006。
    // borrow 保持：那个词的意思就是「只借不改」，信它。
    if (调 && 调.kind === "调用" && 调.callee && 调.callee.kind === "名" && 签名表.has(调.callee.name)) {
      const 参数们 = 签名表.get(调.callee.name) || [];
      const 实参们 = 调.args || [];
      for (let i = 0; i < 实参们.length; i++) {
        const 形 = 参数们[i];
        const 实 = 实参们[i];
        if (!实 || 实.kind !== "名" || !状态.has(实.name)) continue;
        const 传法 = 形 ? 形.passing : null;
        if (传法 === "own") 状态.set(实.name, 移);
        else if (传法 !== "borrow") 状态.delete(实.name);
      }
      continue;
    }

    // 分支与循环。两只形状都要认：宿主那一层的 parser 给的是语句（kind 就是 If / While），
    // 而子集那一层给的是表达式（ExprStmt 的 expr 是 If / While）。
    // 只认一只的话，另一只上这一节等于没跑 —— 而它会「碰巧」通过，因为走到降级那条路。
    const 控制 = (句.kind === "If" || 句.kind === "While")
      ? 句
      : (调 && (调.kind === "If" || 调.kind === "While") ? 调 : null);

    if (控制 && 控制.kind === "If") {
      // 两条路径各走一遍（用的是同一份状态的拷贝），再按「都一样才保得住」汇合。
      // 没有 else 的那一支，另一侧就是原状态 —— 那是「可能没走」的意思。
      const 甲 = 走块(控制.then ? (控制.then.statements || []) : [], new Map(状态), 报, 签名表);
      const 乙 = 控制.otherwise
        ? 走块(控制.otherwise.statements || [], new Map(状态), 报, 签名表)
        : new Map(状态);
      const 合 = 合并状态(甲, 乙);
      状态.clear();
      for (const [键, 态] of 合) 状态.set(键, 态);
      continue;
    }
    if (控制 && 控制.kind === "While") {
      // 零次与多次都要算：体走一遍得出「走过之后」，再与「没走」的那份汇合。
      const 体 = 走块(控制.body ? (控制.body.statements || []) : [], new Map(状态), 报, 签名表);
      const 合 = 合并状态(状态, 体);
      状态.clear();
      for (const [键, 态] of 合) 状态.set(键, 态);
      continue;
    }

    // 别的语句：把里面提到的名字降级。保守到「宁可少判」。
    for (const 名 of 句子里提到的名字(句)) 状态.delete(名);
  }
  return 状态;
}

// 一条语句里出现的所有标识符名。用它把状态降级，判据粗一点没关系 ——
// 这一份检查的失败模式必须是「漏报」，不能是「误报」。
function 句子里提到的名字(n, 出 = new Set()) {
  if (!n || typeof n !== "object") return 出;
  if (Array.isArray(n)) { for (const x of n) 句子里提到的名字(x, 出); return 出; }
  if (n.kind === "名" && typeof n.name === "string") 出.add(n.name);
  for (const [k, v] of Object.entries(n)) {
    if (k === "line" || k === "column" || k === "kind") continue;
    句子里提到的名字(v, 出);
  }
  return 出;
}

// 借用的承诺，在被调者这一侧验 —— 而且沿调用链走到底。
//
// 前三层都在调用者那一侧：borrow 之后源这边的状态保持不变，那是「信任」。
// 这一层验承诺：一个标了 borrow 的参数，若它（或它被传下去之后的某一层）被改了，
// 就在最初那一侧报。
//
// 做法是一张「位置级」的图：不在名字上算，在参数位置上算，因为传递靠位置。
//   脏[F][i]      函数 F 的第 i 个参数被改过（直接改，或交给了 own 参数）
//   传[F][i]      函数 F 的第 i 个参数被传给了 (G, j)
// 然后迭代到不动点：传目标脏，则自己也脏。迭代次数上界是函数个数 ——
// 环（A 传给 B、B 又传回 A）因此不会让这里转圈。
//
// 这一层只看同一模块的调用。跨模块要等模块那一层有名字解析；动态目标
// （把函数当值传）在这门语言里今天没有，所以那两个缺口不在这里。
function 查借用承诺(ast, 签名表, 报, 外部) {
  const 函数们 = ast.decls.filter((d) => d.kind === "Fn" && d.body);

  // 查脏要同时看本模块与外面那张表 —— 被调者可能在别的模块里先装载过。
  const 查脏 = (名) => {
    const 本地 = 脏.get(名);
    if (本地) return 本地;
    if (外部 && 外部.脏) return 外部.脏.get(名);
    return undefined;
  };

  // 参数名到位置。
  const 位置表 = new Map();      // 函数名 -> Map(参数名, 位置)
  for (const d of 函数们) {
    const m = new Map();
    (d.params || []).forEach((p, i) => { if (p && p.name) m.set(p.name, i); });
    位置表.set(d.name, m);
  }

  const 脏 = new Map();          // 函数名 -> Set(位置)
  const 传 = new Map();          // 函数名 -> Map(位置 -> Set("名#位置"))
  for (const d of 函数们) { 脏.set(d.name, new Set()); 传.set(d.name, new Map()); }

  const 记脏 = (名, 位) => { const s = 脏.get(名); if (s) s.add(位); };
  const 记传 = (名, 位, 目标, 目标位) => {
    const m = 传.get(名);
    if (!m) return;
    if (!m.has(位)) m.set(位, new Set());
    m.get(位).add(目标 + "#" + 目标位);
  };

  // 第一遍：直接改与直接传。
  for (const d of 函数们) {
    const 位们 = 位置表.get(d.name);
    const 走 = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const x of n) 走(x); return; }
      if (n.kind === "调用" && n.callee) {
        const 主 = n.callee.kind === "Field" ? n.callee.target : null;
        if (主 && 主.kind === "名" && 位们.has(主.name)) {
          const 方法 = n.callee.name;
          if (方法 === "放" || 方法 === "取" || 方法 === "关") 记脏(d.name, 位们.get(主.name));
        }
        if (n.callee.kind === "名" && 签名表.has(n.callee.name)) {
          const 形们 = 签名表.get(n.callee.name) || [];
          const 实们 = n.args || [];
          for (let i = 0; i < 实们.length; i++) {
            const 实 = 实们[i];
            if (!实 || 实.kind !== "名" || !位们.has(实.name)) continue;
            const 形 = 形们[i];
            if (形 && 形.passing === "own") 记脏(d.name, 位们.get(实.name));
            else 记传(d.name, 位们.get(实.name), n.callee.name, i);
          }
        }
      }
      for (const [k, v] of Object.entries(n)) {
        if (k === "line" || k === "column" || k === "kind") continue;
        走(v);
      }
    };
    走(d.body);
  }

  // 第二遍：迭代到不动点。上界是函数个数 —— 环不会让它转圈。
  for (let 轮 = 0; 轮 <= 函数们.length; 轮++) {
    let 变了 = false;
    for (const d of 函数们) {
      const m = 传.get(d.name);
      const 本脏 = 脏.get(d.name);
      for (const [位, 目标们] of m) {
        if (本脏.has(位)) continue;
        for (const 目 of 目标们) {
          const [名, 位文] = 目.split("#");
          if (查脏(名) && 查脏(名).has(Number(位文))) { 本脏.add(位); 变了 = true; break; }
        }
      }
    }
    if (!变了) break;
  }

  // 第三遍：报在最初那一侧 —— 对象是那个标了 borrow 的参数。
  for (const d of 函数们) {
    const 位们 = 位置表.get(d.name);
    const 借来位 = new Set();
    (d.params || []).forEach((p, i) => { if (p && p.passing === "borrow") 借来位.add(i); });
    if (借来位.size === 0) continue;

    const 真脏 = 查脏(d.name) || new Set();
    const 该报 = new Set([...借来位].filter((i) => 真脏.has(i)));
    if (该报.size === 0) continue;

    // 报在第一个「动它」或「传它」的地方，而不是函数头 —— 那样读的人才知道是哪一步。
    const 走 = (n) => {
      if (!n || typeof n !== "object") return false;
      if (Array.isArray(n)) { for (const x of n) if (走(x)) return true; return false; }
      if (n.kind === "调用" && n.callee) {
        const 主 = n.callee.kind === "Field" ? n.callee.target : null;
        if (主 && 主.kind === "名" && 位们.has(主.name) && 该报.has(位们.get(主.name))) {
          const 方法 = n.callee.name;
          if (方法 === "放" || 方法 === "取" || 方法 === "关") {
            报("'" + 主.name + "' is borrowed, and this function calls " + 方法 + " on it: a borrow promises to leave what it borrows alone", n);
            return true;
          }
        }
        if (n.callee.kind === "名" && 签名表.has(n.callee.name)) {
          const 实们 = n.args || [];
          for (let i = 0; i < 实们.length; i++) {
            const 实 = 实们[i];
            if (!实 || 实.kind !== "名" || !位们.has(实.name)) continue;
            if (!该报.has(位们.get(实.name))) continue;
            报("'" + 实.name + "' is borrowed, and it goes into '" + n.callee.name + "' here, which changes it: a borrow promises to leave it alone all the way down", n);
            return true;
          }
        }
      }
      for (const [k, v] of Object.entries(n)) {
        if (k === "line" || k === "column" || k === "kind") continue;
        if (走(v)) return true;
      }
      return false;
    };
    走(d.body);
  }

  // 交接：本模块算出来的脏进外面那张表，下一个模块就看得到。
  // 这是「跨模块」的全部内容 —— 单趟、按装载顺序，而「被调者在后面才装载」
  // 这件事这一层看不见，理由写在 design/MEMORY.txt 第 2 节。
  if (外部 && 外部.脏) {
    for (const [名, 位们] of 脏) {
      const 已有 = 外部.脏.get(名);
      if (!已有) 外部.脏.set(名, new Set(位们));
      else for (const 位 of 位们) 已有.add(位);
    }
  }
}
