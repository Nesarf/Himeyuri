// owned 的单次使用检查：design/MEMORY.txt 第 2 节。
//
// 装载一份模块时，对每个函数体的直行序列做一份很小的状态追踪：
// 一个变量是空还是满，能不能被这一步的 放 / 取 弄对。
//
// 这一套要证明四件事：
//   一、两条反例被拒：放两次、取两次（都在空的或满的状态上）
//   二、正例一条不报：放→取→放 是合法的，而它最容易被一条粗判据误伤
//   三、看不透的形状不报：分支、循环、从参数来的持有格 —— 一条误报就够把检查关掉
//   四、装载器真的拦，而开关能关掉它
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";
import { 持有格检查 } from "../src/owned-check.mjs";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ownedcheck-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 查 = (源码) => 持有格检查(子集解(切(源码)).ast);
const 行们 = (v) => v.join("\n") + "\n";
const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
const 有 = (出, 词) => 出.some((d) => d.code === "HMYR-E0321" && d.message.includes(词));

console.log("一、两条反例被拒");
{
  const 放两次 = 行们([
    "fn main() -> Int {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  格.放(2)",
    "  return 0",
    "}",
  ]);
  ok("放两次被拒", 有(查(放两次), "already holds a value"), JSON.stringify(查(放两次)));

  const 取两次 = 行们([
    "fn main() -> Int {",
    "  let 格 = owned()",
    "  格.取()",
    "  格.取()",
    "  return 0",
    "}",
  ]);
  ok("取两次（第二次是空的）被拒", 有(查(取两次), "is empty here"), JSON.stringify(查(取两次)));
}

console.log("二、正例一条不报");
{
  // 放 → 取 → 放 是合法的：取走之后又能放。一条只数「放了几次」的粗判据会误伤它。
  const 正例 = 行们([
    "fn main() -> Int {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  let a = 格.取()",
    "  格.放(2)",
    "  let b = 格.取()",
    "  return a + b",
    "}",
  ]);
  ok("放取放取一条不报", 查(正例).length === 0, JSON.stringify(查(正例)));

  const 不碰 = 行们([
    "fn main() -> Int {",
    "  let 格 = owned()",
    "  return 0",
    "}",
  ]);
  ok("建了不放不取也不报", 查(不碰).length === 0, JSON.stringify(查(不碰)));
}

console.log("三、看不透的形状不报（宁可漏，不可误）");
{
  // 分支里放过：外面再说就是说不清了，不判。
  const 分支 = 行们([
    "fn f(n: Int) -> Int {",
    "  let 格 = owned()",
    "  if n > 0 {",
    "    格.放(1)",
    "  }",
    "  格.放(2)",
    "  return 0",
    "}",
  ]);
  ok("分支之后的第二次放不报", 查(分支).length === 0, JSON.stringify(查(分支)));

  // 循环体里反复放：一次也不追。
  const 循环 = 行们([
    "fn f(n: Int) -> Int {",
    "  let 格 = owned()",
    "  var i = 0",
    "  while i < n {",
    "    格.放(i)",
    "    i = i + 1",
    "  }",
    "  return 0",
    "}",
  ]);
  ok("循环体里的放不报", 查(循环).length === 0, JSON.stringify(查(循环)));

  // 从参数来的持有格：来源说不清，整条不判。
  const 参数 = 行们([
    "fn f(格: Int) -> Int {",
    "  格.放(1)",
    "  格.放(2)",
    "  return 0",
    "}",
  ]);
  ok("参数来的持有格不报（来源说不清）", 查(参数).length === 0, JSON.stringify(查(参数)));
}

console.log("四、装载器真的拦，开关能关");
{
  const 坏 = 投(行们([
    "fn main() -> Int {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  格.放(2)",
    "  return 0",
    "}",
  ]), "坏.hmoca");
  const 单 = loadUnit(坏);
  ok("装载结果是失败", 单.ok === false, JSON.stringify({ ok: 单.ok }));
  ok("诊断里有 E0321", 单.diagnostics.errors.some((e) => e.code === "HMYR-E0321"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code)));

  const 关 = loadUnit(坏, { ownedCheck: false });
  ok("关掉之后装得进来", 关.ok === true, JSON.stringify(关.diagnostics.errors.map((e) => e.code)));

  const 好 = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  print(str(格.取()) + chr(10))",
    "  return 0",
    "}",
  ]), "好.hmoca");
  const 单好 = loadUnit(好);
  ok("正例装得进来", 单好.ok === true, JSON.stringify(单好.diagnostics.errors.map((e) => e.code)));
}

console.log("五、整仓现有 .hmoca 零误报");
{
  const 收 = (根, 出 = [], 深 = 0) => {
    if (深 > 3) return 出;
    for (const e of fs.readdirSync(根, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      const p = path.join(根, e.name);
      if (e.isDirectory()) 收(p, 出, 深 + 1);
      else if (e.name.endsWith(".hmoca")) 出.push(p);
    }
    return 出;
  };
  const 份们 = 收(ROOT).sort();
  let 总数 = 0, 读不动 = 0;
  for (const p of 份们) {
    let 出 = [];
    try { 出 = 查(fs.readFileSync(p, "utf8")); } catch { 读不动++; continue; }
    总数 += 出.length;
  }
  ok(份们.length + " 份 .hmoca 零诊断", 总数 === 0, String(总数));
  ok("没有一份是读不动而跳过的", 读不动 === 0, String(读不动));
}

console.log("六、分支合并（数据流那一层）");
{
  // 两侧都放进去了，所以汇合之后是「满」—— 再放一次就是 R0305，看得见。
  const 两侧都放 = 行们([
    "fn f(n: Int) -> Int {",
    "  let 格 = owned()",
    "  if n > 0 {",
    "    格.放(1)",
    "  } else {",
    "    格.放(2)",
    "  }",
    "  格.放(3)",
    "  return 0",
    "}",
  ]);
  ok("if 两侧各放一次之后再放被拒", 有(查(两侧都放), "already holds a value"), JSON.stringify(查(两侧都放)));

  // 一侧放一侧不放：汇合之后是「可能满可能空」，所以不判 —— 这一条与上一条成对，
  // 少了它，合并就会往「宁可报」偏，而那份检查活不下来。
  const 一侧放 = 行们([
    "fn f(n: Int) -> Int {",
    "  let 格 = owned()",
    "  if n > 0 {",
    "    格.放(1)",
    "  }",
    "  格.放(3)",
    "  return 0",
    "}",
  ]);
  ok("一侧放一侧不放：汇合后不报", 查(一侧放).length === 0, JSON.stringify(查(一侧放)));

  // 先装满，再在两侧都取空 —— 汇合之后是「空」，再取一次就是 R0306。
  const 两侧都取 = 行们([
    "fn f(n: Int) -> Int {",
    "  let 格 = owned()",
    "  格.放(9)",
    "  if n > 0 {",
    "    格.取()",
    "  } else {",
    "    格.取()",
    "  }",
    "  格.取()",
    "  return 0",
    "}",
  ]);
  ok("两侧都取空之后再取被拒", 有(查(两侧都取), "is empty here"), JSON.stringify(查(两侧都取)));

  // 循环体里放一次：零次或多次都可能，汇合之后说不清，不判。
  const 循环放 = 行们([
    "fn f(n: Int) -> Int {",
    "  let 格 = owned()",
    "  var i = 0",
    "  while i < n {",
    "    格.放(i)",
    "    i = i + 1",
    "  }",
    "  格.放(7)",
    "  return 0",
    "}",
  ]);
  ok("循环之后不报（零次或多次都可能）", 查(循环放).length === 0, JSON.stringify(查(循环放)));
}

console.log("七、关闭之后的使用");
{
  const 关后放 = 行们([
    "fn f() -> Int {",
    "  let 格 = owned()",
    "  格.关()",
    "  格.放(1)",
    "  return 0",
    "}",
  ]);
  ok("关之后放被拒", 有(查(关后放), "was closed before this point"), JSON.stringify(查(关后放)));

  const 关后取 = 行们([
    "fn f() -> Int {",
    "  let 格 = owned()",
    "  格.关()",
    "  格.取()",
    "  return 0",
    "}",
  ]);
  ok("关之后取被拒", 有(查(关后取), "was closed before this point"), JSON.stringify(查(关后取)));

  // 重复关是幂等的，运行期不报，这里也不该报。
  const 重复关 = 行们([
    "fn f() -> Int {",
    "  let 格 = owned()",
    "  格.关()",
    "  格.关()",
    "  return 0",
    "}",
  ]);
  ok("重复关不报", 查(重复关).length === 0, JSON.stringify(查(重复关)));
}

console.log("八、跨函数的转移（只看签名上那个 own）");
{
  // 把持有格交给一个 own 参数的函数，等于交了所有权 —— 之后再动它就是 use-after-move。
  const 转移后用 = 行们([
    "fn 收下(own 格: Int) -> Int {",
    "  return 0",
    "}",
    "",
    "fn 用() -> Int {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  收下(格)",
    "  格.放(2)",
    "  return 0",
    "}",
  ]);
  ok("own 参数传出去之后再用被拒", 有(查(转移后用), "use-after-move"), JSON.stringify(查(转移后用)));

  // borrow 参数不转移所有权 —— 调用之后源这边仍然归自己，继续用是对的。
  const 借出后 = 行们([
    "fn 看一眼(borrow 格: Int) -> Int {",
    "  return 0",
    "}",
    "",
    "fn 用() -> Int {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  看一眼(格)",
    "  格.取()",
    "  return 0",
    "}",
  ]);
  ok("borrow 参数之后还能用", 查(借出后).length === 0, JSON.stringify(查(借出后)));

  // 普通参数（没写 own 也没写 borrow）也不当成转移 —— 这一层不猜。
  const 普通参 = 行们([
    "fn 收下(格: Int) -> Int {",
    "  return 0",
    "}",
    "",
    "fn 用() -> Int {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  收下(格)",
    "  格.取()",
    "  return 0",
    "}",
  ]);
  ok("没写 own 的参数不算转移", 查(普通参).length === 0, JSON.stringify(查(普通参)));
}

console.log("九、借用的承诺在被调者那一侧兑现");
{
  // 前三层都在调用者那边看：borrow 之后我还能继续用 —— 那是信任。
  // 这一层走进函数体，看它有没有真的不动那个参数。
  const 借了又放 = 行们([
    "fn 看(borrow 格: Int) -> Int {",
    "  格.放(1)",
    "  return 0",
    "}",
  ]);
  ok("borrow 参数上放被拒", 有(查(借了又放), "is borrowed"), JSON.stringify(查(借了又放)));

  const 借了又取 = 行们([
    "fn 看(borrow 格: Int) -> Int {",
    "  格.取()",
    "  return 0",
    "}",
  ]);
  ok("borrow 参数上取被拒", 有(查(借了又取), "is borrowed"), JSON.stringify(查(借了又取)));

  const 借了又关 = 行们([
    "fn 看(borrow 格: Int) -> Int {",
    "  格.关()",
    "  return 0",
    "}",
  ]);
  ok("borrow 参数上关被拒", 有(查(借了又关), "is borrowed"), JSON.stringify(查(借了又关)));

  // 借来的东西再交给一个 own 参数，等于把它交出去了 —— 那也是动了它。
  const 借出再转移 = 行们([
    "fn 收下(own 格: Int) -> Int {",
    "  return 0",
    "}",
    "",
    "fn 看(borrow 格: Int) -> Int {",
    "  收下(格)",
    "  return 0",
    "}",
  ]);
  ok("borrow 传进 own 参数被拒", 有(查(借出再转移), "all the way down"), JSON.stringify(查(借出再转移)));

  // 正例：借了不动。
  const 只看 = 行们([
    "fn 看(borrow 格: Int) -> Int {",
    "  return 0",
    "}",
  ]);
  ok("借了不用不报", 查(只看).length === 0, JSON.stringify(查(只看)));

  // 没写 borrow 的参数不受这一条约束 —— 门只对写了那个词的开。
  const 普通参数动 = 行们([
    "fn 改(格: Int) -> Int {",
    "  格.放(1)",
    "  return 0",
    "}",
  ]);
  ok("普通参数上放不报", 查(普通参数动).length === 0, JSON.stringify(查(普通参数动)));
}

console.log("十、沿调用链走到底（传递闭包）");
{
  // 一层深看不出来的那种：甲把借来的东西交给乙，乙又交给丙，而丙改了它。
  const 三层 = 行们([
    "fn 丙(格: Int) -> Int {",
    "  格.放(1)",
    "  return 0",
    "}",
    "",
    "fn 乙(格: Int) -> Int {",
    "  丙(格)",
    "  return 0",
    "}",
    "",
    "fn 甲(borrow 格: Int) -> Int {",
    "  乙(格)",
    "  return 0",
    "}",
  ]);
  ok("三层之外被改也报在最初那一侧", 有(查(三层), "all the way down"), JSON.stringify(查(三层)));

  // 干净的三层：一路都没动它，就不该报。
  const 干净三层 = 行们([
    "fn 丙(格: Int) -> Int {",
    "  return 0",
    "}",
    "",
    "fn 乙(格: Int) -> Int {",
    "  丙(格)",
    "  return 0",
    "}",
    "",
    "fn 甲(borrow 格: Int) -> Int {",
    "  乙(格)",
    "  return 0",
    "}",
  ]);
  ok("干净的三层不报", 查(干净三层).length === 0, JSON.stringify(查(干净三层)));

  // 环：甲传给乙，乙又传回甲。检查器不许转圈，也不许漏掉「环里有人改」。
  const 环里没改 = 行们([
    "fn 乙(格: Int) -> Int {",
    "  甲(格)",
    "  return 0",
    "}",
    "",
    "fn 甲(borrow 格: Int) -> Int {",
    "  乙(格)",
    "  return 0",
    "}",
  ]);
  ok("环上没人改就不报（而且不转圈）", 查(环里没改).length === 0, JSON.stringify(查(环里没改)));

  const 环里有改 = 行们([
    "fn 乙(格: Int) -> Int {",
    "  甲(格)",
    "  格.放(1)",
    "  return 0",
    "}",
    "",
    "fn 甲(borrow 格: Int) -> Int {",
    "  乙(格)",
    "  return 0",
    "}",
  ]);
  ok("环里有人改就报", 有(查(环里有改), "all the way down"), JSON.stringify(查(环里有改)));
}

console.log("十一、跨模块（按装载顺序累积）");
{
  // 借用分析要跨模块，而跨模块的全部内容是两张表按装载顺序累积：
  // 签名与脏。所以这一节验的是「被调者在别的模块里先装载过，这一层看得见它」。
  //
  // 看不见的那一半写在 design/MEMORY.txt 第 2 节：单趟遍历，被调者若在后装载，
  // 检查它的时候还不知道它脏不脏。那不是遗漏，是这一层的方式。
  const 乙 = 投(行们([
    "fn 改(格: Int) -> Int {",
    "  格.放(1)",
    "  return 0",
    "}",
  ]), "乙.hmoca");

  const 甲 = 投(行们([
    "import \"./乙.hmoca\"",
    "",
    "fn 借(borrow 格: Int) -> Int {",
    "  改(格)",
    "  return 0",
    "}",
  ]), "甲.hmoca");

  const 单 = loadUnit(甲);
  ok("跨模块的转移被看见",
   单.diagnostics.errors.some((e) => e.code === "HMYR-E0321" && /all the way down|changes it/.test(e.message)),
   JSON.stringify(单.diagnostics.errors.map((e) => e.code + " " + e.message.slice(0, 60))));

  // 干净的被调者：同样跨模块，但那边什么都不动 —— 不该报。
  const 净 = 投(行们([
    "fn 看(格: Int) -> Int {",
    "  return 0",
    "}",
  ]), "净.hmoca");
  const 甲净 = 投(行们([
    "import \"./净.hmoca\"",
    "",
    "fn 借(borrow 格: Int) -> Int {",
    "  看(格)",
    "  return 0",
    "}",
  ]), "甲净.hmoca");
  const 单净 = loadUnit(甲净);
  ok("跨模块的干净调用不报",
   单净.diagnostics.errors.filter((e) => e.code === "HMYR-E0321").length === 0,
   JSON.stringify(单净.diagnostics.errors.map((e) => e.code)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
