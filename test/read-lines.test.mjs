// 按行读：语言里没有文件句柄，所以入口是「偏移 + 交回下一处」。
//
// 为什么这一条值得一套：read_text 一次读整份，大文件要把整份读进内存。
// 而这一门语言没有句柄类型、也没有「用完要关」的机制，所以真正的流式读只能长成
// 「给一个偏移，读一行，交回下一处从哪开始」—— 调用者可以按自己的节奏一段一段读，
// 而每一次调用自己开、自己关，语义是封闭的。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-lines-"));
const 路 = path.join(临, "三行.txt").replace(/\\/g, "/");
// 故意混一个 CRLF：两种换行该读成一样的行。
fs.writeFileSync(路, "alpha\nbeta\r\ngamma\n", "utf8");
const 空路 = path.join(临, "空.txt").replace(/\\/g, "/");
fs.writeFileSync(空路, "", "utf8");

console.log("一、一行一行往下读，偏移自己接");
{
  const 源码 = [
    "fn main() -> Int effects(file) {",
    "  var 起 = 0",
    "  var 走 = true",
    "  while 走 {",
    "    let 读 = read_line(" + JSON.stringify(路) + ", 起)",
    "    if 读.下一起点 < 0 {",
    "      走 = false",
    '      print("（完）")',
    "    } else {",
    "      print(读.行)",
    '      print("|")',
    "      起 = 读.下一起点",
    "    }",
    "  }",
    "  return 0",
    "}",
  ].join("\n");
  const 源路 = path.join(临, "walk.hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const 码路 = path.join(临, "walk.hmyrb");
  const 编 = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), 源路, 码路], { encoding: "utf8" });
  ok("走读的那个程序编得出来", 编.status === 0, String(编.stderr).slice(0, 140));
  if (fs.existsSync(码路)) {
    const 跑 = spawnSync(process.execPath, [path.join(ROOT, "tools/run-bytecode.mjs"), 码路], { encoding: "utf8" });
    const 出 = String(跑.stdout || "").trim();
    ok("三行按顺序读出来，CRLF 与 LF 一样", 出 === "alpha|beta|gamma|（完）", JSON.stringify(出.slice(0, 60)));
  }
}

console.log("二、在真正的程序里按行读（两台机器）");
{
  const 源码 = [
    "fn 数行(p: String) -> Int effects(file) {",
    "  var 起 = 0",
    "  var 数 = 0",
    "  var 走 = true",
    "  while 走 {",
    "    let 读 = read_line(p, 起)",
    "    if 读.下一起点 < 0 {",
    "      走 = false",
    "    } else {",
    "      数 = 数 + 1",
    "      起 = 读.下一起点",
    "    }",
    "  }",
    "  return 数",
    "}",
    "fn main() -> Int effects(file) {",
    "  print(str(数行(" + JSON.stringify(路) + ")))",
    "  print(\" \")",
    "  print(str(len(read_lines(" + JSON.stringify(路) + "))))",
    '  print(" ")',
    '  print(read_lines(' + JSON.stringify(路) + ')[1])',
    "  return 0",
    "}",
  ].join("\n");
  const 源路 = path.join(临, "count.hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const 码路 = path.join(临, "count.hmyrb");
  const 编 = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), 源路, 码路], { encoding: "utf8" });
  ok("这个程序编得出来", 编.status === 0, String(编.stderr).slice(0, 140));
  if (fs.existsSync(码路)) {
    // JS 那台
    const 跑 = spawnSync(process.execPath, [path.join(ROOT, "tools/run-bytecode.mjs"), 码路], { encoding: "utf8" });
    ok("JS 那台数出 3 行", String(跑.stdout || "").startsWith("3 3 beta"), JSON.stringify(String(跑.stdout || "").slice(0, 60)));
    // C 那台
    const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
    if (!有gcc) {
      console.log("  跳过  这台机器上没有 gcc");
    } else {
      const exe = path.join(临, "vm.exe");
      const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
      ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
      if (c.status === 0) {
        const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 120000 });
        ok("C 那台也数出 3 行，且 CRLF 与 LF 读成一样的", String(r.stdout || "").startsWith("3 3 beta"),
          String(r.status) + " " + JSON.stringify(String(r.stdout || "").slice(0, 60)));
      }
    }
  }
}

console.log("三、空文件与末尾换行");
{
  const 源码 = [
    "fn main() -> Int effects(file) {",
    "  print(str(len(read_lines(" + JSON.stringify(空路) + "))))",
    '  print(" ")',
    "  let 读 = read_line(" + JSON.stringify(空路) + ", 0)",
    "  print(str(读.下一起点))",
    "  return 0",
    "}",
  ].join("\n");
  const 源路 = path.join(临, "empty.hmyr");
  fs.writeFileSync(源路, 源码, "utf8");
  const 码路 = path.join(临, "empty.hmyrb");
  const 编 = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), 源路, 码路], { encoding: "utf8" });
  if (编.status === 0) {
    const 跑 = spawnSync(process.execPath, [path.join(ROOT, "tools/run-bytecode.mjs"), 码路], { encoding: "utf8" });
    ok("空文件读成 0 行，且没有下一处", String(跑.stdout || "").trim() === "0 -1", JSON.stringify(String(跑.stdout || "").slice(0, 40)));
  } else {
    ok("空文件那个程序编得出来", false, String(编.stderr).slice(0, 120));
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
