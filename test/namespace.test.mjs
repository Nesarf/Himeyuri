// 可见性的第一步：非 pub 的声明被别的模块用到时，说一声（HMYR-W0303）。
//
// 它是提示而不是拒绝 —— 求值器的函数表还是扁平的，那个名字照样能调到。
// 说一声的价值：等命名空间真的做了，这份清单就是「要改哪些地方」的名单。
//
// 这一套验三件：
//   一、非 pub 跨模块用 → 报 W0303（而且带上两个文件名）
//   二、pub 的跨模块用 → 不报
//   三、同一个模块里用非 pub → 不报
//
// 而 `as` 别名今天仍是记录：它不影响「能不能看见」，所以没有判据可写 ——
// 那一句写在 SPEC 6.4 里，而不是让这里假装有一条。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ns-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 行们 = (v) => v.join("\n") + "\n";
const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
const 有警告 = (单, 码) => 单.diagnostics.warnings.some((w) => w.code === 码);

console.log("一、非 pub 跨模块用：说一声");
{
  投(行们([
    "fn 私房菜() -> Int {",
    "  return 7",
    "}",
  ]), "厨房.hmoca");

  const 入口 = 投(行们([
    "import \"./厨房.hmoca\"",
    "",
    "fn main() -> Int {",
    "  return 私房菜()",
    "}",
  ]), "堂.hmoca");

  const 单 = loadUnit(入口);
  ok("报 W0303", 有警告(单, "HMYR-W0303"),
    JSON.stringify(单.diagnostics.warnings.map((w) => w.code)));
  // 而它不拦：装载结果是成功的，因为求值器还是扁平表。
  ok("但它不拦装载", 单.ok === true, JSON.stringify(单.ok));
  const 那句 = 单.diagnostics.warnings.find((w) => w.code === "HMYR-W0303");
  ok("那句话点出两个文件", !!那句 && 那句.message.includes("厨房.hmoca") && 那句.message.includes("堂.hmoca"),
    (那句 && 那句.message) || "");
}

console.log("二、pub 的跨模块用：不报");
{
  投(行们([
    "pub fn 招牌菜() -> Int {",
    "  return 9",
    "}",
  ]), "厨房.hmoca");

  const 入口 = 投(行们([
    "import \"./厨房.hmoca\"",
    "",
    "fn main() -> Int {",
    "  return 招牌菜()",
    "}",
  ]), "堂.hmoca");

  const 单 = loadUnit(入口);
  ok("写 pub 就不报", !有警告(单, "HMYR-W0303"),
    JSON.stringify(单.diagnostics.warnings.map((w) => w.code)));
}

console.log("三、同一个模块里用非 pub：不报");
{
  const 入口 = 投(行们([
    "fn 私房菜() -> Int {",
    "  return 7",
    "}",
    "",
    "fn main() -> Int {",
    "  return 私房菜()",
    "}",
  ]), "独门.hmoca");
  const 单 = loadUnit(入口);
  ok("自家用自己的不报", !有警告(单, "HMYR-W0303"),
    JSON.stringify(单.diagnostics.warnings.map((w) => w.code)));
}

console.log("四、归属表：名字来自哪个模块");
{
  // 命名空间第一步的地基：求值器记下每个名字来自哪个文件。
  // 它只记，不改查找 —— 所以这一节只验「问得出来」，不验「拦得住」（那是下一步，
  // 而下一步要动求值器，代价写在 SPEC 6.4 里）。
  投(行们([
    "pub fn 招牌() -> Int {",
    "  return 1",
    "}",
  ]), "厨.hmoca");
  const 入口 = 投(行们([
    "import \"./厨.hmoca\"",
    "",
    "fn main() -> Int {",
    "  return 招牌()",
    "}",
  ]), "堂.hmoca");

  const 单 = loadUnit(入口);
  const 机 = runUnit(单);
  ok("招牌来自厨.hmoca", String(机.归属者("招牌")).endsWith("厨.hmoca"), String(机.归属者("招牌")));
  ok("main 来自堂.hmoca", String(机.归属者("main")).endsWith("堂.hmoca"), String(机.归属者("main")));
  ok("没有的名字交回 null", 机.归属者("不存在") === null, String(机.归属者("不存在")));
}

console.log("五、观察：非 pub 的名字跨模块调用被记下（W0304）");
{
  // 这一节验的是「看得见」，不是「拦得住」。
  // 拦住要连带一次 pub 迁移（今天库里一个 pub 都没写），所以它是下一件工作，
  // 而不是这一轮把仓库打红的理由。判据因此看两件事：记得住，且 pub 的不记。
  投(行们([
    "fn 私房菜() -> Int {",
    "  return 7",
    "}",
    "",
    "pub fn 招牌菜() -> Int {",
    "  return 11",
    "}",
  ]), "厨.hmoca");

  const 偷 = 投(行们([
    "import \"./厨.hmoca\"",
    "",
    "fn main() -> Int {",
    "  return 私房菜()",
    "}",
  ]), "偷.hmoca");
  const 单偷 = loadUnit(偷);
  const 机偷 = runUnit(单偷);
  let 果偷 = null;
  try { 果偷 = 机偷.run(单偷.modules.get(偷)); } catch (e) { 果偷 = e; }
  // 尾调用那条路（return f()）正是最容易漏的一条，所以这个用例刻意用它。
  ok("非 pub 被记下（W0304）", 机偷.警告们.some((w) => w.code === "HMYR-W0304"),
    JSON.stringify(机偷.警告们.map((w) => w.code)));
  ok("而它不拦：程序照跑完", 果偷 === 7, String(果偷 && (果偷.code || 果偷)));

  const 正 = 投(行们([
    "import \"./厨.hmoca\"",
    "",
    "fn main() -> Int {",
    "  return 招牌菜()",
    "}",
  ]), "正.hmoca");
  const 单正 = loadUnit(正);
  const 机正 = runUnit(单正);
  let 果正 = null;
  try { 果正 = 机正.run(单正.modules.get(正)); } catch (e) { 果正 = e; }
  ok("pub 的跨模块调用通过", 果正 === 11, String(果正 && (果正.code || 果正)));
  ok("pub 的不记", 机正.警告们.filter((w) => w.code === "HMYR-W0304").length === 0,
    JSON.stringify(机正.警告们.map((w) => w.code)));

  // 同模块里用自家的私有函数：最常见的一种写法，不该被记。
  const 自家 = 投(行们([
    "fn 私房菜() -> Int {",
    "  return 7",
    "}",
    "",
    "fn main() -> Int {",
    "  return 私房菜()",
    "}",
  ]), "自家.hmoca");
  const 单家 = loadUnit(自家);
  const 机家 = runUnit(单家);
  let 果家 = null;
  try { 果家 = 机家.run(单家.modules.get(自家)); } catch (e) { 果家 = e; }
  ok("自家的私有函数照用", 果家 === 7, String(果家 && (果家.code || 果家)));
  ok("自家的不记", 机家.警告们.filter((w) => w.code === "HMYR-W0304").length === 0,
    JSON.stringify(机家.警告们.map((w) => w.code)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
