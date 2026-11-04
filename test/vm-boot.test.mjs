// 第四个台阶：用 HMYR 写的 VM 跑自举层，自举层再去跑一份源码。
//
// 前三个台阶是分开验的：
//   vmload  读得进来（装载器对不对）
//   vmrun   跑得对（同一个 .hmoks 与 src/vm.mjs 同答案）
//   这一份   跑得动真的东西 —— 装载的不是算术小程序，是 runtime/run.hmoks：
//           自举层的词法、语法、编译器、求值器全在里面。它在 VM 里被调起来，
//           去读 examples/hello.hmoca，编成字节码，再跑，最后打出 5。
//
// 为什么这一条比前两条都重：前两条的客人是我为了判据写的小程序，客人写错了
// 两边就一起错；这一条的客人是仓库里本来就在的那一份，而它跑出来的 5 与
// bin/hmyr.mjs 跑同一个文件给出的 5 是同一个数。
//
// 跑在 C 那台上：与 vmrun 同一个理由 —— 每一层都是解释器，自举解释器每步贵三个
// 数量级，于是「HMYR 写的 VM 套着 HMYR 写的自举层」只有在 C 那台上才跑得完。
// 量过：C 那台约二十秒，宿主那个 bin/hmyr.mjs 撞两亿步的限。
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

console.log("一、探针编得动");
const 探针 = 编("conformance/vm-boot.hmoca");
ok("conformance/vm-boot.hmoca 编得动", !!探针, "");

const 自举 = path.join(ROOT, "runtime/run.hmoks");
ok("runtime/run.hmoks 在仓库里（它是被别人改自举层时重新生成的）", fs.existsSync(自举), 自举);

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else if (探针) {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-vmboot-"));
  const exe = path.join(临, "hmyr");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", ...平台参数(), "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 200));

  if (c.status === 0) {
    const 器路 = path.join(临, "vm-boot.hmoks");
    fs.writeFileSync(器路, 探针);
    // 步限放到机器认的最大那一档：这一跑是「解释器套解释器」，默认五百万步
    // 连自举层的一个函数都走不完。
    const 环境 = { ...process.env, HMYR_STEPS: "2000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" };

    console.log("二、自举链：VM 里的自举层去跑一份示例");
    {
      const r = spawnSync(exe, [器路, 自举, "examples/hello.hmoca"], {
        encoding: "utf8", timeout: 900000, env: 环境, cwd: ROOT,
      });
      const 出 = String(r.stdout || "");
      // 两句话都要有：5 是客人打出来的，最后一行是探针自己说的退出码。
      // 只看最后一行的话，「客人一行都没打就退出 0」也会算过。
      ok("自举层在 VM 里跑出 examples/hello.hmoca 的 5", r.status === 0 && 出.split("\n").includes("5"),
        "退出码 " + r.status + " " + 出.slice(0, 200) + String(r.stderr || "").slice(0, 160));
      ok("探针报的退出码是 0", 出.includes("命令行入口 跑完，值 0"), 出.slice(-120));
    }

    console.log("三、客人自己的手：这一版新转手的那批内置");
    {
      // examples/hello.hmoca 只走到第七跳就到底，二十来个内置够它用 ——
      // 而 self/vm.hmoca 的 内置的 在 2026-11-04 从二十二个补到六十六个。
      // 补进来的那四十几条，hello 一条都不碰。conformance/vm-hands.hmoca 就是
      // 为它们写的：数、串、位运算八条、数组与设、记录与索引、f64_bytes、时间。
      //
      // 期望值从 src/vm.mjs 来，不写死常数：写死常数等于把我对这语言的理解抄两遍，
      // 抄错了两边就一起错。
      const 源路 = path.join(ROOT, "conformance/vm-hands.hmoca");
      const u = loadUnit(源路);
      const vm = 跑字节码(u, { capabilities: 本机能力() });
      const 那 = vm.调用("main", []);
      const 期望 = 那.ok ? String(那.值) : ("失败：" + 那.话);
      const r = spawnSync(exe, [器路, 自举, "conformance/vm-hands.hmoca"], {
        encoding: "utf8", timeout: 900000, env: 环境, cwd: ROOT,
      });
      const 出 = String(r.stdout || "");
      const 首行 = (出.split("\n")[0] || "").trim();
      ok("自举层跑出与 src/vm.mjs 同一个数（期望 " + 期望 + "）",
        r.status === 0 && 首行 === 期望,
        "退出码 " + r.status + " 首行 " + 首行 + " " + String(r.stderr || "").slice(0, 160));
    }

    console.log("四、跑不通的时候要说清是哪一个入口不通");
    {
      // 点名一个不存在的入口：这一层要说出「没有 … 这个函数」，
      // 而不是安静地交回 0。探针把入口名从第五个参数接过来。
      const r = spawnSync(exe, [器路, 自举, "examples/hello.hmoca", "根本没有这个入口"], {
        encoding: "utf8", timeout: 900000, env: 环境, cwd: ROOT,
      });
      const 出 = String(r.stdout || "");
      ok("不存在的入口要说出来", r.status === 1 && 出.includes("没有 根本没有这个入口 这个函数"), 出.slice(0, 160));
    }
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
