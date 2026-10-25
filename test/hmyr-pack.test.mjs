// HMYR 自己把程序打成 .hmoks —— 逐字节相同的那一条。
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
import { 写程序, 读程序 } from "../src/code-file.mjs";
import { 虚拟机 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-pack-"));

// 打包交回的是「块们的元组」（语言那边按块累积，省掉平方复制），
// 所以在测试这一侧要先拍平 —— 与 write_bytes 在宿主里做的是同一件事。
const 拍平 = (块们) => {
  const 平 = [];
  for (const x of 块们) {
    if (Array.isArray(x)) { for (const y of x) 平.push(y & 0xff); }
    else 平.push(x & 0xff);
  }
  return Buffer.from(平);
};

// 这个套件里三件事都得成立：C 编得出来、packer 交得出字节、两位打包者一致。
const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
const 程序们 = [
  ["直接返回一个数", "fn main() -> Int {\n  return 7\n}\n"],
  ["两个函数与一次调用", "fn 加(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  return 加(20, 22)\n}\n"],
  ["if 与字符串", 'fn main() -> Int {\n  let s = "ab"\n  if s == "ab" {\n    print(s)\n  }\n  return len(s)\n}\n'],
  ["while 与比较", "fn main() -> Int {\n  var i = 0\n  while i < 4 {\n    i = i + 1\n  }\n  return i\n}\n"],
  ["元组与下标", "fn main() -> Int {\n  let t = (10, 20, 30)\n  return t[1]\n}\n"],
];

console.log("一、两位打包者对同一份源码交出同样的字节");
{
  for (const [标, 源码] of 程序们) {
    const 源路 = path.join(临, "p.hmoca");
    fs.writeFileSync(源路, 源码, "utf8");
    const unit = loadUnit(源路);
    if (!unit.ok) { ok(标, false, "加载失败"); continue; }
    const js字节 = 写程序(合并程序(unit.order.map((f) => 编译模块(unit.modules.get(f)))));
    // HMYR 那位：跑 self/pack.hmoca 的编译与打包两段，拿它交回的字节元组。
    const rt = runUnit(loadUnit(path.join(ROOT, "self/pack.hmoca")), { stage0: true, stepLimit: 400000000 });
    const 编源码 = rt.functions.get("编源码");
    const 打包 = rt.functions.get("打包");
    const 编r = rt.callFunction(编源码, [源码], null);
    if (!编r || 编r.ok === false) { ok(标, false, "编译： " + (编r ? 编r.错 : "没有")); continue; }
    const 包r = rt.callFunction(打包, [编r.函数们], null);
    if (!包r || !Array.isArray(包r)) { ok(标, false, "打包没有交回元组"); continue; }
    const 她 = 拍平(包r);
    const 同 = js字节.length === 她.length && Buffer.compare(js字节, 她) === 0;
    ok(标 + "（" + js字节.length + " 字节）", 同, 同 ? "" : "JS " + js字节.length + " / HMYR " + 她.length);
  }
}

console.log("二、编译出来的东西跑得动（字节相同之外，还要答案对）");
{
  const rt = runUnit(loadUnit(path.join(ROOT, "self/pack.hmoca")), { stage0: true, stepLimit: 400000000 });
  const 源码 = 程序们[3][1];
  const 编r = rt.callFunction(rt.functions.get("编源码"), [源码], null);
  ok("while 那份编得出来", !编r || 编r.ok !== false, 编r ? 编r.错 : "");
  if (编r && 编r.ok !== false) {
    const 包r = rt.callFunction(rt.functions.get("打包"), [编r.函数们], null);
    const 码路 = path.join(临, "run.hmoks");
    fs.writeFileSync(码路, 拍平(包r));
    // 读回来跑：main 返回 4。
    const p = 读程序(fs.readFileSync(码路), null);
    const vm = new 虚拟机(p, { capabilities: 本机能力(), write: () => {} });
    const r = vm.调用("main", [], null);
    ok("它跑出 4", r.ok && r.值 === 4, JSON.stringify(r.ok ? r.值 : r.码));
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
      const 源路 = path.join(临, "r.hmoca");
      fs.writeFileSync(源路, 程序们[0][1], "utf8");
      // pack.hmoca 自己编成字节码，再由 C 那台执行它 —— 中间没有 JavaScript。
      // 编这一份要走 tools/emit-code.mjs：入口文件的 main 才算 main，
      // 否则会是 import 链里某个自测的 main（lex.hmoca 那个返回词数 19，看起来像个错误码）。
      const 码路 = path.join(临, "pack.hmoks");
      const 编r = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "self/pack.hmoca"), 码路], { encoding: "utf8" });
      ok("pack.hmoca 编得成字节码", 编r.status === 0, String(编r.stderr).slice(0, 160));
      const 出路 = path.join(临, "out.hmoks");
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

console.log("四、自举的固定点：HMYR 编出来的编译器，重编自己得到同样的字节");
{
  // 这一节问的不是「与 JS 那侧相同」，而是「自己与自己的下一版相同」。
  // 两者的区别是要紧的：与 JS 相同还要对齐合并规则（同名函数谁赢之类的约定），
  // 而「自己重编自己不变」是自举真正需要的那一条 —— 有了它，种子之后就不再需要 src/。
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc");
  } else if (!process.env.HMYR_HEAVY) {
    // 这一节要把 self/ 六份编两遍，也就撞上编译器那处平方级的指令累积
    // （见 design/COMPILER.txt）：一跑就是几吉字节。默认不跑。
    console.log("  跳过  这一节要编 self/ 六份两遍，几吉字节：设 HMYR_HEAVY=1 才跑");
  } else {
    const exe = path.join(临, "vm2.exe");
    const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    if (c.status !== 0) {
      ok("C 那台编得出来", false, String(c.stderr).slice(0, 160));
    } else {
      const 链 = ["self/lex.hmoca", "self/chain.hmoca", "self/stmt.hmoca", "self/body.hmoca", "self/compile.hmoca", "self/pack.hmoca"].map((p) => path.join(ROOT, p));
      const 种子 = path.join(临, "seed.hmoks");
      // 第一步只能借一次 JS：编出第一版。
      const 编 = spawnSync(process.execPath, [path.join(ROOT, "tools/emit-code.mjs"), path.join(ROOT, "self/pack.hmoca"), 种子], { encoding: "utf8" });
      ok("第一版（借一次 JS）编出来了", 编.status === 0 && fs.existsSync(种子), String(编.stderr).slice(0, 120));
      if (fs.existsSync(种子)) {
        const 跑 = (码路, 出路) => spawnSync(exe, [码路, 出路, ...链], { encoding: "utf8", timeout: 600000, env: { ...process.env, HMYR_STEPS: "4000000000" } });
        const 二 = path.join(临, "v2.hmoks");
        const 三 = path.join(临, "v3.hmoks");
        const r2 = 跑(种子, 二);
        ok("第二版由第一版编出来", r2.status === 0 && fs.existsSync(二), String(r2.status) + " " + String(r2.stderr).slice(0, 140));
        if (fs.existsSync(二)) {
          const r3 = 跑(二, 三);
          ok("第三版由第二版编出来", r3.status === 0 && fs.existsSync(三), String(r3.status) + " " + String(r3.stderr).slice(0, 140));
          if (fs.existsSync(三)) {
            const b = fs.readFileSync(二), d = fs.readFileSync(三);
            const 同 = b.length === d.length && Buffer.compare(b, d) === 0;
            ok("第二版与第三版逐字节相同（固定点）", 同, 同 ? "" : b.length + " 对 " + d.length);
            console.log("        第二版 " + b.length + " 字节");
          }
        }
      }
    }
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
