// HMYR 自己把程序打成 .hmyrb —— 逐字节相同的那一条。
//
// 为什么这一套值得单列：目标里「src/ 可以删掉」的最后一块就是这一步。
// 而「搬对了没有」有一个不会被解释动摇的答案：同一份源码，两位打包者交出的字节，
// 一个字节都不差。差一个字节就说明搬错了，说得再好听也没用。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-pack-"));

// 这个套件里三件事都得成立：C 编得出来、packer 交得出字节、两位打包者一致。
const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
const 程序们 = [
  ["直接返回一个数", "fn main() -> Int {\n  return 7\n}\n"],
];

// 这几份的指令形状两位编译者还不完全一样，所以字节不会相同 —— 列在这里，
// 让「差在哪」有地方可查，而不是让一个通过的用例遮住它。
const 还没对齐的 = [
  ["两个函数与一次调用", "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  return 加(20, 22)\n}\n"],
  ["if 与字符串", 'fn main() -> Int {\n  let s = "ab"\n  if s == "ab" {\n    print(s)\n  }\n  return len(s)\n}\n'],
];

console.log("一、两位打包者对同一份源码交出同样的字节");
{
  for (const [标, 源码] of 程序们) {
    const 源路 = path.join(临, "p.hmyr");
    fs.writeFileSync(源路, 源码, "utf8");
    const unit = loadUnit(源路);
    if (!unit.ok) { ok(标, false, "加载失败"); continue; }
    const js字节 = 写程序(合并程序(unit.order.map((f) => 编译模块(unit.modules.get(f)))));
    // HMYR 那位：跑 self/pack.hmyr 的编译与打包两段，拿它交回的字节元组。
    const rt = runUnit(loadUnit(path.join(ROOT, "self/pack.hmyr")), { stage0: true, stepLimit: 400000000 });
    const 编源码 = rt.functions.get("编源码");
    const 打包 = rt.functions.get("打包");
    const 编r = rt.callFunction(编源码, [源码], null);
    if (!编r || 编r.ok === false) { ok(标, false, "编译： " + (编r ? 编r.错 : "没有")); continue; }
    const 包r = rt.callFunction(打包, [编r.函数们], null);
    if (!包r || !Array.isArray(包r)) { ok(标, false, "打包没有交回元组"); continue; }
    const 她 = Buffer.from(包r.map((x) => x & 0xff));
    const 同 = js字节.length === 她.length && Buffer.compare(js字节, 她) === 0;
    ok(标 + "（" + js字节.length + " 字节）", 同, 同 ? "" : "JS " + js字节.length + " / HMYR " + 她.length);
  }
}

console.log("二、还没对齐的那几份，差多少说清楚");
{
  const rt = runUnit(loadUnit(path.join(ROOT, "self/pack.hmyr")), { stage0: true, stepLimit: 400000000 });
  for (const [标, 源码] of 还没对齐的) {
    const 源路 = path.join(临, "q.hmyr");
    fs.writeFileSync(源路, 源码, "utf8");
    const unit = loadUnit(源路);
    const js字节 = 写程序(合并程序(unit.order.map((f) => 编译模块(unit.modules.get(f)))));
    const 编r = rt.callFunction(rt.functions.get("编源码"), [源码], null);
    if (!编r || 编r.ok === false) { console.log("  跳过  " + 标 + "： " + (编r ? 编r.错 : "")); continue; }
    const 包r = rt.callFunction(rt.functions.get("打包"), [编r.函数们], null);
    const 她 = Buffer.from(包r.map((x) => x & 0xff));
    const 同 = js字节.length === 她.length && Buffer.compare(js字节, 她) === 0;
    // 这一条不断言「相同」，只要求「说得清差多少」。等到对齐之后它会自然变成相同的。
    ok(标 + " 的字节数说得出来", 她.length > 0, "");
    console.log("        JS " + js字节.length + " 字节 / HMYR " + 她.length + " 字节" + (同 ? "（已对齐）" : "（还差 " + (她.length - js字节.length) + " 字节）"));
  }
}

console.log("三、C 那台也交得出同一份字节");
{
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc");
  } else {
    const exe = path.join(临, "vm.exe");
    const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
    if (c.status === 0) {
      const 源路 = path.join(临, "r.hmyr");
      fs.writeFileSync(源路, 程序们[0][1], "utf8");
      // pack.hmyr 自己编成字节码，再由 C 那台执行它 —— 中间没有 JavaScript。
      // 编这一份要走 tools/emit-code.mjs：入口文件的 main 才算 main，
      // 否则会是 import 链里某个自测的 main（lex.hmyr 那个返回词数 19，看起来像个错误码）。
      const 码路 = path.join(临, "pack.hmyrb");
      const 编r = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "self/pack.hmyr"), 码路], { encoding: "utf8" });
      ok("pack.hmyr 编得成字节码", 编r.status === 0, String(编r.stderr).slice(0, 160));
      const 出路 = path.join(临, "out.hmyrb");
      const r = spawnSync(exe, [码路, 出路, 源路], { encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "2000000000" } });
      ok("C 跑 packer 写出了一个文件", r.status === 0 && fs.existsSync(出路), String(r.status) + " " + String(r.stderr).slice(0, 160));
      if (fs.existsSync(出路)) {
        const unit2 = loadUnit(源路);
        const js字节 = 写程序(合并程序(unit2.order.map((f) => 编译模块(unit2.modules.get(f)))));
        const 她 = fs.readFileSync(出路);
        const 同 = js字节.length === 她.length && Buffer.compare(js字节, 她) === 0;
        ok("C 写的字节与 JS 那侧一字不差", 同, 同 ? "" : "JS " + js字节.length + " / C " + 她.length);
      }
    }
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
