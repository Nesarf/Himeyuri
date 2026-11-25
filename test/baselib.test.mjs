// 基础库的判据：四样各一条，加一条「判据自己会红」。
//
// 为什么形状先于判据、判据先于实现：design/BASELIB.txt 先把宿主形状定了
// （分配、串、文件、退出 —— 不实现 JS 语义），这一份就照着那个形状量。每一条
// 断言都对应 BASELIB.txt 里的一句，不是随手写的例子。
//
// 编译用 g++：这个仓库到 2026-11-17 为止全是 C11（gcc），这是第一个 C++ 的
// 消费者。接口在 baselib.h 里 extern "C"，所以两边将来可以互相调。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baselib-"));

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 有gpp = (() => {
  try { return spawnSync("g++", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有gpp) {
  console.log("  跳过 4 项：这台机器上没有 g++ —— 基础库那一套不运行");
} else {
  const 主源 = path.join(TMP, "main.cpp");
  const exe = path.join(TMP, "baselib-probe");
  fs.writeFileSync(主源, [
    '#include "baselib.h"',
    "#include <cstdio>",
    "",
    "int main() {",
    "  char *a = (char *)baselib_alloc(64);",
    "  a[0] = 'x'; a[63] = 'y';",
    "  if (!(a[0] == 'x' && a[63] == 'y')) { baselib_exit(1); }",
    "",
    "  size_t units = 0;",
    "  uint16_t *u = baselib_utf8_to_utf16(\"A\\u4E2D\\U0001F600\", &units);",
    "  if (!(units == 4 && u[0] == 0x41 && u[1] == 0x4E2D && u[2] == 0xD83D && u[3] == 0xDE00)) {",
    "    std::printf(\"str %zu %04x %04x %04x %04x\\n\", units, u[0], u[1], u[2], u[3]);",
    "    baselib_exit(2);",
    "  }",
    "",
    "  size_t n = 0;",
    "  uint8_t *b = baselib_read_file(\"probe.txt\", &n);",
    "  if (!(b && n == 5 && b[0] == 'h' && b[4] == 'o')) { baselib_exit(3); }",
    "",
    "  size_t m = 9;",
    "  uint8_t *c = baselib_read_file(\"no-such-file-xyz.txt\", &m);",
    "  if (!(c == NULL && m == 0)) { baselib_exit(4); }",
    "",
    "  std::printf(\"ok\");",
    "  baselib_exit(0);",
    "}",
    "",
  ].join("\n"), "utf8");

  const 编 = (主) => spawnSync("g++",
    ["-std=c++17", "-O2", "-Wall", "-I", path.join(ROOT, "baselib"), "-o", exe,
      path.join(ROOT, "baselib", "baselib.cpp"), 主],
    { encoding: "utf8" });

  console.log("一、编得通");
  const 编果 = 编(主源);
  ok("g++ -std=c++17 编得通", 编果.status === 0, String(编果.stderr).slice(0, 300));

  if (编果.status === 0) {
    console.log("二、四样都按 BASELIB.txt 的形状干活");
    fs.writeFileSync(path.join(TMP, "probe.txt"), "hello", "utf8");
    const 跑 = spawnSync(exe, [], { cwd: TMP, encoding: "utf8", timeout: 30000 });
    ok("分配、串（含代理对）、读文件、读不到的交回 NULL 与 0 —— 全过",
      跑.status === 0 && /ok/.test(跑.stdout || ""),
      "退出 " + 跑.status + " · " + String(跑.stdout).slice(0, 120) + String(跑.stderr).slice(0, 160));

    console.log("三、反向：改坏一个断言，这一套必须红");
    const 坏源 = path.join(TMP, "main-bad.cpp");
    fs.writeFileSync(坏源,
      fs.readFileSync(主源, "utf8").replace("n == 5", "n == 6"), "utf8");
    const 编坏 = 编(坏源);
    const 跑坏 = spawnSync(exe, [], { cwd: TMP, encoding: "utf8", timeout: 30000 });
    ok("把长度 5 改成 6 之后跑不通过（退出码 3）", 跑坏.status === 3,
      "退出 " + 跑坏.status + " · " + String(跑坏.stderr).slice(0, 120));
  }

  console.log("四、第一次互相调：vm 用 baselib 读文件");
  {
    // 一份小探针，自己打印 7 而不是靠 vm 打印返回值 —— 断言只看串口上的字节，
    // 与「两台机器同一个答案」那条路同一个口径。
    const 源 = path.join(TMP, "probe.hmoca");
    fs.writeFileSync(源, "fn main() -> Int {\n  print(\"7\" + chr(10))\n  return 0\n}\n", "utf8");
    const u = loadUnit(源);
    if (!u.ok) {
      ok("探针读得进", false, JSON.stringify(u.diagnostics.errors.map((e) => e.code)));
    } else {
      const 包 = 写程序(合并程序(
        u.order.map((f) => 编译模块(u.modules.get(f))),
        编译模块(u.modules.get(u.order[u.order.length - 1])),
      ));
      const 码路 = path.join(TMP, "probe.hmoks");
      fs.writeFileSync(码路, 包);

      // vm 不带 main 编成目标文件，baselib 两个 .cpp 用 g++ 编并链接它 ——
      // extern "C" 边界在这里第一次被真的用到：C 那台调 baselib_read_file，
      // 而两边各写各的语言，链接器要把它们接上。
      const o = path.join(TMP, "hmyr.o");
      const 编c = spawnSync("gcc", ["-std=c11", "-O2", "-DHMYR_NO_MAIN", "-c",
        path.join(ROOT, "vm/hmyr.c"), "-o", o], { encoding: "utf8" });
      const exe2 = path.join(TMP, "baselib-host");
      const 编cp = spawnSync("g++", ["-std=c++17", "-O2",
        "-I", path.join(ROOT, "baselib"), "-I", path.join(ROOT, "vm"),
        path.join(ROOT, "baselib", "baselib.cpp"),
        path.join(ROOT, "baselib", "baselib-platform.cpp"),
        o, "-o", exe2, "-lm"], { encoding: "utf8" });
      ok("vm（无 main）+ baselib 编得通、链得通",
        编c.status === 0 && 编cp.status === 0,
        String(编c.stderr).slice(0, 200) + String(编cp.stderr).slice(0, 200));

      if (编c.status === 0 && 编cp.status === 0) {
        const 跑2 = spawnSync(exe2, [码路], { cwd: TMP, encoding: "utf8", timeout: 60000 });
        ok("装了 baselib 平台的 vm 跑探针，串口上是 7",
          跑2.status === 0 && /7/.test(跑2.stdout || ""),
          "退出 " + 跑2.status + " · " + String(跑2.stdout).slice(0, 120) + String(跑2.stderr).slice(0, 200));
      }
    }
  }
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
