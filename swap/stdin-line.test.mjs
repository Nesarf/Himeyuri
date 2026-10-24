// 读标准输入的一行：read_stdin_line 那一格，以及用它写的 cat。
//
// 这一格存在的理由是 LSP：那类程序要「读到没有为止」，所以「读到一行」与
// 「没有更多了」必须是两件事 —— 都塞进空串里就分不清了。
// 所以内置交回一个记录 {行, 结束}，而这条验收盯的正是这两件事分得清。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../tools/self-bridge.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、这一格在六处都有");
{
  const 源 = [
    "src/eval.mjs", "src/minimal-eval.mjs", "src/vm-builtins.mjs",
    "src/bytecode.mjs", "self/eval.hmyr", "vm/hmyr.c",
  ];
  const 名们 = ["read_stdin_line", "read_stdin_bytes", "bytes_to_text"];
  for (const f of 源) {
    const 文 = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const 名 of 名们) ok(f + " 认识 " + 名, 文.includes(名), "");
  }
}

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("二、cat 用这一格读 stdin");
const 源路 = path.join(ROOT, "self/cat.hmyr");
ok("self/cat.hmyr 在", fs.existsSync(源路));
const unit = loadUnit(源路);
ok("加载没有诊断", unit.ok, JSON.stringify(unit.diagnostics.errors.slice(0, 1).map((e) => e.code)));

console.log("三、喂进去什么，原样出来什么");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-stdin-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
  if (c.status === 0) {
    const 码路 = path.join(临, "cat.hmyrb");
    fs.writeFileSync(码路, 写程序(合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))))));
    const 试 = (输入) => spawnSync(exe, [码路], {
      input: 输入, encoding: "utf8", timeout: 120000,
      env: { ...process.env, HMYR_STEPS: "2000000000" },
    });
    const 甲乙 = 试("一\n二\n三\n");
    ok("三行原样出来", 甲乙.status === 0 && String(甲乙.stdout) === "一\n二\n三\n", JSON.stringify(String(甲乙.stdout)));
    const 丙 = 试("x\n\nz");
    ok("空行留得住、末行没有换行也读得到", String(丙.stdout) === "x\n\nz\n", JSON.stringify(String(丙.stdout)));
    const 丁 = 试("");
    ok("一行也没有时什么都不写", 丁.status === 0 && String(丁.stdout) === "", JSON.stringify(String(丁.stdout)));

    console.log("四、读 N 个字节：够与不够");
    {
      // 请求体未必只有一行，所以长度单独一格：读头拿长度、按长度读体，两步。
      const 源 = [
        "fn main() -> Int {",
        "  let r = read_stdin_bytes(5)",
        '  print(bytes_to_text(r.字节们) + " ")',
        "  print(str(r.结束) + chr(10))",
        "  return 0",
        "}",
      ].join("\n");
      const 源路2 = path.join(临, "bytes.hmyr");
      fs.writeFileSync(源路2, 源, "utf8");
      const u2 = loadUnit(源路2);
      ok("读字节那一段加载得动", u2.ok, JSON.stringify(u2.diagnostics.errors.slice(0, 1).map((e) => e.code)));
      const 码路2 = path.join(临, "bytes.hmyrb");
      fs.writeFileSync(码路2, 写程序(合并程序(u2.order.map((文件) => 编译模块(u2.modules.get(文件))))));
      const 甲2 = spawnSync(exe, [码路2], { input: "hello", encoding: "utf8", timeout: 120000, env: { ...process.env, HMYR_STEPS: "2000000000" } });
      ok("五个字节读满，解回原文，结束是假", String(甲2.stdout) === "hello false\n", JSON.stringify(String(甲2.stdout)));
      const 乙2 = spawnSync(exe, [码路2], { input: "hi", encoding: "utf8", timeout: 120000, env: { ...process.env, HMYR_STEPS: "2000000000" } });
      ok("不足五个字节，解回前两个，结束是真", String(乙2.stdout) === "hi true\n", JSON.stringify(String(乙2.stdout)));
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
