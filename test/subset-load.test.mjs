// 两条路：默认那条（子集那两层）与显式指定的宿主那条，读出来是一样的。
//
// 这一套原来钉的是「可选的路也能顶替」。默认换过去之后，它钉的是另一件事，
// 而那一件更值得钉：换成默认之后，两条路的交出来的东西仍然一模一样——
// 模块顺序、每个模块的声明序列、跑起来的函数表、以及算出来的同一个数。
//
// 为什么还留着宿主那条路：工具链里有些地方（格式化器、语言服务器、一致性检查）
// 要读比子集更宽的语法，那是它们的事。loader 的口子留在这儿，而默认是子集。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "./../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 宿主那条路要自己带一份诊断对象：它记诊断而不抛，于是「读不进来」要靠诊断来说。
const 新诊断 = () => ({
  items: [], errors: [], warnings: [],
  add(severity, code, message, line, column) {
    const one = { severity, code, message, line, column };
    this.items.push(one);
    if (severity === "error") this.errors.push(one);
  },
  error(code, message, line, column) { this.add("error", code, message, line, column); },
  warn(code, message, line, column) { this.add("warning", code, message, line, column); },
});
const 宿主读 = (source) => {
  const d = 新诊断();
  const { ast } = parse(lex(source).tokens, { diagnostics: d });
  return { ast, diagnostics: d };
};
const 短 = (f) => path.basename(f);

console.log("一、self/run.hmyr：默认那条与宿主那条，模块与声明都相同");
{
  const 默认 = loadUnit(path.join(ROOT, "self/run.hmyr"));
  const 宿主 = loadUnit(path.join(ROOT, "self/run.hmyr"), { reader: 宿主读 });
  ok("两条都读得动", 默认.ok && 宿主.ok, JSON.stringify(宿主.diagnostics.errors.map((e) => e.code)));
  ok("模块顺序相同", JSON.stringify(默认.order.map(短)) === JSON.stringify(宿主.order.map(短)), 宿主.order.map(短).join(" "));
  const 名序 = (u) => u.order.map((f) => u.modules.get(f).decls.map((d) => d.kind + ":" + d.name).join(",")).join(" | ");
  ok("每个模块的声明序列相同", 名序(默认) === 名序(宿主), 名序(宿主).slice(0, 70));
  ok("六份都在里面", 默认.order.length === 6, String(默认.order.length));
}

console.log("二、跑起来之后，函数表也是同一批名字");
{
  const 默认 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")));
  const 宿主 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr"), { reader: 宿主读 }));
  const 名们 = (rt) => [...rt.functions.keys()].sort();
  ok("函数个数相同", 名们(默认).length === 名们(宿主).length, 名们(默认).length + " 对 " + 名们(宿主).length);
  ok("函数名逐个相同", JSON.stringify(名们(默认)) === JSON.stringify(名们(宿主)));
  const 跑 = (rt, s) => rt.callFunction(rt.functions.get("跑"), [s], null);
  ok("同一段源码给同一个答案", 跑(默认, "1 + 2 * 3") === 跑(宿主, "1 + 2 * 3"), JSON.stringify(跑(默认, "1 + 2 * 3")));
  ok("而那个答案是七", 跑(默认, "1 + 2 * 3") === "7");
}

console.log("三、一个真工程：入口 import 另一件，两条路算同一个数");
{
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-subset-load-"));
  try {
    fs.writeFileSync(path.join(目录, "lib.hmyr"), "fn 双(n: Int) -> Int {\n  return n * 2\n}\n");
    const 入口 = path.join(目录, "main.hmyr");
    fs.writeFileSync(入口, "import \"./lib.hmyr\"\n\nfn main() -> Int {\n  return 双(21)\n}\n");
    const 默认单 = loadUnit(入口);
    const 宿主单 = loadUnit(入口, { reader: 宿主读 });
    const 算 = (rt) => rt.callFunction(rt.functions.get("main"), [], null);
    ok("两条路都给四十二", 算(runUnit(默认单)) === 42 && 算(runUnit(宿主单)) === 42, 算(runUnit(默认单)) + " 对 " + 算(runUnit(宿主单)));
    const 序 = (u) => JSON.stringify(u.order.map(短));
    ok("被 import 的那一件排在入口之前（两条路都如此）",
      JSON.stringify(["lib.hmyr", "main.hmyr"]) === 序(默认单) && 序(默认单) === 序(宿主单), 序(默认单));
  } finally {
    fs.rmSync(目录, { recursive: true, force: true });
  }
}

console.log("四、默认那条不静默：它不认的构造直接抛，而不是读成一棵猜出来的树");
{
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-subset-refuse-"));
  try {
    const 文件 = path.join(目录, "t.hmyr");
    fs.writeFileSync(文件, "type T = Int\n");
    let 错 = "";
    try { loadUnit(文件); } catch (e) { 错 = e.message; }
    ok("默认那条抛错（type 声明）", 错.includes("只认 fn"), 错 || "（没有抛）");
    // 而宿主那一条读得动同一份文件：两条路的差别就在这儿，明写着。
    const 宿主 = loadUnit(文件, { reader: 宿主读 });
    ok("宿主那一条读得动", 宿主.ok, JSON.stringify(宿主.diagnostics.errors.map((e) => e.code)));
  } finally {
    fs.rmSync(目录, { recursive: true, force: true });
  }
}

console.log("五、默认是子集那两层，这一条要看得到");
{
  // 静态：loader 引的是子集那两层，且不再引宿主的 lexer/parser。
  // 说明它是静态的：它证明「没有引进来」，不证明「跑的时候没调到」。
  const 源 = fs.readFileSync(path.join(ROOT, "src/loader.mjs"), "utf8");
  ok("loader 引了子集切词器", /from "\.\/subset-lex\.mjs"/.test(源));
  ok("loader 引了子集 parser", /from "\.\/subset-parse\.mjs"/.test(源));
  ok("loader 没有引宿主 parser", !/from "\.\/parser\.mjs"/.test(源));
  ok("而它仍然留着一个口子", /options\.reader \|\|/.test(源));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
