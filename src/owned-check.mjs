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

export const 检查码 = "HMYR-E0321";

const 空 = "empty";
const 满 = "full";
const 关 = "closed";

const 是方法调用 = (n) =>
  n && n.kind === "Call" && n.callee && n.callee.kind === "Field" &&
  n.callee.target && n.callee.target.kind === "Ident";

/**
 * 一棵模块树里的 owned 单次使用检查。
 *
 * 交回 [{ severity, code, message, line, column }]，severity 一律 "error"。
 */
export function 持有格检查(ast, 选项 = {}) {
  const 出 = [];
  const 文件 = 选项.文件 || "";
  const 前缀 = 文件 ? 文件 + ": " : "";
  const 报 = (message, 节点) => {
    出.push({
      severity: "error", code: 检查码, message: 前缀 + message,
      line: (节点 && 节点.line) || 0, column: (节点 && 节点.column) || 0,
    });
  };
  if (!ast || !Array.isArray(ast.decls)) return 出;

  for (const decl of ast.decls) {
    if (decl.kind !== "Fn" || !decl.body) continue;
    走块(decl.body.statements || [], new Map(), 报);
  }
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
  // 关了之后不能再放也不能再取 —— 那两条在运行期是 R0305，而这里看得见。
  if (现在 === 关 && (方法 === "放" || 方法 === "取")) {
    报("'" + 名 + "' was closed before this point; using it after close is R0305 at run time, and it is knowable now", 调);
    return true;
  }
  if (方法 === "关") {
    // 重复关是幂等的（运行期也是），所以只记状态，不报。
    if (现在 !== 关) 状态.set(名, 关);
    return true;
  }
  if (方法 === "放") {
    if (现在 === 满) {
      报("'" + 名 + "' already holds a value here; putting a second one is R0305 at run time, and it is knowable now", 调);
    } else {
      状态.set(名, 满);
    }
  } else {
    if (现在 === 空) {
      报("'" + 名 + "' is empty here; taking from it is R0306 at run time, and it is knowable now", 调);
    } else {
      状态.set(名, 空);
    }
  }
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
function 走块(语句们, 状态, 报) {
  for (const 句 of 语句们) {
    if (!句) continue;

    // let X = … —— 先看右值里有没有 放 / 取，再决定 X 自己是什么状态。
    if ((句.kind === "Let" || 句.kind === "Var") && 句.value) {
      if (句.value.kind === "Call" && 句.value.callee &&
          句.value.callee.kind === "Ident" && 句.value.callee.name === "owned") {
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

    // 分支与循环。两只形状都要认：宿主那一层的 parser 给的是语句（kind 就是 If / While），
    // 而子集那一层给的是表达式（ExprStmt 的 expr 是 If / While）。
    // 只认一只的话，另一只上这一节等于没跑 —— 而它会「碰巧」通过，因为走到降级那条路。
    const 控制 = (句.kind === "If" || 句.kind === "While")
      ? 句
      : (调 && (调.kind === "If" || 调.kind === "While") ? 调 : null);

    if (控制 && 控制.kind === "If") {
      // 两条路径各走一遍（用的是同一份状态的拷贝），再按「都一样才保得住」汇合。
      // 没有 else 的那一支，另一侧就是原状态 —— 那是「可能没走」的意思。
      const 甲 = 走块(控制.then ? (控制.then.statements || []) : [], new Map(状态), 报);
      const 乙 = 控制.otherwise
        ? 走块(控制.otherwise.statements || [], new Map(状态), 报)
        : new Map(状态);
      const 合 = 合并状态(甲, 乙);
      状态.clear();
      for (const [键, 态] of 合) 状态.set(键, 态);
      continue;
    }
    if (控制 && 控制.kind === "While") {
      // 零次与多次都要算：体走一遍得出「走过之后」，再与「没走」的那份汇合。
      const 体 = 走块(控制.body ? (控制.body.statements || []) : [], new Map(状态), 报);
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
  if (n.kind === "Ident" && typeof n.name === "string") 出.add(n.name);
  for (const [k, v] of Object.entries(n)) {
    if (k === "line" || k === "column" || k === "kind") continue;
    句子里提到的名字(v, 出);
  }
  return 出;
}
