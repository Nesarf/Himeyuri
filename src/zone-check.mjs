// 三区模型的编译期那一半（design/MEMORY.txt 第一条硬规则的第二个半句）。
//
// 那条规则写着「没有转换就是编译错误，不是未定义行为」。到昨天为止，兑现的只有
// 「不静默」：走错要到运行期才给 HMYR-碼-002 / HMYR-碼-003（test/zone.test.mjs 十六项）。
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

const 名字 = (n) => (n && n.kind === "名" ? n.name : null);

const 是arena调用 = (n) => {
  if (!n || n.kind !== "调用") return false;
  return 名字(n.callee) === "arena";
};

// 只认 a.方法(...) 这一种形状。认不出目标是一个名字就不认。
const 方法调用 = (n) => {
  if (!n || n.kind !== "调用" || !n.callee || n.callee.kind !== "Field") return null;
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
    const 场 = new Map();   // 局部 arena 的名字 → { 块: Set, 交出: Set, 关了: bool }

    const 建场 = (名) => {
      if (!名) return null;
      if (!场.has(名)) 场.set(名, { 块: new Set(), 交出: new Set(), 关了: false });
      return 场.get(名);
    };

    // 一块仍然属于它的场、而且没有交出去的内存。交出去之后它归托管，close 不再带走它 ——
    // 那是 freeze 的全部意义，所以这里必须把「已交出」排掉，否则 freeze 过的块会在 close 之后被误报。
    const 块属于谁 = (名) => {
      if (!名) return [];
      const 命中 = [];
      for (const [场名, s] of 场) if (s.块.has(名) && !s.交出.has(名)) 命中.push({ 场名, s });
      return 命中;
    };

    // 直行 = 这条语句在函数体的直接序列里。close 写在 if 里面时不一定执行过，
    // 所以只有直行的 close 才算「上面已经关了」—— 漏报一种，比误报一种好：
    // 误报会让这条检查被关掉，而关掉的检查等于没有。
    const 走 = (n, 在循环里, 直行) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const x of n) 走(x, 在循环里, 直行); return; }

      if (n.kind === "While") {
        // 条件和体都在循环里；体里的语句不再是直行 —— 一轮都不跑也是可能的。
        走(n.condition, true, 直行);
        走(n.body, true, false);
        return;
      }

      if (n.kind === "If") {
        走(n.condition, 在循环里, 直行);
        走(n.then, 在循环里, false);
        走(n.otherwise, 在循环里, false);
        return;
      }

      // 下标、字段、二元运算里如果出现一个已经随区关掉的块，那是同一件事：
      // 4.1 的原例里 return 之后接的是 .size，而「读它的字段」与「返回它」一样是碰了死内存。
      if (n.kind === "名") {
        const 关了的 = 块属于谁(n.name).filter(({ s }) => s.关了);
        if (关了的.length) {
          报("error", "HMYR-碼-001",
            "'" + n.name + "' belongs to the arena '" + 关了的[0].场名 + "', and that arena was closed above: " +
            "the block went with it. Close after the last use, or hand it over with " + 关了的[0].场名 +
            ".freeze(" + n.name + ") before closing", n);
        }
        return;
      }

      // 4.2 的「不许静默换区」，今天写得出来的那个形态：块被存进一条记录。
      // 记录可以交出去、可以返回，而区留在原地 —— 于是块跑出了区。
      // 设计稿的原例是「存到模块级变量」，而语言没有那个东西；记录字面量是同一件事
      // 在今天的写法里最近的形状，而且它可静态看见，不用类型系统。
      if (n.kind === "Record") {
        for (const f of n.fields || []) {
          const 名 = 名字(f.value);
          if (!名) continue;
          const 命中 = 块属于谁(名);
          if (命中.length) {
            报("error", "HMYR-碼-004",
              "'" + 名 + "' is a block of the arena '" + 命中[0].场名 + "' and this stores it in a record: " +
              "the record can be handed on or returned while the arena stays behind, so the block would " +
              "outlive the zone that owns it. Hand it over with " + 命中[0].场名 + ".freeze(" + 名 +
              ") if it is meant to travel", f.value);
          }
        }
        for (const f of n.fields || []) 走(f.value, 在循环里, 直行);
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
        走(n.value, 在循环里, 直行);
        return;
      }

      if (n.kind === "Assign") {
        const 调 = 方法调用(n.value);
        if (调 && 场.has(调.目标) && 分配方法.has(调.方法)) 场.get(调.目标).块.add(n.name);
        走(n.value, 在循环里, 直行);
        return;
      }

      if (n.kind === "Return") {
        const 名 = 名字(n.value);
        if (名) {
          const 命中 = 块属于谁(名);
          const 关了的 = 命中.filter(({ s }) => s.关了);
          if (关了的.length) {
            报("error", "HMYR-碼-001",
              "'" + 名 + "' belongs to the arena '" + 关了的[0].场名 + "', and that arena was closed above: " +
              "this returns a block that is already gone. Hand it over with " + 关了的[0].场名 + ".freeze(" +
              名 + ") before closing, or close after the last use", n);
          } else if (命中.length) {
            报("error", "HMYR-碼-001",
              "'" + 名 + "' is a block of the arena '" + 命中[0].场名 + "' and it was never handed over; " +
              "returning it lets it outlive the arena - call " + 命中[0].场名 + ".freeze(" + 名 + ") first, " +
              "or do not return it", n);
          }
          return;   // 值就是一个名字，它已经说完了
        }
        const 调 = 方法调用(n.value);
        if (调 && 场.has(调.目标) && 分配方法.has(调.方法)) {
          报("error", "HMYR-碼-001",
            "this returns a fresh block of the arena '" + 调.目标 + "' straight out of its scope; " +
            "the arena will be closed behind it, so hand it over with " + 调.目标 + ".freeze(...) first", n);
        }
        走(n.value, 在循环里, 直行);
        return;
      }

      if (n.kind === "调用") {
        if (是arena调用(n) && 在循环里) {
          报("warning", "HMYR-載-016",
            "an arena is built inside a loop: every round allocates a new one, so the total grows with " +
            "the number of rounds. Build it once outside the loop if the blocks do not need to be separate",
            n);
        }
        // §4.2 的第二个形态，而且它比记录字面量更贴原例（kept = b）：块被写进一条索引。
        // 索引是可变的，所以它能活得比这个函数久 —— 而区不会：close 一到，块就没了，
        // 索引里留下的是一个指向死块的引用。判据只看「第三个参数是不是块」，不要类型系统。
        if (n.callee && n.callee.kind === "名" && n.callee.name === "index_set") {
          const 存的名 = 名字((n.args || [])[2]);
          if (存的名) {
            const 命中 = 块属于谁(存的名);
            if (命中.length) {
              报("error", "HMYR-碼-004",
                "'" + 存的名 + "' is a block of the arena '" + 命中[0].场名 + "' and this stores it in an index: " +
                "the index can outlive this function and the arena cannot follow it, so what stays behind is a " +
                "reference to a dead block. Hand it over with " + 命中[0].场名 + ".freeze(" + 存的名 +
                ") if it is meant to travel", n);
            }
          }
        }
        const 调 = 方法调用(n);
        if (调 && 场.has(调.目标)) {
          const 参名 = 名字(调.参数[0]);
          if (调.方法 === "freeze" && 参名 && 场.get(调.目标).块.has(参名)) 场.get(调.目标).交出.add(参名);
          if (调.方法 === "adopt" && 参名) 场.get(调.目标).交出.delete(参名);
          // close 只在直行时算数：写在 if 里面时它可能没执行过。
          if (调.方法 === "close" && 直行) 场.get(调.目标).关了 = true;
        }
        // 一块内存交给别的函数，而那个函数的函数体不在这份文件里 —— 没人能保证它不把块留下。
        // 这是 §4.2「不许静默换区」今天能写出来的那个近似：原例要一个模块级的可变变量，
        // 而语言没有那个东西（顶层只有 fn / type / const / effect / macro）。近似是保守的，
        // 所以它是警告而不是错误 —— 一个会误拦的判据会被关掉，而关掉的判据等于没有。
        if (n.callee && n.callee.kind === "名") {
          for (const a of n.args || []) {
            const 名 = 名字(a);
            if (!名) continue;
            const 命中 = 块属于谁(名);
            if (命中.length) {
              报("warning", "HMYR-載-018",
                "'" + 名 + "' is a block of the arena '" + 命中[0].场名 + "' and it is passed to '" +
                n.callee.name + "', whose body is not in this source; nothing here promises it will not keep it",
                a);
            }
          }
        }
        走(n.callee, 在循环里, 直行);
        for (const a of n.args || []) 走(a, 在循环里, 直行);
        return;
      }

      for (const [k, v] of Object.entries(n)) {
        if (k === "line" || k === "column" || k === "kind") continue;
        走(v, 在循环里, 直行);
      }
    };

    走(decl.body, false, true);
  }
  return 出;
}
