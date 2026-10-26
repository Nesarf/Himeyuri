// 三区模型的编译期那一半（design/MEMORY.txt 第一条硬规则的第二个半句）。
//
// 那条规则写着「没有转换就是编译错误，不是未定义行为」。到昨天为止，兑现的只有
// 「不静默」：走错要到运行期才给 R0302 / R0303（test/zone.test.mjs 十六项）。
// 这一份在装载一份模块时走一遍树，把两条能静态看出来的错说出来，外加一条该被听见的警告。
//
// 认得的东西很少，这是故意的：
//
//   let a = arena()            a 是一个局部 arena
//   let b = a.alloc(...)       b 是一块属于 a 的内存（alloc 与 alloc_list 都算）
//   a.freeze(b)                b 交出去了 —— 交出之后返回它是合法的
//   a.adopt(b)                 又收回来了 —— 收回之后它再属于 a
//   return b                   b 属于一个局部 arena 且没交出去 → 逃逸（错）
//   while 里出现 arena()        每轮新建一个 → 分配量随轮数线性增长（警告）
//
// 不认的一律不报。一条会误报的检查会被关掉，而关掉的检查等于没有 ——
// 这个仓库里已经有过一次那样的账（打包器那一行正则，让两份文件安静地不进包）。
//
// 为什么「返回 arena 块」一律算逃逸，而不看 close 在哪：close 迟早会发生，
// 而返回出去的块会在那之后失效。把判据挂在「有没有交出去」上，比追 close 的分支稳。
//
// 认不出的形态（记录字段里存的块、从别的函数拿回来的块）今天不查：那要类型信息与
// 跨函数分析，而这一份只在装载时看一棵树。漏报写在这里，比假装查过好。

const 分配方法 = new Set(["alloc", "alloc_list"]);

const 名字 = (n) => (n && n.kind === "Ident" ? n.name : null);

const 是arena调用 = (n) => {
  if (!n || n.kind !== "Call") return false;
  return 名字(n.callee) === "arena";
};

// 只认 a.方法(...) 这一种形状。认不出目标是一个名字就不认。
const 方法调用 = (n) => {
  if (!n || n.kind !== "Call" || !n.callee || n.callee.kind !== "Field") return null;
  const 目标 = 名字(n.callee.target);
  if (!目标) return null;
  return { 目标, 方法: n.callee.name, 参数: n.args || [] };
};

/**
 * 一棵模块树里的区检查。
 *
 * 交回 [{ severity, code, message, line, column }]：severity 是 "error" 或 "warning"。
 * 位置取自节点自己带的 line / column —— 报错要能指回去，指不到就别报。
 */
export function 区检查(ast, 选项 = {}) {
  const 出 = [];
  const 文件 = 选项.文件 || "";
  const 前缀 = 文件 ? 文件 + ": " : "";
  const 报 = (severity, code, message, 节点) => {
    出.push({
      severity, code, message: 前缀 + message,
      line: (节点 && 节点.line) || 0, column: (节点 && 节点.column) || 0,
    });
  };
  if (!ast || !Array.isArray(ast.decls)) return 出;
  for (const decl of ast.decls) {
    if (decl.kind !== "Fn" || !decl.body) continue;
    const 场 = new Map();   // 局部 arena 的名字 → { 块: Set, 交出: Set }

    const 建场 = (名) => {
      if (!名) return null;
      if (!场.has(名)) 场.set(名, { 块: new Set(), 交出: new Set() });
      return 场.get(名);
    };

    const 块属于谁 = (名) => {
      if (!名) return [];
      const 命中 = [];
      for (const [场名, s] of 场) if (s.块.has(名) && !s.交出.has(名)) 命中.push({ 场名, s });
      return 命中;
    };

    const 走 = (n, 在循环里) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const x of n) 走(x, 在循环里); return; }

      if (n.kind === "While") {
        // 条件和体都在循环里。体通常是一个 Block，递归会走到里面每一条语句。
        走(n.condition, true);
        走(n.body, true);
        return;
      }

      if (n.kind === "Let" || n.kind === "Var") {
        if (是arena调用(n.value)) 建场(n.name);
        else {
          const 调 = 方法调用(n.value);
          if (调 && 场.has(调.目标) && 分配方法.has(调.方法)) 场.get(调.目标).块.add(n.name);
        }
        // 值里还可能藏着别的调用，照常往下走 —— 但「循环里 arena()」那一句只在 Call 里说，
        // 这里不说，否则同一个 arena() 会被说两遍。
        走(n.value, 在循环里);
        return;
      }

      if (n.kind === "Assign") {
        const 调 = 方法调用(n.value);
        if (调 && 场.has(调.目标) && 分配方法.has(调.方法)) 场.get(调.目标).块.add(n.name);
        走(n.value, 在循环里);
        return;
      }

      if (n.kind === "Return") {
        const 名 = 名字(n.value);
        if (名) {
          for (const { 场名 } of 块属于谁(名)) {
            报("error", "HMYR-R0301",
              "'" + 名 + "' is a block of the arena '" + 场名 + "' and it was never handed over; " +
              "returning it lets it outlive the arena - call " + 场名 + ".freeze(" + 名 + ") first, " +
              "or do not return it", n);
            break;   // 一个块被交回一次就够了，不必为每个同名场各说一遍
          }
        }
        const 调 = 方法调用(n.value);
        if (调 && 场.has(调.目标) && 分配方法.has(调.方法)) {
          报("error", "HMYR-R0301",
            "this returns a fresh block of the arena '" + 调.目标 + "' straight out of its scope; " +
            "the arena will be closed behind it, so hand it over with " + 调.目标 + ".freeze(...) first", n);
        }
        走(n.value, 在循环里);
        return;
      }

      if (n.kind === "Call") {
        if (是arena调用(n) && 在循环里) {
          报("warning", "HMYR-W0310",
            "an arena is built inside a loop: every round allocates a new one, so the total grows with " +
            "the number of rounds. Build it once outside the loop if the blocks do not need to be separate",
            n);
        }
        const 调 = 方法调用(n);
        if (调 && 场.has(调.目标)) {
          const 参名 = 名字(调.参数[0]);
          if (调.方法 === "freeze" && 参名 && 场.get(调.目标).块.has(参名)) 场.get(调.目标).交出.add(参名);
          if (调.方法 === "adopt" && 参名) 场.get(调.目标).交出.delete(参名);
        }
        走(n.callee, 在循环里);
        for (const a of n.args || []) 走(a, 在循环里);
        return;
      }

      for (const [k, v] of Object.entries(n)) {
        if (k === "line" || k === "column" || k === "kind") continue;
        走(v, 在循环里);
      }
    };

    走(decl.body, false);
  }
  return 出;
}
