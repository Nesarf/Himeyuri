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
  const 路 = path.join(ROOT, "self/lex.hmoca");
  const 宿 = 宿主载(路);
  const 桥 = 桥载(路);
  ok("两边都说 ok", 宿.ok === true && 桥.ok === true, JSON.stringify([宿.ok, 桥.ok]));
  // 宿主的函数名从 modules 里取；桥的是它自己造出来的 Module 的 decls。
  const 宿名 = [];
  for (const f of 宿.order) for (const d of 宿.modules.get(f).decls) if (d.kind === "函数") 宿名.push(d.name);
  const 桥名 = [];
  for (const k of 桥.order) for (const d of Array.from(桥.modules.get(k).decls)) if (d.kind === "函数") 桥名.push(d.name);
  ok("函数名一模一样（" + 宿名.length + " 个）", JSON.stringify(宿名) === JSON.stringify(桥名), JSON.stringify(桥名.slice(0, 5)));
}

console.log("二、桥加载的 Module 能跑（lex 的 scan 认得出 token）");
{
  const 桥 = 桥载(path.join(ROOT, "self/lex.hmoca"));
  const rt = 桥跑(桥, { stepLimit: 20000000 });
  let 数 = -1;
  try { 数 = Array.from(rt.callFunction(rt.functions.get("scan"), ["let x = 1"], null)).length; } catch { 数 = -1; }
  ok("scan 交出四个 token", 数 === 4, String(数));
}

console.log("三、整棵 import 树：顺序与宿主一致（临时两文件工程）");
{
  const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-bridge-"));
  // double 要写 pub：它被另一个模块调用，而归属表活起来之后，跨模块调一个没 pub 的
  // 名字会被正当地拒成 HMYR-內-023（2026-11-02：桥补上「声明属于哪个文件」之后这条
  // 判据就红了 —— 而那恰好说明归属表第一次真的在工作）。
  fs.writeFileSync(path.join(临, "lib.hmoca"), "pub fn double(x: Int) -> Int {\n  return x * 2\n}\n", "utf8");
  fs.writeFileSync(path.join(临, "main.hmoca"), 'import "./lib.hmoca"\nfn main() -> Int {\n  return double(21)\n}\n', "utf8");
  const 入口 = path.join(临, "main.hmoca");
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
  const 桥 = 桥载(path.join(ROOT, "self", "no-such-file.hmoca"));
  ok("ok 是 false", 桥.ok === false);
  ok("诊断里有一条", (桥.diagnostics.errors || []).length > 0, JSON.stringify((桥.diagnostics.errors || []).map((e) => e.code)));
}

console.log("五、字节码产物：在，而且不比它的链旧");
{
  // 桥会因为「字节码缺失或过期」而退回解释器 —— 那是对的，但那时它慢十倍。
  // 这一条把那个静默的回退变成一句会红的话：改完 run.hmyr 或它 import 的任何一份，
  // 忘了重新生成，桥不会说谎，只是悄悄变慢，而套件该替人记住这件事。
  //
  // 比的是「这条链」，不是整个 self/：产物里含的是 run.hmyr 与它 import 的那些，
  // 而 self/ 下还有 release、package、lsp 之类与它无关的文件。
  // 早先按整个目录比，于是改一份无关的 self 文件就误报一次 —— 那是判定过宽，不是产物旧。
  const 字节路 = path.join(ROOT, "runtime/run.hmoks");
  const 在 = fs.existsSync(字节路);
  ok("runtime/run.hmyrb 在", 在);
  if (在) {
    const 层 = 宿主载(path.join(ROOT, "self/run.hmoca"));
    ok("run.hmyr 的链读得动", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
    let 最新 = 0;
    for (const 份 of 层.order) {
      const t = fs.statSync(份).mtimeMs;
      if (t > 最新) 最新 = t;
    }
    const 新 = fs.statSync(字节路).mtimeMs >= 最新;
    ok("它不比这条链（" + 层.order.length + " 份）里任何一份旧", 新,
      "旧了就重新生成：node tools/emit-code.mjs self/run.hmyr runtime/run.hmoks");
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
