// 桥的专项验收：loadUnit 换成 HMYR 自己那一套之后，结论与宿主 loader 是否一致。
//
// 这一套不常驻在别人的套件里，因为它要付一次「用 HMYR 写的加载器」的开销 ——
// 加载 lex.hmyr 这样两百来行的文件约几秒，加载 run.hmyr 那样带整棵 import 树的要一分多钟。
// 所以它自成一格：便宜的那部分每次都验，贵的那部分留给想量的人。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit as 宿主载, runUnit as 宿主跑 } from "../src/loader.mjs";
import { loadUnit as 桥载, runUnit as 桥跑 } from "./self-bridge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、同一个文件，两边都认得（self/lex.hmyr）");
{
  const 路 = path.join(ROOT, "self/lex.hmyr");
  const 宿 = 宿主载(路);
  const 桥 = 桥载(路);
  ok("两边都说 ok", 宿.ok === true && 桥.ok === true, JSON.stringify([宿.ok, 桥.ok]));
  // 宿主的函数名从 modules 里取；桥的是它自己造出来的 Module 的 decls。
  const 宿名 = [];
  for (const f of 宿.order) for (const d of 宿.modules.get(f).decls) if (d.kind === "Fn") 宿名.push(d.name);
  const 桥名 = [];
  for (const k of 桥.order) for (const d of Array.from(桥.modules.get(k).decls)) if (d.kind === "Fn") 桥名.push(d.name);
  ok("函数名一模一样（" + 宿名.length + " 个）", JSON.stringify(宿名) === JSON.stringify(桥名), JSON.stringify(桥名.slice(0, 5)));
}

console.log("二、桥加载的 Module 能跑（lex 的 scan 认得出 token）");
{
  const 桥 = 桥载(path.join(ROOT, "self/lex.hmyr"));
  const rt = 桥跑(桥, { stepLimit: 20000000 });
  let 数 = -1;
  try { 数 = Array.from(rt.callFunction(rt.functions.get("scan"), ["let x = 1"], null)).length; } catch { 数 = -1; }
  ok("scan 交出四个 token", 数 === 4, String(数));
}

console.log("三、整棵 import 树：顺序与宿主一致（临时两文件工程）");
{
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-bridge-"));
  fs.writeFileSync(path.join(临, "lib.hmyr"), "fn double(x: Int) -> Int {\n  return x * 2\n}\n", "utf8");
  fs.writeFileSync(path.join(临, "main.hmyr"), 'import "./lib.hmyr"\nfn main() -> Int {\n  return double(21)\n}\n', "utf8");
  const 入口 = path.join(临, "main.hmyr");
  const 宿 = 宿主载(入口);
  const 桥 = 桥载(入口);
  ok("两边都说 ok", 宿.ok === true && 桥.ok === true, JSON.stringify([宿.ok, 桥.ok]));
  ok("都是两个模块", 宿.order.length === 2 && 桥.order.length === 2, JSON.stringify([宿.order.length, 桥.order.length]));
  const rt = 桥跑(桥, { stepLimit: 20000000 });
  let 结果 = null;
  try { 结果 = rt.callFunction(rt.functions.get("main"), [], null); } catch (e) { 结果 = String(e && e.message).slice(0, 60); }
  ok("跨模块调用跑出 42", 结果 === 42, String(结果));
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("四、找不到的文件：如实说，不装作认得");
{
  const 桥 = 桥载(path.join(ROOT, "self", "no-such-file.hmyr"));
  ok("ok 是 false", 桥.ok === false);
  ok("诊断里有一条", (桥.diagnostics.errors || []).length > 0, JSON.stringify((桥.diagnostics.errors || []).map((e) => e.code)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
