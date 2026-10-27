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
import { loadUnit } from "../src/loader.mjs";

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

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
