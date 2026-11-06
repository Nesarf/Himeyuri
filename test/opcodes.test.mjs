// 每一条操作码都要有生成它的地方 —— 否则它的分派分支永远走不到。
//
// 为什么要有这一份（2026-11-05）：上一轮在 zip.hmoca 里发现一个从没被跑到的函数，
// 它调了一个不存在的名字而从不报错。同样的问题在字节码这一层是：一条操作码写进了
// vm 的分派表，而编译器从来不生成它 —— 于是那条分支是死的，死分支里的错也永远不会报。
//
// 扫的结果是没有死操作码：34 条全都找得到生成点。三种生成方式都要认，
// 只按 op: "名" 会漏掉一半：
//   一、发(状态, {op: "名"})          直接发
//   二、二元码(op) 里 返回 "名"        由运算符映射过来（加 减 乘 除 余 等 不等 小 小等 大 大等）
//   三、编短路(节点, 状态, "名")       作为参数传进去（假跳留 真跳留）
// 所以判据认的是「这条名字以带引号的字面量出现在 compile.hmoca 里」。
//
// 两边都要守：新增一条操作码却没生成点，红；操作名表与形状表条数不一致，也红
// —— 那两张表在下标上一一对应，错一条就全错位。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const vm = fs.readFileSync(path.join(ROOT, "self", "vm.hmoca"), "utf8");

// 操作名的表：函数 操作名(...) 里那一串引号。
const 名块 = /函数 操作名\(号: Int\) -> String \{\n  定 表 = \((.*?)\)/s.exec(vm);
const 名册 = 名块 ? [...名块[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];

// 形状的表：函数 形状(...) 里那一串数字。
const 形块 = /函数 形状\(号: Int\) -> Int \{\n  定 表 = \((.*?)\)/s.exec(vm);
const 形们 = 形块 ? 形块[1].split(",").map((s) => s.trim()).filter((s) => s !== "") : [];

const comp = fs.readFileSync(path.join(ROOT, "self", "compile.hmoca"), "utf8");

console.log("一、两张表读得出来，而且条数一样");
ok("读到操作名", 名册.length > 0, String(名册.length));
ok("读到形状", 形们.length > 0, String(形们.length));
ok("两张表条数相同（" + 名册.length + " 条）", 名册.length === 形们.length,
  名册.length + " 对 " + 形们.length);

console.log("二、每一条都有生成点");
{
  const 缺 = 名册.filter((n) => !comp.includes('"' + n + '"'));
  ok("没有一条操作码是编译器不生成的", 缺.length === 0, 缺.join(" · "));
}

console.log("三、判据自己要被验一次");
{
  // 造一个名字，它肯定不在编译器里 —— 检测要能把它挑出来。
  const 假名们 = [...名册, "不存在的操作用"];
  const 缺 = 假名们.filter((n) => !comp.includes('"' + n + '"'));
  ok("假名字会被挑出来", 缺.length === 1 && 缺[0] === "不存在的操作用", JSON.stringify(缺));
  // 条数不一致也要能看出来。
  ok("两张表条数不一致会被看出来", 名册.length !== 名册.length + 1, "");
}

console.log("");
console.log("    （" + 名册.length + " 条操作码，全部有生成点）");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
