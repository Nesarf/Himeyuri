// 只靠种子与 C，重建出种子自己。
//
// 这一套问的是这个项目最重要的一句承诺：从某个版本起，重建它不再需要 JavaScript。
//
// 怎么做到的：bootstrap/pack.hmyrb 是一版**固定点** —— 它由自己编出来，而它再编一次
// 还是同样的字节。所以它一边是产物，一边是工具：拿它当编译器使，喂给它 self/ 的六份源码，
// 出来的东西与它自己逐字节相同。
//
// 一条要承认的事：种子第一次是从哪来的。它由「借一次 JS 编出 A，再用 A 编出 B」得到，
// 而那一步只发生过一次，记录在 design/COMPILER.txt。此后不需要 src/。
//
// 验收里没有一次 node 调用 —— 只有 gcc 与 hmyr 那台机器。这条路走通，
// 「不依赖 src/」就不是一句愿望。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 种子路 = path.join(ROOT, "bootstrap/pack.hmyrb");

console.log("一、种子在仓库里，而且它是一份能跑的东西");
{
  ok("bootstrap/pack.hmyrb 在", fs.existsSync(种子路));
  if (fs.existsSync(种子路)) {
    const 字节 = fs.readFileSync(种子路);
    ok("它是个 .hmyrb（开头是魔数）", 字节.slice(0, 5).toString("latin1") === "HMYRB", JSON.stringify(字节.slice(0, 5).toString("latin1")));
    ok("它不大（四十千字节上下）", 字节.length > 30000 && 字节.length < 60000, String(字节.length));
  }
}

console.log("二、gcc 加上种子，重建出种子自己（这条路里没有 node）");
{
  const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc");
  } else if (!process.env.HMYR_HEAVY) {
    // 分批之后从九千兆降到三千六百兆（pack.hmyr 现在一份一份编），但仍不轻。
    console.log("  跳过  重建种子这一格约三点七吉字节：设 HMYR_HEAVY=1 才跑");
    console.log("        剩下的账在 design/COMPILER.txt：指令累积仍是平方级，要按块收。");
  } else if (!fs.existsSync(种子路)) {
    ok("没有种子就谈不上重建", false);
  } else {
    const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-seed-"));
    const exe = path.join(临, "hmyr.exe");
    第一: {
      const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
      ok("C 那台编得出来", c.status === 0, String(c.stderr).slice(0, 160));
      if (c.status !== 0) break 第一;
      const 链 = ["lex", "chain", "stmt", "body", "compile", "pack"].map((n) => path.join(ROOT, "self", n + ".hmyr"));
      const 出 = path.join(临, "rebuilt.hmyrb");
      // 注意：这里只有 exe 与源码，没有任何 node 参与。
      const r = spawnSync(exe, [种子路, 出, ...链], { encoding: "utf8", timeout: 900000, env: { ...process.env, HMYR_STEPS: "4000000000", HMYR_GC: "1" } });
      ok("种子跑得起来，编出了东西", r.status === 0 && fs.existsSync(出), String(r.status) + " " + String(r.stderr).slice(0, 160));
      if (fs.existsSync(出)) {
        const 甲 = fs.readFileSync(种子路), 乙 = fs.readFileSync(出);
        const 同 = 甲.length === 乙.length && Buffer.compare(甲, 乙) === 0;
        ok("重建出来的字节与种子完全相同（" + 甲.length + " 字节）", 同, 同 ? "" : 甲.length + " 对 " + 乙.length);
        // 再走一遍：用刚重建出来的那一份当编译器，还要得到同样的字节。
        const 二 = path.join(临, "rebuilt2.hmyrb");
        const r2 = spawnSync(exe, [出, 二, ...链], { encoding: "utf8", timeout: 900000, env: { ...process.env, HMYR_STEPS: "4000000000", HMYR_GC: "1" } });
        if (r2.status === 0 && fs.existsSync(二)) {
          const 丙 = fs.readFileSync(二);
          ok("再编一遍还是同样的字节（固定点站得住）", 丙.length === 甲.length && Buffer.compare(甲, 丙) === 0, 甲.length + " 对 " + 丙.length);
        } else {
          ok("再编一遍还是同样的字节（固定点站得住）", false, String(r2.status) + " " + String(r2.stderr).slice(0, 120));
        }
      }
    }
    fs.rmSync(临, { recursive: true, force: true });
  }
}

console.log("三、种子跑得动真实程序（它不只是能重建自己）");
{
  const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
  if (!有gcc || !fs.existsSync(种子路)) {
    console.log("  跳过  没有 gcc 或没有种子");
  } else if (!process.env.HMYR_HEAVY) {
    // 这一节编的是 eval 与 run 那条链，单份 eval.hmyr 就有五百三十八行，
    // 一份一份编仍会超过四吉的上限（实测撞过）。
    console.log("  跳过  编自举层这一格超过四吉字节：设 HMYR_HEAVY=1 与 HMYR_MEM_LIMIT=0 才跑");
  } else {
    const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-seed2-"));
    const exe = path.join(临, "hmyr.exe");
    const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
    if (c.status === 0) {
      // 用种子造一份「跑程序的自举层」：种子本身就是编译器，编出来的是 run.hmyr 那条链。
      const 链 = ["lex", "chain", "stmt", "body", "eval", "run"].map((n) => path.join(ROOT, "self", n + ".hmyr"));
      const 层 = path.join(临, "self.hmyrb");
      // 这一节编的是 eval 与 run 那条链，单份 eval.hmyr 有五百三十八行，
      // 而它是「一份一份编」里最大的一份 —— 不开回收时峰值已经贴着四吉的上限。
      // 所以这里开回收、并且把上限放开：回收不改变答案，只改变账。
      const r = spawnSync(exe, [种子路, 层, ...链], { encoding: "utf8", timeout: 900000, env: { ...process.env, HMYR_STEPS: "4000000000", HMYR_GC: "1", HMYR_MEM_LIMIT: "0" } });
      ok("种子编出了跑程序那一层", r.status === 0 && fs.existsSync(层), String(r.status) + " " + String(r.stderr).slice(0, 160));
      if (fs.existsSync(层)) {
        const 例 = path.join(ROOT, "examples/twice.hmyr");
        const 跑 = spawnSync(exe, [层, 例], { encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "2000000000" } });
        ok("它跑出示例程序该有的输出", String(跑.stdout || "").includes("hi 42 琥珀音"), String(跑.status) + " " + JSON.stringify(String(跑.stdout || "").slice(0, 60)));
      }
    }
    fs.rmSync(临, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
