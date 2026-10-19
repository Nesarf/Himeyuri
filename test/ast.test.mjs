// AST 反射的验收：符号收得对，而不知道的位置就说不知道。
//
// 最后那一条是这一套的重点：参数在 AST 里不带行，于是它的 line 是 null。
// 一个会「用附近的数字填补空白」的工具比一个留空的工具更坏——
// 读的人分不出哪个是记下来的、哪个是猜出来的。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/ast-");
const 跑 = (...参) => spawnSync(process.execPath, [path.join(ROOT, "tools/ast.mjs"), ...参], { encoding: "utf8" });

try {
  const 好 = path.join(临, "good.hmyr");
  fs.writeFileSync(好, [
    "fn add(a: Int, b: Int) -> Int {",
    "  return a + b",
    "}",
    "",
    "fn main() -> Int {",
    "  let x = 1",
    "  let y = add(x, 2)",
    "  print(str(y))",
    "  return 0",
    "}",
  ].join("\n") + "\n", "utf8");

  console.log("一、符号收得到");
  {
    const r = 跑(好);
    ok("退出码零", r.status === 0, String(r.status));
    let 表 = null;
    try { 表 = JSON.parse(r.stdout); } catch (e) { 0; }
    ok("输出是一份 JSON", 表 !== null);
    if (表) {
      const 名 = 表.symbols.map((s) => s.name);
      ok("收了两个函数", 表.symbols.filter((s) => s.kind === "fn").length === 2, JSON.stringify(名));
      ok("收得到 add 与 main", 名.includes("add") && 名.includes("main"), JSON.stringify(名));
      ok("收得到参数 a 与 b", 名.includes("a") && 名.includes("b"), JSON.stringify(名));
      ok("收得到局部变量 x 与 y", 名.includes("x") && 名.includes("y"), JSON.stringify(名));
      ok("函数的行是对的", 表.symbols.find((s) => s.name === "main").line === 5, String(表.symbols.find((s) => s.name === "main").line));
      ok("类型名也收了", 表.symbols.some((s) => s.kind === "type" && s.name === "Int"));
    }
  }

  console.log("二、位置：行与列都有");
  {
    const r = 跑(好);
    const 表 = JSON.parse(r.stdout);
    const 参数们 = 表.symbols.filter((s) => s.kind === "param");
    ok("参数都在", 参数们.length === 2, String(参数们.length));
    // 参数曾经是唯一不知道自己在哪儿的节点。2026-10-19 补上了位置，
    // 于是这一条从「它是 null」变成了「它是对的」。
    ok("参数带上了行", 参数们.every((s) => typeof s.line === "number"), JSON.stringify(参数们.map((s) => s.line)));
    ok("参数带上了列", 参数们.every((s) => typeof s.column === "number"), JSON.stringify(参数们.map((s) => s.column)));
    const a = 参数们.find((s) => s.name === "a");
    // fn add(a：f1 n2 空格3 a4 d5 d6 (7 a8 —— 于是 a 在第 8 列。
    ok("a 在第 8 列", a && a.column === 8, a ? String(a.column) : "没找到");
    const 函数 = 表.symbols.find((s) => s.name === "add");
    ok("add 在第一列", 函数 && 函数.column === 1, 函数 ? String(函数.column) : "没找到");
    // 而拿不到位置时仍然留 null，不猜
    ok("拿不到就留 null，而 null 不是 0", 表.symbols.every((s) => s.column !== 0), JSON.stringify(表.symbols.filter((s) => s.column === 0).map((s) => s.name)));
  }

  console.log("三、按行筛");
  {
    const r = 跑(好, "--行", "1");
    ok("退出码零", r.status === 0, String(r.status));
    ok("说了这一行有几个符号", /第 1 行有 \d+ 个符号/.test(r.stdout), r.stdout.slice(0, 60));
    ok("而且列出了 add", r.stdout.includes("add"), r.stdout.slice(0, 200));
    const 空 = 跑(好, "--行", "99");
    ok("没有符号的行说零个，而不是报错", 空.status === 0 && 空.stdout.includes("0 个符号"), 空.stdout.slice(0, 60));
  }

  console.log("四、解析不了就说解析不了");
  {
    const 坏 = path.join(临, "bad.hmyr");
    fs.writeFileSync(坏, "fn main( {\n", "utf8");
    const r = 跑(坏);
    ok("退出码非零", r.status !== 0, String(r.status));
    ok("说了解析不了", (r.stderr || "").includes("解析不了"), (r.stderr || "").slice(0, 80));
    // 关键：它不该交出一份空符号表——那会让人以为文件里没东西。
    ok("而没有交出一份空表", (r.stdout || "").trim() === "", JSON.stringify(r.stdout).slice(0, 60));
  }

  console.log("五、没给文件就说要给");
  {
    const r = 跑();
    ok("退出码非零", r.status !== 0, String(r.status));
    ok("说清了怎么用", (r.stderr || "").includes("给一个文件"), (r.stderr || "").slice(0, 80));
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
