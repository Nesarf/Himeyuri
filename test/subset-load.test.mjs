// 子集那两层接到加载器上：同一份工程，两路读出来是一样的，跑起来也是一样的。
//
// 这一套钉的是「能不能顶替」，而不是「对不对得上」——后者由 subset-lex 与 subset-parse 两套钉着。
// 所以这里比的是加载器交出来的东西：模块顺序、每个模块的声明序列、跑起来之后的函数表、
// 以及两路算出来的同一个数。
//
// 换掉读法的口子在 src/loader.mjs 的 options.reader 上，默认仍然是宿主那两层。
// 一个套件不该因为另一条路存在而改变默认行为，所以这里两路并排跑、并排比。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 子集读 = (source) => 子集解(切(source));
const 短 = (f) => path.basename(f);

console.log("一、self/run.hmyr：两路读出来的模块序列与声明序列都相同");
{
  const 主 = loadUnit(path.join(ROOT, "self/run.hmyr"));
  const 子 = loadUnit(path.join(ROOT, "self/run.hmyr"), { reader: 子集读 });
  ok("两路都读得动", 主.ok && 子.ok, JSON.stringify(子.diagnostics.errors));
  ok("模块顺序相同", JSON.stringify(主.order.map(短)) === JSON.stringify(子.order.map(短)), 子.order.map(短).join(" "));
  const 名序 = (u) => u.order.map((f) => u.modules.get(f).decls.map((d) => d.kind + ":" + d.name).join(",")).join(" | ");
  ok("每个模块的声明序列相同", 名序(主) === 名序(子), 名序(子).slice(0, 80));
  ok("六份都在里面", 主.order.length === 6, String(主.order.length));
}

console.log("二、跑起来之后，函数表也是同一批名字");
{
  const 主 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")));
  const 子 = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr"), { reader: 子集读 }));
  const 名们 = (rt) => [...rt.functions.keys()].sort();
  ok("函数个数相同", 名们(主).length === 名们(子).length, 名们(主).length + " 对 " + 名们(子).length);
  ok("函数名逐个相同", JSON.stringify(名们(主)) === JSON.stringify(名们(子)));
  // 挑一件真事来跑：跑一段源码，两路给出同一个答案。
  const 跑 = (rt, s) => rt.callFunction(rt.functions.get("跑"), [s], null);
  ok("同一段源码给同一个答案", 跑(主, "1 + 2 * 3") === 跑(子, "1 + 2 * 3"), JSON.stringify(跑(子, "1 + 2 * 3")));
  ok("而那个答案是七", 跑(子, "1 + 2 * 3") === "7");
}

console.log("三、一个真工程：入口 import 另一件，两路算同一个数");
{
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-subset-load-"));
  try {
    fs.writeFileSync(path.join(目录, "lib.hmyr"), "fn 双(n: Int) -> Int {\n  return n * 2\n}\n");
    const 入口 = path.join(目录, "main.hmyr");
    fs.writeFileSync(入口, "import \"./lib.hmyr\"\n\nfn main() -> Int {\n  return 双(21)\n}\n");
    const 主单 = loadUnit(入口);
    const 子单 = loadUnit(入口, { reader: 子集读 });
    const 主 = runUnit(主单), 子 = runUnit(子单);
    const 算 = (rt) => rt.callFunction(rt.functions.get("main"), [], null);
    ok("两路都给四十二", 算(主) === 42 && 算(子) === 42, 算(主) + " 对 " + 算(子));
    // 加载顺序是「被引的在前」，于是 lib 应当排在 main 之前——两路都该如此。
    const 序 = (u) => JSON.stringify(u.order.map(短));
    ok("被 import 的那一件排在入口之前",
      JSON.stringify(["lib.hmyr", "main.hmyr"]) === 序(主单) && 序(主单) === 序(子单), 序(子单));
  } finally {
    fs.rmSync(目录, { recursive: true, force: true });
  }
}

console.log("四、子集那一层不静默：它不认的构造直接抛，而不是读成一棵猜出来的树");
{
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-subset-refuse-"));
  try {
    const 文件 = path.join(目录, "t.hmyr");
    fs.writeFileSync(文件, "type T = Int\n");
    let 错 = "";
    try { loadUnit(文件, { reader: 子集读 }); } catch (e) { 错 = e.message; }
    ok("type 声明让它抛错", 错.includes("只认 fn"), 错 || "（没有抛）");
    // 而宿主那一路读得动同一份文件：两条路的差别就在这儿，明写着。
    const 宿 = loadUnit(文件);
    ok("宿主那一路读得动", 宿.ok, JSON.stringify(宿.diagnostics.errors));
  } finally {
    fs.rmSync(目录, { recursive: true, force: true });
  }
}

console.log("五、默认没有被改掉：不传 reader 时用的还是宿主那两层");
{
  // 方法：宿主能读的来源里取一份含 type 声明的——子集读不了、默认读得了，
  // 于是「默认读得动」这件事本身就是证据。
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-subset-default-"));
  try {
    const 文件 = path.join(目录, "t.hmyr");
    fs.writeFileSync(文件, "type T = Int\n\nfn f() -> Int {\n  return 1\n}\n");
    ok("默认读得动带 type 的文件", loadUnit(文件).ok);
  } finally {
    fs.rmSync(目录, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
