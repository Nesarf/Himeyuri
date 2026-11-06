// 装载器的验收：HMYR 写的 VM 读一份 .hmoks，得到的函数表要与 JS 那份一模一样。
//
// 这一条是「用 HMYR 写 VM」的第一个台阶：读得进来。跑不起来还在后面，而两件事分开验，
// 出问题时才分得清是读错了还是执行错了。
//
// 对照的两边：
//   这边  conformance/vm-load.hmoca —— 由 self/vm.hmoca 的 装载 读出，跑在 C 那台上
//   那边  src/code-file.mjs 的 读程序 —— JS 那一侧唯一的读法
//
// 为什么跑在 C 那台而不是 bin/hmyr.mjs：第一版跑在自举解释器上，96 KB 的 run.hmoks
// 撞了两亿步的限。那不是装载器慢，是自举解释器每一步都贵 —— 同一份字节码在 C 那台上
// 几秒就完了。这一层的去处本来就是 C 那台或板子，所以判据也该跑在那里。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序, 读程序 } from "../src/code-file.mjs";
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

console.log("一、装载那一份编得动");
const 装载器 = 编("conformance/vm-load.hmoca");
ok("conformance/vm-load.hmoca 编得动", !!装载器, "");

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else if (装载器) {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-vmload-"));
  const exe = path.join(临, "hmyr");
  const 编译 = spawnSync("gcc", ["-std=c11", "-O3", "-Wall", ...平台参数(), "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来", 编译.status === 0, String(编译.stderr).slice(0, 200));

  if (编译.status === 0) {
    const 器路 = path.join(临, "vm-load.hmoks");
    fs.writeFileSync(器路, 装载器);

    console.log("二、三份真实的字节码：函数表逐行相同");
    for (const 份 of ["runtime/run.hmoks", "runtime/sign.hmoks", "runtime/fmt.hmoks"]) {
      const 源路 = path.join(ROOT, 份);
      // 那边：JS 读出来的表。
      const p = 读程序(fs.readFileSync(源路));
      const 期望 = [...p.函数族.values()].map((f) => f.名 + " " + f.参数量 + " " + f.槽数 + " " + f.码.length).join("\n");
      // 这边：HMYR 写的装载器，跑在 C 那台上。
      const r = spawnSync(exe, [器路, 源路], {
        encoding: "utf8", timeout: 600000,
        env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" },
      });
      const 得到 = String(r.stdout || "").trim();
      const 两 = 期望.trim();
      ok(份 + " 的表与 JS 那份逐行相同", r.status === 0 && 得到 === 两,
        r.status !== 0 ? ("退出码 " + r.status + " " + String(r.stderr).slice(0, 160))
          : (得到.split("\n").length + " 行 对 " + 两.split("\n").length + " 行"));
      if (r.status === 0 && 得到 !== 两) {
        const a = 得到.split("\n"), b = 两.split("\n");
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        console.log("          第一处不同在第 " + (i + 1) + " 行：这边 [" + (a[i] || "无") + "] 那边 [" + (b[i] || "无") + "]");
      }
    }

    console.log("三、坏文件要被拒，而且说得出理由");
    const 坏1 = path.join(临, "not-hmyrb.bin");
    fs.writeFileSync(坏1, Buffer.from("not a bytecode file at all"));
    const r1 = spawnSync(exe, [器路, 坏1], { encoding: "utf8", timeout: 120000, env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_MEM_LIMIT: "0", HMYR_GC: "1" } });
    ok("魔数不对时说「这不是 .hmoks 文件」", String(r1.stdout || "").includes("这不是 .hmoks 文件"), String(r1.stdout || "").slice(0, 120));

    const 好 = fs.readFileSync(path.join(ROOT, "runtime/fmt.hmoks"));
    const 坏2 = path.join(临, "bad-version.hmoks");
    const 改 = Buffer.from(好);
    改[5] = 9;   // 版本那两字节的第一个
    fs.writeFileSync(坏2, 改);
    const r2 = spawnSync(exe, [器路, 坏2], { encoding: "utf8", timeout: 120000, env: { ...process.env, HMYR_STEPS: "2000000000", HMYR_MEM_LIMIT: "0", HMYR_GC: "1" } });
    ok("版本不对时说出它读到几", String(r2.stdout || "").includes("版本是 9"), String(r2.stdout || "").slice(0, 120));
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
