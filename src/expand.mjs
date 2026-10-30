// 卫生宏的展开：把模块里的 macro 声明取出来，再把调用点替换成模板。
//
// 语法（一行，与 const 同一条形状，只是右边是一个「带参数的模板」）：
//
//   macro 两次(x) = x + x
//
// 展开：两次(3) 变成 3 + 3。参数名在模板里出现几次就替换几次，
// 实参树原样嵌进去 —— 不复制、不改名。
//
// 「卫生」在这里是窄的那一条，而那一条是它的全部：模板不引入绑定。
// 没有 let、没有参数的遮蔽，就没有「模板内的绑定捕获实参」这一类问题。
// 这不是省略：带绑定的模板要块表达式，而字节码那台不认块表达式（见 bytecode.mjs）。
// 所以先做不会有问题的那一半，并把这个边界写在这里，而不是靠读代码的人自己推。
//
// 边界（都写成会说的，不写成会猜的）：
//   ・嵌套：模板里可以再用别的宏，展开到深度上限为止。
//   ・递归：宏不能展开成自己（那不终止），深度上限会拦住它并报出来。
//   ・参数个数不对：报 HMYR-形-006（声明形状那一类），不是一个含糊的「没有这个名字」。
//   ・捕获：模板里若出现与实参同名的自由标识符，它指的是调用处的那个 —— 参数替换是纯文本式的，
//     而这一点正是「没有绑定」带来的后果。要更严的卫生，得先有块表达式。

const 上限 = 64;

// 一个节点里的「子字段」：位置与名字不递归，其余都递归。
// 不列白名单是因为树的种类还在长 —— 而漏掉一个种类，宏就会在那一处悄悄不展开。
//
// 这里不能放 "value"：Ident 与 Literal 的 value 是标量，而 Return 的 value 是一棵子树。
// 按字段名一刀切会连 Return 里的表达式一起跳过 —— 那正是「宏不展开」的第一种样子。
// 标量本身不必列进来：递归到数字与字符串时自然是原样返回。
const 不递归 = new Set(["line", "column", "kind", "name", "text", "op", "pub", "type", "raw", "severity"]);

function 换回(x, 表, 深) {
  if (深 > 上限) throw new Error("HMYR-形-006 macro expansion went past " + 上限 + " levels");
  if (Array.isArray(x)) return x.map((y) => 换回(y, 表, 深));
  if (!x || typeof x !== "object") return x;
  // 参数：整个节点换掉，连它自己的子节点都不看（实参树已经展开过了）。
  if (x.kind === "名" && 表.has(x.name)) return 表.get(x.name);
  const 出 = {};
  let 变了 = false;
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (不递归.has(k)) { 出[k] = v; continue; }
    const w = 换回(v, 表, 深);
    出[k] = w;
    if (w !== v) 变了 = true;
  }
  return 变了 ? { ...出, kind: x.kind } : x;
}

function 展开式(x, 宏们, 深) {
  if (深 > 上限) throw new Error("HMYR-形-006 macro expansion went past " + 上限 + " levels");
  if (Array.isArray(x)) return x.map((y) => 展开式(y, 宏们, 深));
  if (!x || typeof x !== "object") return x;

  // 先把子节点展开，再看这一层本身是不是一个宏调用。
  // 顺序不能反：实参里也可能有宏。
  const 出 = {};
  let 变了 = false;
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (不递归.has(k)) { 出[k] = v; continue; }
    const w = 展开式(v, 宏们, 深);
    出[k] = w;
    if (w !== v) 变了 = true;
  }
  const 节点 = 变了 ? { ...出, kind: x.kind } : x;

  if (节点.kind === "调用" && 节点.callee && 节点.callee.kind === "名" && 宏们.has(节点.callee.name)) {
    const 宏 = 宏们.get(节点.callee.name);
    if (!Array.isArray(节点.args) || 节点.args.length !== 宏.params.length) {
      throw new Error("HMYR-形-006 macro " + 宏.name + " takes " + 宏.params.length +
        " argument(s), got " + (Array.isArray(节点.args) ? 节点.args.length : 0));
    }
    const 表 = new Map();
    宏.params.forEach((p, i) => 表.set(p, 节点.args[i]));
    return 展开式(换回(宏.body, 表, 深 + 1), 宏们, 深 + 1);
  }
  return 节点;
}

// 把一个模块里的宏收起来，然后展开它的每一条声明。没有宏的模块原样交回 —— 恒等，不是近似。
export function 展开模块(模块) {
  if (!模块 || !Array.isArray(模块.decls)) return 模块;
  const 宏们 = new Map();
  for (const d of 模块.decls) if (d && d.kind === "宏") 宏们.set(d.name, d);
  if (宏们.size === 0) return 模块;
  const decls = [];
  for (const d of 模块.decls) {
    if (d && d.kind === "宏") continue;
    decls.push(展开式(d, 宏们, 0));
  }
  return { ...模块, decls };
}
