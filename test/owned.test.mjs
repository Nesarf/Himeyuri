// owned：三区里那个「单一所有者」（design/MEMORY.txt 第 2 节）。
//
// 一个持有格只装零个或一个值，取出即转移 —— 取走之后源那边空了，于是
// 「两个变量都声称拥有它」在运行期不成立。这一套验四件事：
//
//   一、放 / 取 / 有 的基本流程
//   二、放两次被拒（HMYR-碼-005）、取空的被拒（HMYR-碼-006）、关之后再放被拒（HMYR-碼-005）
//   三、四台同一段：默认、--host-eval、--compile、C（有 gcc 时）
//   四、它不是形式化的所有权类型 —— 编译期不检查转移，只有运行期看着
//
// 第三条最重要：与区一样，一台机器的判词不够，四台都一样才算「这条路修好了」。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 具 = path.join(ROOT, "bin", "hmyr.mjs");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-owned-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 行们 = (v) => v.join("\n") + "\n";
const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
const 跑 = (参) => spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd: 临, timeout: 300000 });
const 行 = (s) => String(s || "").split("\n").map((x) => x.trimEnd()).filter((x) => x.length > 0);

console.log("一、放 / 取 / 有 的基本流程");
{
  const p = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 格 = owned()",
    "  print(\"空=\" + str(格.有()) + chr(10))",
    "  格.放(42)",
    "  print(\"装=\" + str(格.有()) + chr(10))",
    "  let v = 格.取()",
    "  print(\"取=\" + str(v) + chr(10))",
    "  print(\"取完=\" + str(格.有()) + chr(10))",
    "  return 0",
    "}",
  ]), "甲.hmoca");
  const r = 跑([p]);
  const 出 = 行(r.stdout);
  ok("跑得动", r.status === 0, JSON.stringify({ status: r.status, err: (r.stderr || "").slice(0, 140) }));
  ok("一开始是空的", 出.includes("空=0"), JSON.stringify(出));
  ok("放进去之后有值", 出.includes("装=1"), JSON.stringify(出));
  ok("取得回来", 出.includes("取=42"), JSON.stringify(出));
  ok("取走之后又空了（这是转移）", 出.includes("取完=0"), JSON.stringify(出));
}

console.log("二、三条走错各有编号");
{
  const 两次 = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 格 = owned()",
    "  格.放(1)",
    "  格.放(2)",
    "  print(\"没有拦住\" + chr(10))",
    "  return 0",
    "}",
  ]), "乙.hmoca");
  const r1 = 跑([两次]);
  const 出1 = (r1.stdout || "") + (r1.stderr || "");
  ok("放两次被拦住（装载时 HMYR-載-021 或运行期 HMYR-碼-005）",
    (出1.includes("HMYR-碼-005") || 出1.includes("HMYR-載-021")) && !出1.includes("没有拦住"),
    JSON.stringify(出1.slice(0, 160)));

  const 取空 = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 格 = owned()",
    "  let v = 格.取()",
    "  print(\"没有拦住\" + chr(10))",
    "  return 0",
    "}",
  ]), "丙.hmoca");
  const r2 = 跑([取空]);
  const 出2 = (r2.stdout || "") + (r2.stderr || "");
  ok("取空的被拦住（装载时 HMYR-載-021 或运行期 HMYR-碼-006）",
    (出2.includes("HMYR-碼-006") || 出2.includes("HMYR-載-021")) && !出2.includes("没有拦住"),
    JSON.stringify(出2.slice(0, 160)));

  const 关后放 = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 格 = owned()",
    "  格.关()",
    "  格.放(3)",
    "  print(\"没有拦住\" + chr(10))",
    "  return 0",
    "}",
  ]), "丁.hmoca");
  const r3 = 跑([关后放]);
  const 出3 = (r3.stdout || "") + (r3.stderr || "");
  ok("关之后再放被拦住（装载时 HMYR-載-021 或运行期 HMYR-碼-005）",
    (出3.includes("HMYR-碼-005") || 出3.includes("HMYR-載-021")) && !出3.includes("没有拦住"),
    JSON.stringify(出3.slice(0, 160)));
}

console.log("三、四台同一段");
{
  const 源 = 行们([
    "fn main() -> Int effects(process) {",
    "  let 格 = owned()",
    "  格.放(7)",
    "  let v = 格.取()",
    "  print(\"取=\" + str(v) + \" 有=\" + str(格.有()) + chr(10))",
    "  return 0",
    "}",
  ]);
  const p = 投(源, "戊.hmoca");
  const 甲 = 跑([p]);
  const 甲行 = 行(甲.stdout);
  ok("默认跑得动", 甲.status === 0 && 甲行.includes("取=7 有=0"),
    JSON.stringify({ status: 甲.status, out: 甲行, err: (甲.stderr || "").slice(0, 140) }));

  const 乙 = 跑(["--host-eval", p]);
  ok("--host-eval 同一段", (乙.stdout || "") === (甲.stdout || ""), JSON.stringify([(乙.stdout || "").slice(0, 80), (甲.stdout || "").slice(0, 80)]));

  const 丙 = 跑(["--compile", p]);
  const 丙行 = 行(丙.stdout);
  ok("--compile 同一段", 丙.status === 0 && JSON.stringify(丙行) === JSON.stringify(甲行.slice(0, 丙行.length)),
    JSON.stringify([丙行, 甲行.slice(0, 丙行.length)]));

  const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc —— C 那台那一侧不验");
  } else {
    const exe = path.join(临, "hmyr-c.exe");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe,
      path.join(ROOT, "vm", "hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", 编.status === 0, String(编.stderr || "").slice(0, 160));
    if (编.status === 0) {
      const 台 = spawnSync(exe, [p], {
        encoding: "utf8", cwd: 临, timeout: 300000,
        env: { ...process.env, HMYR_MEM_LIMIT: "0", HMYR_STEPS: "4000000000" },
      });
      const 台行 = 行(台.stdout);
      ok("C 那台同一段", 台.status === 0 && JSON.stringify(台行) === JSON.stringify(甲行.slice(0, 台行.length)),
        JSON.stringify({ status: 台.status, out: 台行, err: (台.stderr || "").slice(0, 160) }));
    }
  }
}

console.log("四、作用域结束释放（四台同一段）");
{
  // 一个函数在自己那一帧里建持有格，再把它交出去。交出去之后它不该被造它的帧关掉 ——
  // 「转移」的第二层意思是：所有权连同「本帧退出时会关掉它」一起交给了这一格。
  //
  // 这一条是实测撞到的冲突：先只做了「帧退出一律关」，于是 盒.取() 拿到的是一条
  // 关掉的格子，再取就吃 HMYR-碼-005。判据留在这里，免得那一步被后来的改动抹回去。
  const 源 = 行们([
    "fn 造(盒: Int) -> Int {",
    "  let 格 = owned()",
    "  格.放(7)",
    "  盒.放(格)",
    "  return 0",
    "}",
    "",
    "fn main() -> Int effects(process) {",
    "  let 盒 = owned()",
    "  造(盒)",
    "  let 格 = 盒.取()",
    "  print(\"再取=\" + str(格.取()) + chr(10))",
    "  return 0",
    "}",
  ]);
  const p = 投(源, "己.hmoca");

  const 甲 = 跑([p]);
  const 甲行 = 行(甲.stdout);
  ok("默认路径：交出去的格子还能取", 甲行.includes("再取=7"),
    JSON.stringify({ status: 甲.status, out: 甲行, err: (甲.stderr || "").slice(0, 140) }));

  const 乙 = 跑(["--host-eval", p]);
  ok("--host-eval 同一段", (乙.stdout || "") === (甲.stdout || ""),
    JSON.stringify([(乙.stdout || "").slice(0, 80), (甲.stdout || "").slice(0, 80)]));

  const 丙 = 跑(["--compile", p]);
  const 丙行 = 行(丙.stdout);
  ok("--compile 同一段", 丙.status === 0 && JSON.stringify(丙行) === JSON.stringify(甲行.slice(0, 丙行.length)),
    JSON.stringify([丙行, 甲行.slice(0, 丙行.length)]));

  const exe = path.join(临, "hmyr-c.exe");
  if (fs.existsSync(exe)) {
    const 丁 = spawnSync(exe, [p], {
      encoding: "utf8", cwd: 临, timeout: 300000,
      env: { ...process.env, HMYR_MEM_LIMIT: "0", HMYR_STEPS: "4000000000" },
    });
    const 丁行 = 行(丁.stdout);
    ok("C 那台同一段", 丁.status === 0 && JSON.stringify(丁行) === JSON.stringify(甲行.slice(0, 丁行.length)),
      JSON.stringify({ status: 丁.status, out: 丁行, err: (丁.stderr || "").slice(0, 140) }));
  } else {
    console.log("  跳过  C 那台没编出来 —— 第四台不验");
  }

  // 「帧退出把没交出去的关掉」这一半在语言里看不见：不交出去，外面就没有引用。
  // 所以这一条的判据只能覆盖转移那一侧 —— 那一句写在 design/MEMORY.txt 第 2 节。
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
