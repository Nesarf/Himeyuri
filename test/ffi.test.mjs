// FFI 的最小形状：一段不拷贝的窗口（design/FFI.txt 第四节）。
//
// 三个答案的可执行形状就是这三个内置：
//   谁分配    窗口不分配 —— 它记着源、起、长
//   谁释放    语言这一侧；窗口的有效期就是那次调用
//   怎么过界  窗口是字节不是字符串，所以没有隐式编码
//
// 这一套验四件事：
//   一、长度与读值都对
//   二、越界给 R0151（两端都试：负数与大过头）
//   三、类型不对给 R0152（拿非字节去建窗口）
//   四、三台一致（默认、--host-eval、--compile）
//
// 一条判据做不到，写在这里而不是让它空着：元组是不可变的，所以「改原处、
// 窗口看到新值」这一测没有对象。能验的是「窗口读出来的就是源上那一段」——
// 那是转发的证据，不是零分配的证据。零分配这一条只能从实现上说明。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 具 = path.join(ROOT, "bin", "hmyr.mjs");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ffi-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 行们 = (v) => v.join("\n") + "\n";
const 投 = (内容, 名) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };
const 跑 = (参) => spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd: 临, timeout: 300000 });
const 行 = (s) => String(s || "").split("\n").map((x) => x.trimEnd()).filter((x) => x.length > 0);

console.log("一、长度与读值");
{
  const p = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 源 = (10, 11, 12, 13, 14)",
    "  let 窗 = bytes_view(源, 1, 3)",
    "  print(\"长=\" + str(view_len(窗)) + chr(10))",
    "  print(\"取0=\" + str(view_get(窗, 0)) + chr(10))",
    "  print(\"取2=\" + str(view_get(窗, 2)) + chr(10))",
    "  return 0",
    "}",
  ]), "甲.hmoca");
  const r = 跑([p]);
  const 出 = 行(r.stdout);
  ok("跑得动", r.status === 0, JSON.stringify({ status: r.status, err: (r.stderr || "").slice(0, 160) }));
  ok("长度是三", 出.includes("长=3"), JSON.stringify(出));
  ok("第一个是源的第 1 个（11）", 出.includes("取0=11"), JSON.stringify(出));
  ok("第三个是源的第 3 个（13）", 出.includes("取2=13"), JSON.stringify(出));
}

console.log("二、越界给 R0151（两端）");
{
  const 过头 = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 源 = (1, 2, 3)",
    "  let 窗 = bytes_view(源, 1, 5)",
    "  print(\"没有拦住\" + chr(10))",
    "  return 0",
    "}",
  ]), "乙.hmoca");
  const r1 = 跑([过头]);
  const 出1 = (r1.stdout || "") + (r1.stderr || "");
  ok("建立时越界给 R0151", 出1.includes("HMYR-R0151") && !出1.includes("没有拦住"), JSON.stringify(出1.slice(0, 160)));

  const 读过头 = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 源 = (1, 2, 3)",
    "  let 窗 = bytes_view(源, 0, 2)",
    "  print(str(view_get(窗, 2)) + chr(10))",
    "  return 0",
    "}",
  ]), "丙.hmoca");
  const r2 = 跑([读过头]);
  const 出2 = (r2.stdout || "") + (r2.stderr || "");
  ok("读取时越界给 R0151", 出2.includes("HMYR-R0151"), JSON.stringify(出2.slice(0, 160)));

  const 负 = 投(行们([
    "fn main() -> Int effects(process) {",
    "  let 源 = (1, 2, 3)",
    "  let 窗 = bytes_view(源, 0 - 1, 2)",
    "  print(\"没有拦住\" + chr(10))",
    "  return 0",
    "}",
  ]), "丁.hmoca");
  const r3 = 跑([负]);
  const 出3 = (r3.stdout || "") + (r3.stderr || "");
  ok("负的起点也给 R0151", 出3.includes("HMYR-R0151") && !出3.includes("没有拦住"), JSON.stringify(出3.slice(0, 160)));
}

console.log("三、三台一致");
{
  // 注意：--compile 那一面把 main 的返回值当退出码，不打那一行。所以比的是前缀。
  const p = path.join(临, "甲.hmoca");
  const 基准 = 行(跑([p]).stdout);
  const 甲 = 跑(["--host-eval", p]);
  ok("--host-eval 同一段", JSON.stringify(行(甲.stdout)) === JSON.stringify(基准),
    JSON.stringify([行(甲.stdout), 基准]));
  const 乙 = 跑(["--compile", p]);
  const 乙行 = 行(乙.stdout);
  ok("--compile 同一段", 乙.status === 0 && JSON.stringify(乙行) === JSON.stringify(基准.slice(0, 乙行.length)),
    JSON.stringify([乙行, 基准.slice(0, 乙行.length)]));
}

// 一条判据这里做不到，写出来而不是让它空着：
// 类型不对（拿数字去建窗口）那一侧，三台不一致 —— 自举层的 len() 对数字先报底层的
// 「len() wants a string or a tuple」，走不到 R0152。要统一，得给自举层一个
// 「这个值能不能取长」的判定，而那是一件单独的事。

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
