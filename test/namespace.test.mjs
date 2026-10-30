// 可见性的第一步：非 pub 的声明被别的模块用到时，说一声（HMYR-載-006）。
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
  ok("报 W0303", 有警告(单, "HMYR-載-006"),
    JSON.stringify(单.diagnostics.warnings.map((w) => w.code)));
  // 而它不拦：装载结果是成功的，因为求值器还是扁平表。
  ok("但它不拦装载", 单.ok === true, JSON.stringify(单.ok));
  const 那句 = 单.diagnostics.warnings.find((w) => w.code === "HMYR-載-006");
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
  ok("写 pub 就不报", !有警告(单, "HMYR-載-006"),
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
  ok("自家用自己的不报", !有警告(单, "HMYR-載-006"),
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

console.log("五、真拦：非 pub 的名字跨模块调用被拒（R0250）");
{
  // 这一节验的是「拦得住」。它曾经只是「记一条」（W0304），因为库里一个 pub 都没写，
  // 一开就把整个仓库打红。2026-10-27 做完 pub 迁移（tools/pub-census.mjs 盘出
  // 14 + 62 个名字、19 个入口全仓归零），它才升成拒绝。
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
  let 错 = null;
  try { runUnit(单偷).run(单偷.modules.get(偷)); } catch (e) { 错 = e; }
  // 尾调用那条路（return f()）正是最容易漏的一条，所以这个用例刻意用它。
  ok("非 pub 被拒（R0250）", !!错 && String(错.code) === "HMYR-內-023",
    String(错 && (错.code + " " + 错.message)).slice(0, 120));

  const 正 = 投(行们([
    "import \"./厨.hmoca\"",
    "",
    "fn main() -> Int {",
    "  return 招牌菜()",
    "}",
  ]), "正.hmoca");
  const 单正 = loadUnit(正);
  let 果正 = null;
  try { 果正 = runUnit(单正).run(单正.modules.get(正)); } catch (e) { 果正 = e; }
  ok("pub 的跨模块调用通过", 果正 === 11, String(果正 && (果正.code || 果正)));

  // 同模块里用自家的私有函数：最常见的一种写法，不该被拦。
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
  let 果家 = null;
  try { 果家 = runUnit(单家).run(单家.modules.get(自家)); } catch (e) { 果家 = e; }
  ok("自家的私有函数照用", 果家 === 7, String(果家 && (果家.code || 果家)));
}

console.log("六、整仓：没有一个跨模块的私有调用");
{
  // 迁移做完了，所以这一条能立起来：仓库里每一个多模块入口，装载完都是零条 W0303。
  // 少了这一条，下一次「随手把 pub 删掉」不会有人发现。
  const 入口们 = [
    "self/run.hmoca", "self/compile.hmoca", "self/fmt.hmoca", "self/lsp.hmoca",
    "self/manifest.hmoca", "self/pack.hmoca", "self/package.hmoca", "self/release.hmoca",
    "self/sign.hmoca", "self/verify.hmoca", "self/sig.hmoca", "self/ssh.hmoca",
    "self/curve.hmoca", "self/sha512.hmoca",
    "shell.hmoca", "shell-run.hmoca", "surface.hmoca", "ime.hmoca",
    "lib/protocol.hmoca",
  ];
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const 脏 = [];
  for (const 相 of 入口们) {
    const 单 = loadUnit(path.join(ROOT, 相));
    const 数 = 单.diagnostics.warnings.filter((w) => w.code === "HMYR-載-006").length;
    if (数 > 0) 脏.push(相 + " 有 " + 数 + " 条");
  }
  ok("十九个入口都是零", 脏.length === 0, 脏.join("；"));
}

console.log("七、as 别名：`名.成员` 真的能用");
{
  // 6.4 第二步的最后一步。别名以前只是被记下来，因为「哪个名字属于哪个模块」
  // 没有地方问 —— 有归属表与按模块分的声明表之后，能问了。
  //
  // 别名不是变量：去求 `厨` 的值只会得到「没有这个变量」，所以这条路必须在
  // 「求 callee」之前判断。判据里那两个用例就是为这一点写的。
  投(行们([
    "pub fn 招牌菜() -> Int {",
    "  return 11",
    "}",
    "",
    "fn 私房菜() -> Int {",
    "  return 7",
    "}",
  ]), "厨.hmoca");

  const 用别名 = 投(行们([
    "import \"./厨.hmoca\" as 厨",
    "",
    "fn main() -> Int {",
    "  return 厨.招牌菜()",
    "}",
  ]), "用别名.hmoca");
  const 单用 = loadUnit(用别名);
  let 果用 = null;
  try { 果用 = runUnit(单用).run(单用.modules.get(用别名)); } catch (e) { 果用 = e; }
  ok("别名点成员调得动", 果用 === 11, String(果用 && (果用.code || 果用)));

  const 越界 = 投(行们([
    "import \"./厨.hmoca\" as 厨",
    "",
    "fn main() -> Int {",
    "  return 厨.私房菜()",
    "}",
  ]), "越界.hmoca");
  const 单越 = loadUnit(越界);
  let 果越 = null;
  try { 果越 = runUnit(单越).run(单越.modules.get(越界)); } catch (e) { 果越 = e; }
  ok("别名点私有的也被拒（R0250）", !!果越 && String(果越.code) === "HMYR-內-023",
    String(果越 && (果越.code || 果越)).slice(0, 100));

  const 没有 = 投(行们([
    "import \"./厨.hmoca\" as 厨",
    "",
    "fn main() -> Int {",
    "  return 厨.不存在()",
    "}",
  ]), "没有.hmoca");
  const 单没 = loadUnit(没有);
  let 果没 = null;
  try { 果没 = runUnit(单没).run(单没.modules.get(没有)); } catch (e) { 果没 = e; }
  ok("别名点不存在的给 R0106", !!果没 && String(果没.code) === "HMYR-行-007",
    String(果没 && (果没.code || 果没)).slice(0, 100));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
