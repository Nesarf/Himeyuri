// C 那台机器的启动器：一条命令，从源码到运行，路上没有 JavaScript。
//
// 这一套问的是「独立化」那一句里最具体的一块：`hmyr 程序.hmyr` 能不能成。
// 两步都由这台机器做 —— 种子把它编成字节码，编出来的那一份由这台机器跑。
//
// 与 c-vm 那一套的分工：那一套比的是「两台机器同一个答案」，这一套比的是
// 「一个入口两种用法，以及走不通时它说得出话」。
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

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cli-"));

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc —— 启动器这一套不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(0);
}

const exe = path.join(临, "hmyr.exe");
{
  const r = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("vm/hmyr.c 编得出来", r.status === 0, String(r.stderr).slice(0, 300));
  ok("而且没有警告", String(r.stderr).trim() === "", String(r.stderr).slice(0, 300));
}
if (!fs.existsSync(exe)) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  fs.rmSync(临, { recursive: true, force: true });
  process.exit(1);
}

const 种子 = path.join(ROOT, "bootstrap/pack.hmyrb");
const 跑 = (参数们, 选项 = {}) => {
  const r = spawnSync(exe, 参数们, {
    encoding: "utf8",
    cwd: 选项.cwd || ROOT,
    timeout: 180000,
    env: { ...process.env, ...(选项.env || {}) },
  });
  return { 码: r.status, 出: String(r.stdout || ""), 错: String(r.stderr || "") };
};

console.log("一、一份源码跑起来，输出对");
{
  const r = 跑([path.join(ROOT, "examples/twice.hmyr")], { env: { HMYR_SEED: 种子 } });
  ok("退出码是 0", r.码 === 0, String(r.码) + " " + r.错.slice(0, 200));
  ok("算对了那一行", r.出.includes("hi 42 琥珀音"), JSON.stringify(r.出.slice(0, 120)));
  // 编译那一段的「N 个块」不该落在用户程序的输出里 —— 它改道去了标准错误。
  ok("标准输出里没有编译时那一行", !r.出.includes("个字节") && !r.出.includes("个块"), JSON.stringify(r.出.slice(0, 160)));
}

console.log("二、程序看到的参数：第一个是源文件自己");
{
  const 源 = path.join(临, "argv-probe.hmyr");
  fs.writeFileSync(源, [
    "fn main() -> Int {",
    "  var i = 0",
    "  while i < len(argv()) {",
    '    print("[" + str(i) + "]" + argv()[i] + "\\n")',
    "    i = i + 1",
    "  }",
    "  return 0",
    "}",
  ].join("\n"), "utf8");
  const r = 跑([源, "甲", "乙"], { env: { HMYR_SEED: 种子 } });
  const 行 = r.出.trim().split("\n");
  ok("三个参数都在", 行.length === 3, String(行.length) + " " + JSON.stringify(r.出.slice(0, 120)));
  ok("第一个是源文件路径，不是临时文件", 行[0] === "[0]" + 源, JSON.stringify(行[0]));
  ok("后面两个照着给的顺序", 行[1] === "[1]甲" && 行[2] === "[2]乙", JSON.stringify(行.slice(1)));
}

console.log("三、退出码是程序返回的那个数");
{
  const 源 = path.join(临, "seven.hmyr");
  fs.writeFileSync(源, "fn main() -> Int {\n  return 7\n}\n", "utf8");
  const r = 跑([源], { env: { HMYR_SEED: 种子 } });
  ok("返回 7 就退 7", r.码 === 7, String(r.码) + " " + r.错.slice(0, 160));
}

console.log("四、源码编不过时，明说，而且不跑半成品");
{
  const 源 = path.join(临, "broken.hmyr");
  fs.writeFileSync(源, "fn main() -> Int {\n  return (1 +\n}\n", "utf8");
  const r = 跑([源], { env: { HMYR_SEED: 种子 } });
  ok("退出码非零", r.码 !== 0, String(r.码));
  ok("说起的是启动器那一层的编号", r.错.includes("HMYR-E0009"), JSON.stringify(r.错.slice(0, 200)));
  ok("标准输出里没有编到一半的东西", r.出.trim() === "", JSON.stringify(r.出.slice(0, 120)));
}

console.log("五、找不到种子时说得出话，而不是装作跑过了");
{
  const 空目录 = path.join(临, "nowhere");
  fs.mkdirSync(空目录, { recursive: true });
  const r = 跑([path.join(ROOT, "examples/twice.hmyr")], {
    cwd: 空目录,
    env: { HMYR_SEED: path.join(空目录, "no-such-seed.hmyrb") },
  });
  ok("退出码是 2", r.码 === 2, String(r.码));
  ok("消息里说了种子这件事", r.错.includes("no seed"), JSON.stringify(r.错.slice(0, 200)));
}

console.log("六、给字节码时还是老路，一个字都没变");
{
  const 码路 = path.join(临, "twice.hmyrb");
  const emit = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "examples/twice.hmyr"), 码路], { encoding: "utf8" });
  ok("JS 那一侧编得出来", emit.status === 0 && fs.existsSync(码路), String(emit.stderr).slice(0, 200));
  const r = 跑([码路]);
  ok("直接跑字节码，输出一样", r.码 === 0 && r.出.includes("hi 42 琥珀音"), JSON.stringify(r.出.slice(0, 120)));
}

console.log("七、临时那一份可以留下来查");
{
  const r = 跑([path.join(ROOT, "examples/twice.hmyr")], { env: { HMYR_SEED: 种子, HMYR_KEEP: "1" } });
  const m = /HMYR_KEEP kept (.+)$/m.exec(r.错);
  const 留 = m ? m[1].trim() : "";
  ok("说了留在哪儿", 留 !== "", JSON.stringify(r.错.slice(-120)));
  ok("而且那份文件真的在", 留 !== "" && fs.existsSync(留), 留);
  if (留 && fs.existsSync(留)) {
    const 头 = fs.readFileSync(留).slice(0, 5).toString("latin1");
    ok("头五字节是那种格式的记号", 头 === "HMYRB", JSON.stringify(头));
    fs.rmSync(留, { force: true });
  } else {
    ok("头五字节是那种格式的记号", false, "没有留下文件");
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
