// 板子上那条路，在桌面上走一遍。
//
// 板子那一侧没有硬件，但这条路里除硬件以外的每一段都能在桌面上验：
// 字节码在内存里 → 板子装上 交给平台口 → hmyr_运行 跑它 → 输出进缓冲。
// 这里断言的就是那段缓冲里的内容，以及退出码。
//
// 与 c-vm 那一套的分工：c-vm 比的是「两台机器同一个答案」；这一套比的是
// 「平台口接上之后，机器还能不能跑」—— 也就是移植那一侧的接线对不对。
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

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-board-"));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— 板子那一路的自检不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(0);
}

const exe = path.join(临, "board-check.exe");
{
  // -DHMYR_LIB 去掉 hmyr.c 里的 main（板子上不该有它，这里也一样）；
  // 去掉 main 之后那几个启动器函数没有调用者，所以关掉那条警告 ——
  // 它们不是死代码，只是在这一种编译形态下用不到。
  const r = spawnSync("gcc", [
    "-std=c11", "-O2", "-Wall", "-Wno-unused-function", "-Wl,--stack,67108864",
    "-DHMYR_LIB", "-o", exe,
    path.join(ROOT, "port/board-check.c"),
    path.join(ROOT, "port/arm-port.c"),
    path.join(ROOT, "vm/hmyr.c"),
    "-lm",
  ], { encoding: "utf8" });
  ok("板子那一路编得出来", r.status === 0, String(r.stderr).slice(0, 300));
}

if (!fs.existsSync(exe)) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(1);
}

console.log("一、一段字节码，从内存里进去，从缓冲里出来");
{
  const 码路 = path.join(临, "twice.hmyrb");
  const emit = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "examples/twice.hmyr"), 码路], { encoding: "utf8" });
  ok("先编出一份字节码", emit.status === 0 && fs.existsSync(码路), String(emit.stderr).slice(0, 200));

  const r = spawnSync(exe, [码路], { encoding: "utf8", timeout: 120000 });
  const 出 = String(r.stdout || "");
  const 错 = String(r.stderr || "");
  ok("程序跑出了该有的那一行", 出.includes("hi 42 琥珀音"), JSON.stringify(出.slice(0, 120)));
  ok("退出码是程序的返回值", 出.includes("exit 0"), JSON.stringify(出.slice(-40)));
  ok("出口是那块缓冲，长度对得上", /出口 15 字节/.test(错), JSON.stringify(错.slice(0, 80)));
}

console.log("二、平台口真的被装上了（不装会退回桌面实现，输出就进不了缓冲）");
{
  const 源 = fs.readFileSync(path.join(ROOT, "port/board-check.c"), "utf8");
  ok("自检调了 板子装上", 源.includes("板子装上("));
  ok("然后调的是图书馆入口 hmyr_运行", 源.includes("hmyr_运行("));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
