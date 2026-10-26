// 区在自举层：design/MEMORY.txt 里那条缺口一。
//
// 到 2026-10-27 为止，arena 只在宿主求值器里有一个桩，而默认路径的目标程序由自举层
// （self/eval.hmoca）求值，碰不到它 —— 于是「三区模型」这四个字在那条路上是一句空话。
// 这一份验的是它不再是空话：默认路径跑得动一段用区的程序，而且与 --host-eval 那条路
// 逐字节相同。
//
// 表示上的选择写在 self/eval.hmoca 的文件里：区与块都用索引，因为记录不可变，而
// 「close 之后块就死了」是一件要变的事。所以这里不去看内部（那是实现的自由），
// 只看读数与判词。
//
// 一条要紧的互相印证：close 之后读一块没交出去的块，静态检查会拦（R0301）。
// 用 --no-zone-check 放过去，就能看见运行期真的把那块标成死的 —— 于是「拦的不是
// 想象出来的错」这句话有了证据，而不是靠相信。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 具 = path.join(ROOT, "bin", "hmyr.mjs");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-zself-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 行们 = (v) => v.join("\n") + "\n";
const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
const 跑 = (参) => spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd: 临, timeout: 300000 });
const 行 = (s) => String(s || "").split("\n").map((x) => x.trimEnd()).filter((x) => x.length > 0);

console.log("一、区在自举层是真的：建、分、数");
{
  const p = 投(行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(16)",
    "  print(\"zone=\" + b.zone + chr(10))",
    "  print(\"size=\" + str(b.size) + chr(10))",
    "  print(\"held=\" + str(a.held()) + chr(10))",
    "  return 0",
    "}",
  ]), "甲.hmoca");
  const r = 跑([p]);
  const 出 = 行(r.stdout);
  ok("跑得动", r.status === 0, JSON.stringify({ status: r.status, err: (r.stderr || "").slice(0, 120) }));
  ok("块的区是 arena", 出.includes("zone=arena"), JSON.stringify(出));
  ok("大小照给的数", 出.includes("size=16"), JSON.stringify(出));
  ok("记账里有一块", 出.includes("held=1"), JSON.stringify(出));
}

console.log("二、freeze 交出去：区名换、账减一，而 close 不再带走它");
{
  const p = 投(行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  a.freeze(b)",
    "  print(\"zone=\" + b.zone + chr(10))",
    "  print(\"held=\" + str(a.held()) + chr(10))",
    "  a.close()",
    "  print(\"live=\" + str(b.live) + chr(10))",
    "  return 0",
    "}",
  ]), "乙.hmoca");
  const r = 跑([p]);
  const 出 = 行(r.stdout);
  ok("区名换成 managed", 出.includes("zone=managed"), JSON.stringify(出));
  ok("账减到零", 出.includes("held=0"), JSON.stringify(出));
  ok("arena 关了它仍然活着", 出.includes("live=1"), JSON.stringify(出));
}

console.log("三、close 带走没交出去的那些 —— 而这件事只在放行时才看得见");
{
  // 同一个程序，两种跑法：带检查时被 NODE 之前那一层拦住；放行之后运行期读数才对。
  const 源 = 行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  let c = a.alloc(8)",
    "  a.close()",
    "  print(\"live=\" + str(c.live) + chr(10))",
    "  return 0",
    "}",
  ]);
  const p = 投(源, "丙.hmoca");

  const 严 = 跑([p]);
  ok("带检查时被拦住", 严.status !== 0 && (严.stderr || "").includes("HMYR-R0301"),
    JSON.stringify({ status: 严.status, err: (严.stderr || "").slice(0, 120) }));

  const 松 = 跑(["--no-zone-check", p]);
  const 出 = 行(松.stdout);
  ok("放行之后跑到底", 松.status === 0, JSON.stringify({ status: 松.status, out: (松.stdout || "").slice(0, 120) }));
  // 这一条是「拦的是真的」的证据：放行之后读到的是 0，即那块真的死了。
  ok("而块真的死了（live=0）", 出.includes("live=0"), JSON.stringify(出));
}

console.log("四、走错的两个编号，在自举层也说得出");
{
  const 关后分 = 投(行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  a.close()",
    "  let b = a.alloc(8)",
    "  print(\"ok\" + chr(10))",
    "  return 0",
    "}",
  ]), "丁.hmoca");
  const r = 跑([关后分]);
  ok("关掉的区再分配给 R0302", (r.stdout || "").includes("HMYR-R0302"), JSON.stringify((r.stdout || "").slice(0, 140)));

  const 交两次 = 投(行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  a.freeze(b)",
    "  a.freeze(b)",
    "  return 0",
    "}",
  ]), "戊.hmoca");
  const r2 = 跑([交两次]);
  ok("交出去两次给 R0302", (r2.stdout || "").includes("HMYR-R0302"), JSON.stringify((r2.stdout || "").slice(0, 140)));

  const 收回没交出 = 投(行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(8)",
    "  a.adopt(b)",
    "  return 0",
    "}",
  ]), "己.hmoca");
  const r3 = 跑([收回没交出]);
  ok("收回一块没交出的给 R0303", (r3.stdout || "").includes("HMYR-R0303"), JSON.stringify((r3.stdout || "").slice(0, 140)));
}

console.log("五、两台机器（默认与 --host-eval）跑出同一段");
{
  const p = 投(行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(16)",
    "  let c = a.alloc(8)",
    "  print(\"zone=\" + b.zone + \" size=\" + str(b.size) + chr(10))",
    "  print(\"held=\" + str(a.held()) + chr(10))",
    "  a.freeze(b)",
    "  print(\"held=\" + str(a.held()) + chr(10))",
    "  print(\"c.live=\" + str(c.live) + chr(10))",
    "  a.close()",
    "  print(\"b.live=\" + str(b.live) + chr(10))",
    "  return 0",
    "}",
  ]), "庚.hmoca");
  const 甲 = 跑([p]);
  const 乙 = 跑(["--host-eval", p]);
  ok("两边都跑得动", 甲.status === 0 && 乙.status === 0,
    JSON.stringify({ a: 甲.status, b: 乙.status, err: (乙.stderr || "").slice(0, 120) }));
  ok("输出逐字相同", (甲.stdout || "") === (乙.stdout || ""),
    JSON.stringify([(甲.stdout || "").slice(0, 160), (乙.stdout || "").slice(0, 160)]));
  ok("而且账是对的", 行(甲.stdout).filter((x) => x === "held=1").length === 1,
    JSON.stringify(行(甲.stdout)));
}

console.log("六、字节码那台也跑得动（--compile），与解释那台逐行相同");
{
  // 到 2026-10-26 为止，字节码编译器对 a.alloc(16) 的回答是「只认按名字调用」——
  // 于是区只有解释那两条路能跑。CALLM 接上之后，这里验的是第三台机器。
  // 比的是「解释那台的前若干行」：解释面会把 main 的返回值也打出来，而 --compile 面不打，
  // 那是两条面一直以来的显示差别，不是这一轮的东西。
  const p = 投(行们([
    "fn main() -> Int {",
    "  let a = arena()",
    "  let b = a.alloc(16)",
    "  let c = a.alloc(8)",
    "  print(\"zone=\" + b.zone + \" size=\" + str(b.size) + chr(10))",
    "  print(\"held=\" + str(a.held()) + chr(10))",
    "  a.freeze(b)",
    "  print(\"held=\" + str(a.held()) + chr(10))",
    "  print(\"c.live=\" + str(c.live) + chr(10))",
    "  a.close()",
    "  print(\"b.live=\" + str(b.live) + chr(10))",
    "  return 0",
    "}",
  ]), "辛.hmoca");
  const 释 = 跑([p]);
  const 编 = 跑(["--compile", p]);
  const 释行 = 行(释.stdout), 编行 = 行(编.stdout);
  ok("--compile 跑得动", 编.status === 0, JSON.stringify({ status: 编.status, err: (编.stderr || "").slice(0, 140) }));
  ok("而且它打出了同一段", 编行.length > 0 && JSON.stringify(编行) === JSON.stringify(释行.slice(0, 编行.length)),
    JSON.stringify([编行, 释行.slice(0, 编行.length)]));
}

console.log("七、C 那台也认得区（要 gcc 编一次）");
{
  // C 那台的启动器给源码时先用内置种子编，再跑 —— 所以这一节走的是「种子 → 字节码 → 机器」整条链。
  // 它比的是与字节码机逐行相同：那两台跑的是同一份字节码，分派却各写了一份。
  const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc —— C 那台那一侧不验");
  } else {
    const exe = path.join(临, "hmyr-c.exe");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe,
      path.join(ROOT, "vm", "hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", 编.status === 0, String(编.stderr || "").slice(0, 160));

    const p = 投(行们([
      "fn main() -> Int {",
      "  let a = arena()",
      "  let b = a.alloc(16)",
      "  let c = a.alloc(8)",
      "  print(\"zone=\" + b.zone + \" size=\" + str(b.size) + chr(10))",
      "  print(\"held=\" + str(a.held()) + chr(10))",
      "  a.freeze(b)",
      "  print(\"held=\" + str(a.held()) + chr(10))",
      "  print(\"c.live=\" + str(c.live) + chr(10))",
      "  a.close()",
      "  print(\"b.live=\" + str(b.live) + chr(10))",
      "  return 0",
      "}",
    ]), "壬.hmoca");

    const 机 = 跑(["--compile", p]);
    const 台 = spawnSync(exe, [p], {
      encoding: "utf8", cwd: 临, timeout: 300000,
      env: { ...process.env, HMYR_MEM_LIMIT: "0", HMYR_STEPS: "4000000000" },
    });
    ok("C 那台跑得动", 台.status === 0, JSON.stringify({ status: 台.status, err: (台.stderr || "").slice(0, 200) }));
    ok("而且与字节码机逐行相同", JSON.stringify(行(台.stdout)) === JSON.stringify(行(机.stdout)),
      JSON.stringify([行(台.stdout), 行(机.stdout)]));
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
