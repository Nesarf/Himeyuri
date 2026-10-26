// 实时档位的第一层：装载时的静态约束（design/MEMORY.txt 第 3 节）。
//
// 一个函数用 effects(realtime) 声明自己跑在实时档位上。那几个字看起来像效果，
// 而它不是：效果说「这个函数能碰什么」（权限），档位说「它必须怎么跑」（约束）。
// 混用是因为语言还没有一个放档位的地方，而效果位是唯一现成的标注位。
// 这个取舍与「为什么不自作聪明加一条语法」写在 MEMORY.txt 第 3 节。
//
// 四条约束，都是能静态看的：
//
//   一、不许调 arena()  —— 托管分配在实时回调里就是不可预期的停顿
//   二、不许碰阻塞的东西 —— 文件、进程、线程（那张表借 src/eval.mjs 的 BUILTIN_EFFECTS）
//   三、循环的条件不能是常量真值 —— while true 这一类，没有任何输入能让它结束
//   四、不许调没有声明 realtime 的函数 —— 约束要沿调用链闭合，否则一条调用就把门开了
//
// 不认的一律不报。理由与 zone-check 同一条：会误报的检查会被关掉，而关掉的检查等于没有。
// 「有界」那条只拒常量真值：`while i < n` 是不是真的有界，要数据流分析，而这一份不做。
// 那是 §7 里记着的那条「先只做静态拒绝，不做完整证明」。

import { BUILTIN_EFFECTS } from "./eval.mjs";

export const 实时 = "realtime";

// 碰了就谈不上「零停顿」的那几类。读文件不是分配，但它会等系统。
const 阻塞效果 = new Set(["file", "process", "thread"]);

const 是常量真 = (n) => {
  if (!n) return false;
  if (n.kind === "Literal") return n.value === true || n.value === 1;
  // 自举那一层把 true 当标识符读（见 self/lex.hmoca 开头），所以两只都要认。
  if (n.kind === "Ident") return n.text === "true";
  return false;
};

/**
 * 一棵模块树里的实时档位检查。
 *
 * 交回 [{ severity, code, message, line, column }]：severity 一律是 "error"。
 * 与 zone-check 同一个形状，于是加载器那一段可以把两份诊断一样地并进去。
 */
export function 实时检查(ast, 选项 = {}) {
  const 出 = [];
  const 文件 = 选项.文件 || "";
  const 前缀 = 文件 ? 文件 + ": " : "";
  const 报 = (message, 节点) => {
    出.push({
      severity: "error", code: "HMYR-E0320",
      message: 前缀 + message,
      line: (节点 && 节点.line) || 0, column: (节点 && 节点.column) || 0,
    });
  };
  if (!ast || !Array.isArray(ast.decls)) return 出;

  // 哪些函数声明了实时档位；哪些函数是用户写的（第四条的判据要这两张表）。
  const 实时们 = new Set();
  const 用户函数 = new Set();
  for (const decl of ast.decls) {
    if (decl.kind !== "Fn") continue;
    用户函数.add(decl.name);
    if (Array.isArray(decl.effects) && decl.effects.includes(实时)) 实时们.add(decl.name);
  }
  if (实时们.size === 0) return 出;

  const 走 = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) 走(x); return; }

    if (n.kind === "While") {
      if (是常量真(n.condition)) {
        报("a loop whose condition is a constant true value never ends on its own; a realtime function must not own such a loop", n);
      }
      走(n.condition); 走(n.body);
      return;
    }

    if (n.kind === "Call" && n.callee && n.callee.kind === "Ident") {
      const 名 = n.callee.name;
      if (名 === "arena") {
        报("arena() allocates in the managed zone; a realtime function must use an arena built before the callback started", n);
      } else if (Object.prototype.hasOwnProperty.call(BUILTIN_EFFECTS, 名) && 阻塞效果.has(BUILTIN_EFFECTS[名])) {
        报("'" + 名 + "' touches the " + BUILTIN_EFFECTS[名] + " world, and a realtime function may not wait on anything", n);
      } else if (用户函数.has(名) && !实时们.has(名)) {
        报("'" + 名 + "' does not declare " + 实时 + ", so this call would run past the point where the promise stops", n);
      }
      走(n.callee);
      for (const a of n.args || []) 走(a);
      return;
    }

    for (const [k, v] of Object.entries(n)) {
      if (k === "line" || k === "column" || k === "kind") continue;
      走(v);
    }
  };

  for (const decl of ast.decls) {
    if (decl.kind !== "Fn" || !decl.body || !实时们.has(decl.name)) continue;
    走(decl.body);
  }
  return 出;
}
