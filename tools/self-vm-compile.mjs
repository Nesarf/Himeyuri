// 工具链自举的一块：让 HMYR 写的打包器跑在 HMYR 的虚拟机上，与 JS 那位逐字节比。
//
// 与 tools/self-vm-eval.mjs 的分工：那一件量「解释器能不能在 vm 上跑」，
// 这一件量「编译器与打包器能不能在 vm 上跑」—— 前者是运行，后者是造字节。
//
// 用法：node tools/self-vm-compile.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 读程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 字节路 = path.join(ROOT, "runtime/pack.hmoks");
if (!fs.existsSync(字节路)) {
  console.log("没有 runtime/pack.hmyrb —— 先跑 node tools/emit-code.mjs self/pack.hmyr runtime/pack.hmoks");
  process.exit(1);
}

const vm = new 虚拟机(读程序(fs.readFileSync(字节路)), {
  capabilities: 本机能力(), stepLimit: 400000000, maxDepth: 4000,
});
const 调 = (名, 参) => {
  const r = vm.调用(名, 参, null);
  if (!r || !r.ok) return { err: String(r && r.码 ? r.码 + " " + r.话 : "停机") };
  return { value: r.值 };
};

// vm 交回的是它自己的元组与记录，摊平成数字数组交给 Buffer
// vm 的记录要用 fields.get 取，不能当普通对象点字段
const 取 = (v, k) => (v && v.fields ? v.fields.get(k) : (v ? v[k] : undefined));

const 拍平 = (v, acc = []) => {
  if (typeof v === "number") { acc.push(v); return acc; }
  if (v && v.tag === "tuple") { for (const x of v.items) 拍平(x, acc); return acc; }
  if (Array.isArray(v)) { for (const x of v) 拍平(x, acc); return acc; }
  if (v && v.tag === "record") { for (const [, x] of v.fields) 拍平(x, acc); return acc; }
  return acc;
};

const 样本 = [
  ["直接返回一个数", "fn main() -> Int {\n  return 7\n}\n"],
  ["两个函数与一次调用", "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  return 加(20, 22)\n}\n"],
  ["if 与字符串", 'fn main() -> Int {\n  let s = "ab"\n  if s == "ab" {\n    print(s)\n  }\n  return len(s)\n}\n'],
  ["while 与比较", "fn main() -> Int {\n  var i = 0\n  while i < 4 {\n    i = i + 1\n  }\n  return i\n}\n"],
  ["元组与下标", "fn main() -> Int {\n  let t = (10, 20, 30)\n  return t[1]\n}\n"],
  // 真实文件。前五份都是五行以内的小程序，而「两个编译器给同一个字节流」这条判据真正要
  // 守的是大文件 —— 2026-11-02 加进来之后立刻抓到三处差异（效果硬编码成空、记录字段名被
  // 归一成 effect、嵌套 若 多一个 弃），三处都修完之后 19 份真实文件逐字节相同。
  //
  // 选 bigint.hmoca 因为两条：336 行，且零 import（这一套的样本会被写进临时目录，
  // 有 import 的会在那里解析不了）。curve 与 sign 现在还编不动 —— 等子集扩大之后
  // 那两份才进得来。
  // 契约（design/CONTRACTS.txt、design/INVARIANTS.txt）。2026-11-02 补这一份，
  // 因为前面六份一条契约都没有 —— 而子集编译器新写的那一段字节，恰好是判据没走到的地方。
  // 三样写全：requires 在入口，ensures 与 invariant 在出口，而 invariant 在入口也查一次。
  // 契约必须分行：自举层的 契约批 靠行尾切条件，写在签名同一行会把 { 也吃进去。
  ["带三样契约的函数", "fn 取首(a: Int) -> Int\n  requires a >= 0\n  ensures 返回值 >= 0\n  invariant a >= 0\n{\n  return a\n}\nfn main() -> Int {\n  let x = 取首(3)\n  return x\n}\n"],
  // 循环不变式（design/INVARIANTS.txt 第八节）。2026-11-02 补这一份：
  // 它让「当」上的那两处插入（入口一次、体末一次）进到逐字节比对里。
  // 契约写在 当 那一行是必须的：自举那一层靠同一行认它（见 self/stmt.hmoca 的 parse_while）。
  ["带循环不变式的当", "fn main() -> Int {\n  var i = 0\n  while i < 4 invariant i >= 0 {\n    i = i + 1\n  }\n  return i\n}\n"],
  ["真实文件 self/bigint.hmoca", fs.readFileSync(path.join(ROOT, "self/bigint.hmoca"), "utf8")],
];

console.log("一、打包器在虚拟机上跑得动");
{
  const r = 调("编源码", [样本[0][1], 1]);
  ok("编源码 在 vm 上给出结果", !r.err, r.err || "ok");
}

console.log("二、两位打包者交出同样的字节");
for (const [标, 源] of 样本) {
  const 编r = 调("编源码", [源, 1]);
  if (编r.err) { ok(标, false, "编源码：" + 编r.err); continue; }
  const 包r = 调("打包", [取(编r.value, "函数族")]);
  if (包r.err) { ok(标, false, "打包：" + 包r.err); continue; }
  const 她 = 拍平(包r.value);

  // JS 那一位：走宿主 loader 把源码读成树，再编译合并写字节
  const 临 = path.join(ROOT, ".tmp-vmc");
  fs.mkdirSync(临, { recursive: true });
  const 源路 = path.join(临, "p.hmoca");
  fs.writeFileSync(源路, 源, "utf8");
  const u = loadUnit(源路);
  fs.rmSync(临, { recursive: true, force: true });
  if (!u.ok) { ok(标, false, "宿主加载失败"); continue; }
  // 两个档得对齐才谈得上逐字节比。子集编译器（self/compile.hmoca 的 编源码）
  // 没有选项层 —— 它固定编强档；所以这里让 JS 那一份也开强档。
  // 无契约的样本在两个档下字节相同（返槽与那两段都不发），这一句对它们没有影响。
  const js = 写程序(合并程序(u.order.map((f) => 编译模块(u.modules.get(f), { contracts: true }))));

  const 同 = js.length === 她.length && js.every((b, i) => b === 她[i]);
  ok(标 + "（" + js.length + " 字节）", 同, 同 ? "" : "JS " + js.length + " / vm " + 她.length);
}

console.log("二半、弱档：契约那几段一条都不发");
{
  // 这一节问的是档本身，而不只是「多了一个参数」。两条判据：
  //   一、弱档与 JS 弱档逐字节相同 —— 与第二节同一个理由，只是换了一档；
  //   二、弱档字节与强档字节不同 —— 否则那个参数只是摆设，改了也看不出来。
  // 只拿带契约的两份样本问：无契约的样本在两档下本来就相同（理由写在第二节）。
  for (const [标, 源] of 样本.filter(([标签]) => 标签.startsWith("带"))) {
    const 强r = 调("编源码", [源, 1]);
    const 强包r = 强r.err ? 强r : 调("打包", [取(强r.value, "函数族")]);
    if (强包r.err) { ok(标 + " 弱档", false, "强档就编不动：" + 强包r.err); continue; }
    const 强包 = 拍平(强包r.value);

    const 弱r = 调("编源码", [源, 0]);
    const 弱包r = 弱r.err ? 弱r : 调("打包", [取(弱r.value, "函数族")]);
    if (弱包r.err) { ok(标 + " 弱档", false, "弱档：" + 弱包r.err); continue; }
    const 弱包 = 拍平(弱包r.value);

    const 临 = path.join(ROOT, ".tmp-vmc");
    fs.mkdirSync(临, { recursive: true });
    const 源路 = path.join(临, "p.hmoca");
    fs.writeFileSync(源路, 源, "utf8");
    const u = loadUnit(源路);
    fs.rmSync(临, { recursive: true, force: true });
    if (!u.ok) { ok(标 + " 弱档", false, "宿主加载失败"); continue; }
    const js弱 = 写程序(合并程序(u.order.map((f) => 编译模块(u.modules.get(f), { contracts: false }))));

    const 同 = js弱.length === 弱包.length && js弱.every((b, i) => b === 弱包[i]);
    const 两档一样 = 强包.length === 弱包.length && 强包.every((b, i) => b === 弱包[i]);
    ok(标 + " 弱档与 JS 弱档相同（" + js弱.length + " 字节）", 同,
       同 ? "" : "JS " + js弱.length + " / vm " + 弱包.length);
    ok(标 + " 弱档与强档不同（" + 强包.length + " 对 " + 弱包.length + " 字节）", !两档一样,
       "两档字节一样 —— 那说明档没有起作用");
  }
}

console.log("三、验签也在虚拟机上跑");
{
  const 签路 = path.join(ROOT, "runtime/sign.hmoks");
  if (!fs.existsSync(签路)) {
    ok("runtime/sign.hmyrb 在", false, "先跑 node tools/emit-code.mjs self/sign.hmyr runtime/sign.hmoks");
  } else {
    const 签vm = new 虚拟机(读程序(fs.readFileSync(签路)), {
      capabilities: 本机能力(), stepLimit: 40000000000, maxDepth: 4000,
    });
    const 真签 = path.join(ROOT, "dist/manifest.json.sig");
    const 真文 = path.join(ROOT, "dist/manifest.json");
    if (!fs.existsSync(真签) || !fs.existsSync(真文)) {
      // 这一条要的是「一份真的、已经签过的发布物」。没有钥匙的机器（比如 WSL）
      // 打出来的包只有内容寻址，没有签名 —— 那时如实跳过，而不是报红：
      // 缺的是产物，不是代码。2026-11-03 在这里踩到过，报红的样子很像「验不过」。
      console.log("  跳过 2 项：dist 里没有 manifest.json 与它的签名：这一台没有签名钥匙");
    } else {
      const r = 签vm.调用("验文件", [真签, 真文], null);
      const 结果 = r && r.ok ? r.值 : null;
      ok("真实签名在 vm 上验得过", 结果 === true, r && r.ok ? JSON.stringify(结果) : JSON.stringify(签vm.停机));

      // 改一个字节，应当验不过
      const 临 = path.join(ROOT, ".tmp-sign");
      fs.mkdirSync(临, { recursive: true });
      const 改过 = path.join(临, "manifest.json");
      const 原文 = fs.readFileSync(真文);
      const 字节 = Buffer.from(原文);
      字节[0] = 字节[0] === 0x7b ? 0x7c : 0x7b;
      fs.writeFileSync(改过, 字节);
      const r2 = 签vm.调用("验文件", [真签, 改过], null);
      const 结果2 = r2 && r2.ok ? r2.值 : null;
      ok("改一个字节就验不过", 结果2 === false, r2 && r2.ok ? JSON.stringify(结果2) : JSON.stringify(签vm.停机));
      fs.rmSync(临, { recursive: true, force: true });
    }
  }
}

console.log("四、整棵树：自举那台编自己，与种子逐字节相同");
{
  // 上面三节都是「一份源码」：编源码 只吃一个字符串，所以样本必须自成一个文件
  // （bigint.hmoca 零 import 才进得来）。而 self/pack.hmoca 不是那样 —— 它引 compile，
  // compile 引 lex 与 body，body 引 stmt，stmt 引 chain，一棵五层的树。
  //
  // 这一节换用法：不调 编源码，调 pack.hmoca 自己的 main。它本来就走引入树
  // （读一棵）、去导入、一份一份编、按后序接函数表 —— 「多文件」这件事一直长在
  // 它的 main 里，只是上面三节没有走过那条路。
  //
  // 判据是那份种子：bootstrap/pack.hmtn 是六源编出来的字节。让自举那台重新生成
  // 一遍，相同就是自举闭环 —— 「runtime/pack.hmoks 由 JS 编出来」那句话于是只剩
  // 「第一次」这一个身份，而不是一道一直开着的口子。
  const 临 = path.join(ROOT, ".tmp-vmc-tree");
  const 出 = path.join(临, "out.hmtn");
  fs.mkdirSync(临, { recursive: true });
  fs.rmSync(出, { force: true });
  const 树vm = new 虚拟机(读程序(fs.readFileSync(字节路)), {
    capabilities: 本机能力(), stepLimit: 40000000000, maxDepth: 4000,
  });
  // 只给入口那一份：main 会顺着 引入 自己读邻居。argv 的第一位是程序名，
  // 第二位是输出路径，第三位才是要编的源 —— 漏掉第三位它就走「编个 return 7」那条
  // fallback，产出四十几字节而看着像成功。
  树vm.argv = ["pack.hmoca", 出, path.join(ROOT, "self/pack.hmoca")];
  const 树r = 树vm.调用("main", [], null);
  const 她 = fs.existsSync(出) ? fs.readFileSync(出) : null;
  const 种子 = fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmtn"));
  const 同 = 她 !== null && 她.length === 种子.length && Buffer.compare(她, 种子) === 0;
  ok("自举那台编出整棵树，与种子逐字节相同（" + (她 ? 她.length : 0) + " 字节）",
    同,
    她 ? "她 " + 她.length + " / 种子 " + 种子.length : (树r.ok ? "没有产出" : 树r.码 + " " + 树r.话));
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
