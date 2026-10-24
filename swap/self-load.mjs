// 模块加载的语义对齐：宿主 loader 与 self/ 那条链，对同一棵 import 树给出同一份答案。
//
// 宿主 loader 的文件头写着三条承诺：真的加载 import、同一个文件只加载一次、循环引用被拒
// （HMYR-E0301），另有一条「引的文件不在就报 HMYR-E0302」。self/run.hmyr 的 加载走 照做，
// 顺序也取后序（与宿主 visit 里 push 的位置一致）。
//
// 这一套比三样：
//   一、order 逐项相同 —— 谁先被读到这件事，两边必须一样；
//   二、缺失的 import 两边都报 E0302；
//   三、环两边都报 E0301。
// 临时工程建在仓库里的 .tmp-load-* 下（.gitignore 已经收了这类前缀）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "self/run.hmyr"));
if (!unit.ok) {
  console.log("self/run.hmyr 加载失败：" + JSON.stringify((unit.diagnostics.errors || []).slice(0, 2).map((e) => e.code)));
  process.exit(1);
}
const rt = runUnit(unit, { stepLimit: 40000000000 });
const 调 = (名, 参) => String(rt.callFunction(rt.functions.get(名), 参, null));

// 路径规约：self/ 那边只是字符串拼接，会把 ../ 原样留着（功能上没错，Windows 认得，
// 但写出来的形状与宿主不同）。宿主 resolve 会规约，所以这里也规约一遍再比。
const 归一 = (p) => {
  const 顶 = [];
  for (const s of p.split("\\").join("/").split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") { 顶.pop(); continue; }
    顶.push(s);
  }
  return 顶.join("/");
};
const 相对仓 = (p) => 归一(path.relative(ROOT, p));

console.log("一、order：四棵真实的 import 树，逐项比");
for (const 入口 of ["self/sign.hmyr", "self/release.hmyr", "self/package.hmyr", "self/verify.hmyr"]) {
  const 宿主 = loadUnit(path.join(ROOT, 入口));
  const 自己 = 调("加载序", [入口]).trim().split(/\r?\n/).filter(Boolean).map(归一).sort();
  const 那边 = 宿主.order.map(相对仓).sort();
  const 同 = 宿主.ok && 自己.length === 那边.length && 自己.every((x, i) => x === 那边[i]);
  ok(入口 + " 的 order 一致（" + 那边.length + " 个文件）", 同,
    同 ? "" : "self=" + JSON.stringify(自己) + " 宿主=" + JSON.stringify(那边));
}

console.log("二、缺失的 import：两边都要说 E0302");
{
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-load-"));
  const 甲 = path.join(临, "a.hmyr");
  fs.writeFileSync(甲, 'import "./b.hmyr"\nfn main() -> Int {\n  return 1\n}\n', "utf8");
  const 宿主 = loadUnit(甲);
  const 宿主码 = (宿主.diagnostics.errors || []).map((e) => e.code);
  const 自己 = 调("只加载", [归一(path.relative(ROOT, 甲))]).trim();
  ok("宿主报 E0302", 宿主码.includes("HMYR-E0302"), JSON.stringify(宿主码));
  ok("self 也报 E0302", 自己.indexOf("E0302") >= 0, 自己);
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("三、循环引用：两边都要说 E0301");
{
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-load-"));
  const 子 = path.join(临, "sub");
  fs.mkdirSync(子);
  const 甲 = path.join(子, "a.hmyr");
  const 乙 = path.join(子, "b.hmyr");
  fs.writeFileSync(甲, 'import "./b.hmyr"\nfn main() -> Int {\n  return 1\n}\n', "utf8");
  fs.writeFileSync(乙, 'import "./a.hmyr"\nfn other() -> Int {\n  return 2\n}\n', "utf8");
  const 宿主 = loadUnit(甲);
  const 宿主码 = (宿主.diagnostics.errors || []).map((e) => e.code);
  const 自己 = 调("只加载", [归一(path.relative(ROOT, 甲))]).trim();
  ok("宿主报 E0301", 宿主码.includes("HMYR-E0301"), JSON.stringify(宿主码));
  ok("self 也报 E0301", 自己.indexOf("E0301") >= 0, 自己);
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
