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

const 字节路 = path.join(ROOT, "runtime/pack.hmyrb");
if (!fs.existsSync(字节路)) {
  console.log("没有 runtime/pack.hmyrb —— 先跑 node tools/emit-code.mjs self/pack.hmyr runtime/pack.hmyrb");
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
];

console.log("一、打包器在虚拟机上跑得动");
{
  const r = 调("编源码", [样本[0][1]]);
  ok("编源码 在 vm 上给出结果", !r.err, r.err || "ok");
}

console.log("二、两位打包者交出同样的字节");
for (const [标, 源] of 样本) {
  const 编r = 调("编源码", [源]);
  if (编r.err) { ok(标, false, "编源码：" + 编r.err); continue; }
  const 包r = 调("打包", [取(编r.value, "函数们")]);
  if (包r.err) { ok(标, false, "打包：" + 包r.err); continue; }
  const 她 = 拍平(包r.value);

  // JS 那一位：走宿主 loader 把源码读成树，再编译合并写字节
  const 临 = path.join(ROOT, ".tmp-vmc");
  fs.mkdirSync(临, { recursive: true });
  const 源路 = path.join(临, "p.hmyr");
  fs.writeFileSync(源路, 源, "utf8");
  const u = loadUnit(源路);
  fs.rmSync(临, { recursive: true, force: true });
  if (!u.ok) { ok(标, false, "宿主加载失败"); continue; }
  const js = 写程序(合并程序(u.order.map((f) => 编译模块(u.modules.get(f)))));

  const 同 = js.length === 她.length && js.every((b, i) => b === 她[i]);
  ok(标 + "（" + js.length + " 字节）", 同, 同 ? "" : "JS " + js.length + " / vm " + 她.length);
}

console.log("三、验签也在虚拟机上跑");
{
  const 签路 = path.join(ROOT, "runtime/sign.hmyrb");
  if (!fs.existsSync(签路)) {
    ok("runtime/sign.hmyrb 在", false, "先跑 node tools/emit-code.mjs self/sign.hmyr runtime/sign.hmyrb");
  } else {
    const 签vm = new 虚拟机(读程序(fs.readFileSync(签路)), {
      capabilities: 本机能力(), stepLimit: 40000000000, maxDepth: 4000,
    });
    const 真签 = path.join(ROOT, "dist/manifest.json.sig");
    const 真文 = path.join(ROOT, "dist/manifest.json");
    if (!fs.existsSync(真签) || !fs.existsSync(真文)) {
      ok("dist 里有真实签名", false, "没有 dist/manifest.json.sig");
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

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
