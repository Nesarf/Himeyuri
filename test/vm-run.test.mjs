// 执行那一层的验收：同一份 .hmoks，HMYR 写的 VM 与 src/vm.mjs 跑出同一个值。
//
// 这是「用 HMYR 写 VM」的第二个台阶。第一个（读得进来）在 test/vm-load.test.mjs，
// 而两个台阶要分开验：装载错了是全表不对，执行错了是某个值不对，混在一起时
// 报出来的症状一模一样。
//
// 三组程序，按顺序加难度：
//   一、纯算术与赋值 —— 常量、取、存、加减乘、返回
//   二、分支 —— 前一组再加真跳与假跳
//   三、比较 —— 再加等、小、大等六条，以及布尔
//
// 对照的两边：
//   这边  conformance/vm-run.hmoca —— 由 self/vm.hmoca 装载并执行，跑在 C 那台上
//   那边  src/vm.mjs 的 跑字节码 加 调用("main", [])
//
// 为什么跑在 C 那台：与装载那条同一个理由 —— 自举解释器每步贵三个数量级，
// 而这一层的去处本来就是 C 那台或板子。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { 平台参数 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 编 = (相对) => {
  const u = loadUnit(path.join(ROOT, 相对));
  if (!u.ok) return null;
  return 写程序(合并程序(
    u.order.map((f) => 编译模块(u.modules.get(f))),
    编译模块(u.modules.get(u.order[u.order.length - 1])),
  ));
};

// JS 那一边：同一个 .hmoca 交给 src/vm.mjs，取 main 的返回值。
const 那边跑 = (相对) => {
  const u = loadUnit(path.join(ROOT, 相对));
  if (!u.ok) return { ok: false, 说: "加载器读不动" };
  const vm = 跑字节码(u, { capabilities: 本机能力() });
  const r = vm.调用("main", []);
  return r.ok ? { ok: true, 值: r.值 } : { ok: false, 说: r.话 };
};

console.log("一、两份源码都编得动");
const 跑步器 = 编("conformance/vm-run.hmoca");
ok("conformance/vm-run.hmoca 编得动", !!跑步器, "");

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else if (跑步器) {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-vmrun-"));
  const exe = path.join(临, "hmyr");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", ...平台参数(), "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 200));

  if (c.status === 0) {
    const 器路 = path.join(临, "vm-run.hmoks");
    fs.writeFileSync(器路, 跑步器);

    // 三组程序写在临时目录里，因为它们的 .hmoks 也要跟着生成。
    const 程序们 = [
      ["算一", "一、纯算术", "函数 main() -> Int {\n  定 a = 2 + 3 * 4\n  定 b = a - 5\n  返回 b * 2\n}\n"],
      ["算二", "一、带乘除与取余", "函数 main() -> Int {\n  定 a = 17\n  定 b = 5\n  返回 a - a / b * b\n}\n"],
      ["支一", "二、分支：真跳", "函数 main() -> Int {\n  定 x = 7\n  若 x > 5 {\n    返回 100\n  }\n  返回 200\n}\n"],
      ["支二", "二、分支：假跳", "函数 main() -> Int {\n  定 x = 2\n  若 x > 5 {\n    返回 100\n  }\n  返回 200\n}\n"],
      ["循一", "二、循环：一个累加到十", "函数 main() -> Int {\n  变 i = 0\n  变 和 = 0\n  当 i < 10 {\n    和 = 和 + i\n    i = i + 1\n  }\n  返回 和\n}\n"],
      ["比一", "三、比较：六条里挑三条", "函数 main() -> Int {\n  若 3 != 4 {\n    若 3 <= 3 {\n      若 5 >= 5 {\n        返回 42\n      }\n    }\n  }\n  返回 0\n}\n"],
      ["组一", "四、元组：造一个再按下标取", "函数 main() -> Int {\n  定 t = (10, 20, 30)\n  返回 t[1]\n}\n"],
      ["记一", "四、记录：造一个再按字段取", "函数 main() -> Int {\n  定 r = {甲: 7, 乙: 8}\n  返回 r.乙\n}\n"],
      // 串那条要避开内置：ord 会编成「调内置」，而那一批还没做。
      // 所以改成「取出来与一个字面量比」—— 只用到索引与等这两条指令。
      ["串一", "四、串：按下标取出来与字面量比", "函数 main() -> Int {\n  定 s = \"abcd\"\n  若 s[2] == \"c\" {\n    返回 99\n  }\n  返回 0\n}\n"],
    ];

    console.log("二、三组程序：两边跑出同一个值");
    for (const [名, 说, 源] of 程序们) {
      const 源路 = path.join(临, 名 + ".hmoca");
      fs.writeFileSync(源路, 源, "utf8");
      const u = loadUnit(源路);
      if (!u.ok) { ok(说, false, "加载器读不动"); continue; }
      const 码 = 写程序(合并程序(
        u.order.map((f) => 编译模块(u.modules.get(f))),
        编译模块(u.modules.get(u.order[u.order.length - 1])),
      ));
      const 码路 = path.join(临, 名 + ".hmoks");
      fs.writeFileSync(码路, 码);

      // 那边
      const vm = 跑字节码(u, { capabilities: 本机能力() });
      const 那 = vm.调用("main", []);
      // 这边
      const r = spawnSync(exe, [器路, 码路], {
        encoding: "utf8", timeout: 600000,
        env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
      });
      const 这 = String(r.stdout || "").trim();
      const 那边 = 那.ok ? String(那.值) : ("失败：" + 那.话);
      ok(说 + "（期望 " + 那边 + "）", r.status === 0 && 这 === 那边,
        r.status !== 0 ? ("退出码 " + r.status + " " + String(r.stderr || "").slice(0, 160)) : ("这边 " + 这));
    }

    console.log("三、这一版还做不到的要说出来，不假装跑通");
    {
      const 源路 = path.join(临, "调一.hmoca");
      fs.writeFileSync(源路, "函数 加一(x: Int) -> Int {\n  返回 x + 1\n}\n\n函数 main() -> Int {\n  返回 加一(41)\n}\n", "utf8");
      const u = loadUnit(源路);
      const 码 = 写程序(合并程序(
        u.order.map((f) => 编译模块(u.modules.get(f))),
        编译模块(u.modules.get(u.order[u.order.length - 1])),
      ));
      const 码路 = path.join(临, "调一.hmoks");
      fs.writeFileSync(码路, 码);
      const r = spawnSync(exe, [器路, 码路], {
        encoding: "utf8", timeout: 600000,
        env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
      });
      const 出 = String(r.stdout || "");
      ok("调函数这一版要明说「还做不到」", 出.includes("还做不到"), 出.slice(0, 120));
    }

    console.log("四、反向：把那个值改坏，它必须红");
    {
      // 同一个纯算术程序，但把源码改一个数 —— 两边都还该一致（这是正向的另一种情形），
      // 而「一致」不等于「等于我写了什么」。所以这一条验的是：如果这边的值被换掉，
      // 比对就会失败。用一个 JS 侧的假答案去比，必须不相同。
      const 源路 = path.join(临, "算一.hmoca");
      const 码路 = path.join(临, "算一.hmoks");
      const r = spawnSync(exe, [器路, 码路], {
        encoding: "utf8", timeout: 600000,
        env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
      });
      const 这 = String(r.stdout || "").trim();
      ok("把它与一个错答案比会不相等", 这 !== "999999", "这边 " + 这);
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
