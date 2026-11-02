// 两份编译器的字节差：逐个样本报出来，不作为判据。
//
// 为什么单独一件而不是塞进套件：套件的判据是「两边一样」。而今天有两处不一样 ——
// 一处是功能声明被硬编码成空（2026-11-02 已修，在 self/compile.hmoca 的 编函数 里），
// 另一处是 从十六进制 多出一条 弃（还没修，追到语句层）。在修完之前，这一件的工作是
// 「量」，不是「判」：它退出 0，把差异摆出来，谁修谁看。
//
// 修完之后 self-vm-compile 该把真实文件移回样本数组 —— 判据必须覆盖真实文件，
// 五行小程序守不住这一层。
//
// 样本从缺省清单里挑「零 import」的那些：这一件把源码当一份字符串交给编译器，
// 有 import 的要先拼依赖链，那是另一件事。零 import 的 self 文件已经够大了
// （bigint 336 行、lex 324 行），足够暴露真实的差异。
//
// 用法：node tools/compile-diff.mjs [文件名...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 读程序, 写程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 字节路 = path.join(ROOT, "runtime/pack.hmoks");
if (!fs.existsSync(字节路)) {
  console.error("没有 runtime/pack.hmoks —— 先跑 node tools/emit-code.mjs self/pack.hmoca runtime/pack.hmoks");
  process.exit(1);
}
const 种子 = new 虚拟机(读程序(fs.readFileSync(字节路)), {
  capabilities: 本机能力(), stepLimit: 400000000, maxDepth: 4000,
});
const 调 = (名, 参) => {
  const r = 种子.调用(名, 参, null);
  if (!r || !r.ok) throw new Error(String(r && r.码 ? r.码 + " " + (r.话 || "") : "停机"));
  return r.值;
};
const 取 = (v, k) => (v && v.fields ? v.fields.get(k) : (v ? v[k] : undefined));
const 拍平 = (v, acc = []) => {
  if (typeof v === "number") { acc.push(v); return acc; }
  if (v && v.tag === "tuple") { for (const x of v.items) 拍平(x, acc); return acc; }
  if (Array.isArray(v)) { for (const x of v) 拍平(x, acc); return acc; }
  if (v && v.tag === "record") { for (const [, x] of v.fields) 拍平(x, acc); return acc; }
  return acc;
};

// 这是两份编译器：JS 那份（src/bytecode.mjs 编、src/code-file.mjs 写）与 HMYR 那份
// （runtime/pack.hmoks 里的 编源码 + 打包）。两边都吃同一份源码字符串。
const 编一份 = (源) => {
  const 族 = 取(调("编源码", [源, 1]), "函数族");
  return 拍平(调("打包", [族]));
};
const JS编一份 = (源) => {
  const 路 = path.join(ROOT, ".tmp-diff.hmoca");
  fs.writeFileSync(路, 源, "utf8");
  try {
    const u = loadUnit(路);
    if (!u.ok) return { 错: "宿主加载失败" };
    return { 字节: 写程序(合并程序(u.order.map((f) => 编译模块(u.modules.get(f))))) };
  } finally {
    fs.rmSync(路, { force: true });
  }
};

const 样本 = process.argv.slice(2).length
  ? process.argv.slice(2).map((n) => path.join(ROOT, "self", n))
  : fs.readdirSync(path.join(ROOT, "self"))
      .filter((n) => n.endsWith(".hmoca"))
      .map((n) => path.join(ROOT, "self", n))
      .filter((路) => !/^引入 /m.test(fs.readFileSync(路, "utf8")));

let 有差 = 0;
for (const 路 of 样本) {
  const 名 = path.basename(路);
  const 源 = fs.readFileSync(路, "utf8");
  const 甲 = JS编一份(源);
  if (甲.错) { console.log("  " + 名 + "  " + 甲.错); continue; }
  let 乙;
  try { 乙 = 编一份(源); } catch (e) { console.log("  " + 名 + "  HMYR 编译失败：" + e.message); continue; }
  const 差 = 甲.字节.length - 乙.length;
  if (差 === 0) { console.log("  一致  " + 名 + "  " + 甲.字节.length + " 字节"); continue; }
  有差++;
  console.log("  有差  " + 名 + "  JS " + 甲.字节.length + " / HMYR " + 乙.length + "（差 " + 差 + "）");

  // 函数表：名字对不对得上，指令数差在哪一条函数上
  const A = 读程序(Buffer.from(甲.字节), null);
  const B = 读程序(Buffer.from(Buffer.from(乙)), null);
  for (const n of A.函数族.keys()) if (!B.函数族.has(n)) console.log("        HMYR 少了函数 " + n);
  for (const n of B.函数族.keys()) if (!A.函数族.has(n)) console.log("        JS 少了函数 " + n);
  for (const [n, f] of A.函数族) {
    const g = B.函数族.get(n);
    if (!g) continue;
    if (JSON.stringify(g.效果) !== JSON.stringify(f.效果)) {
      console.log("        效果不同 " + n + "：JS " + JSON.stringify(f.效果) + " / HMYR " + JSON.stringify(g.效果));
    }
    if (g.码.length !== f.码.length) {
      const a = f.码.map((x) => x.op), b = g.码.map((x) => x.op);
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      console.log("        指令数不同 " + n + "：JS " + a.length + " / HMYR " + b.length + "，从第 " + i + " 条起：" +
        "JS " + a.slice(i, i + 3).join(",") + " · HMYR " + b.slice(i, i + 3).join(","));
    }
    if (g.槽数 !== f.槽数) console.log("        槽数不同 " + n + "：JS " + f.槽数 + " / HMYR " + g.槽数);
  }
}
console.log("");
console.log(样本.length + " 份样本，其中 " + 有差 + " 份有差");
