// 校验和（CRC32）的验收：三处实现给同一个值，且与 node 的 crc32 对得上。
//
// 这一条是 ZIP 能互通的地基：两个包工具算出的 CRC 若不同，同一个文件在两个包里的
// 校验字段就不同 —— 那种不一致不会报错，只会让「包与源一致」这句话失去意义。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-crc-"));
const 样本 = path.join(临, "样本.txt");
fs.writeFileSync(样本, "琥珀音 kohane\n");
const 空 = path.join(临, "空.txt");
fs.writeFileSync(空, "");

const 程序 = [
  "fn main() -> Int effects(file, process) {",
  "  let 参 = argv()",
  "  if len(参) < 2 { return 2 }",
  "  let 字节 = read_bytes(参[1])",
  "  print(str(校验和(字节)) + chr(10))",
  "  print(str(校验和(())) + chr(10))",
  "  print(str(校验和(((1, 2), (3, 4)))) + chr(10))",
  "  print(str(校验和((1, 2, 3, 4))) + chr(10))",
  "  return 0",
  "}",
].join("\n") + "\n";
const 程序路 = path.join(临, "probe.hmyr");
fs.writeFileSync(程序路, 程序, "utf8");

// 期望值全部由 node 算：文件本身的 CRC、空串的 0、四个字节的 CRC。
const 应文件 = zlib.crc32(fs.readFileSync(样本));
const 应四字节 = zlib.crc32(Buffer.from([1, 2, 3, 4]));
const 期望行们 = [String(应文件), "0", String(应四字节), String(应四字节)];

console.log("一、宿主解释器");
const 层 = loadUnit(程序路);
ok("程序读得动", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
let 出A = "";
const rt = runUnit(层, { write: (t) => { 出A += t; }, capabilities: 本机能力() });
rt.argv = ["hmyr", 样本];
const 码A = rt.callFunction(rt.functions.get("main"), [], null);
ok("退出码 0", 码A === 0, String(码A));
{
  const 行们 = 出A.trim().split("\n");
  ok("文件的 CRC 与 node 一致", 行们[0] === 期望行们[0], 行们[0] + " 对 " + 期望行们[0]);
  ok("空元组的 CRC 是 0", 行们[1] === "0", 行们[1]);
  ok("分块与平铺给出同一个值", 行们[2] === 行们[3] && 行们[2] === 期望行们[2], 行们[2] + " / " + 行们[3]);
}

console.log("二、字节码机器");
{
  const 出 = [];
  const vm = 跑字节码(层, { write: (t) => 出.push(t), writeErr: () => {}, argv: ["hmyr", 样本], capabilities: 本机能力(), stepLimit: 2000000 });
  const r = vm.调用("main", [], null);
  ok("退出码 0", r.ok, r.ok ? "" : r.码 + " " + r.话);
  ok("与解释器逐字相同", 出.join("").trim() === 出A.trim(), JSON.stringify(出.join("").slice(0, 120)));
}

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("三、C 那一台");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const exe = path.join(临, "hmyr.exe");
  const g = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", g.status === 0, String(g.stderr || "").slice(0, 160));
  if (g.status === 0) {
    const 码路 = path.join(临, "probe.hmyrb");
    const e = spawnSync("node", ["tools/emit-code.mjs", 程序路, 码路], { cwd: ROOT, encoding: "utf8" });
    ok("字节码落盘", e.status === 0 && fs.existsSync(码路), String(e.stderr || "").slice(0, 160));
    if (e.status === 0) {
      const r = spawnSync(exe, [码路, 样本], { encoding: "utf8" });
      ok("C 那台退出码 0", r.status === 0, String(r.stderr || "").slice(0, 160));
      ok("C 那台与另两台逐字相同", String(r.stdout || "").trim() === 出A.trim(), JSON.stringify(String(r.stdout || "").slice(0, 120)));
      // 空文件：CRC 也应当是 0（空串的 CRC 就是 0，不是 0xFFFFFFFF）。
      const r空 = spawnSync(exe, [码路, 空], { encoding: "utf8" });
      ok("空文件的 CRC 是 0", String(r空.stdout || "").split("\n")[0].trim() === "0", JSON.stringify(String(r空.stdout || "").slice(0, 40)));
    }
  }
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
