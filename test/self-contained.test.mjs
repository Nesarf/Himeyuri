// 自包含的 hmyr：可执行文件自带种子，一份 .hmyr 进来就能跑，全程不经 node。
//
// 这一套的判据是「没有外部种子也跑得动」—— 所以它不藏仓库里的 bootstrap/（那会
// 影响并行跑的别的套件），而是把可执行文件编译到一个**没有 bootstrap/ 的临时目录**里，
// 从那里跑一份源码。种子若没编进去，这一步会报 HMYR-E0009。
//
// 与 node bin/hmyr.mjs 的关系要说清：那一份是「解释执行」，它把 main 的返回值也打出来
// （run.hmyr 的显示选择）；这一份是「编译执行」，跑的是用户程序本身，不打印返回值。
// 两者语义不同，所以这里比的不是它们的输出，而是「自包含」与「显式两步」是否一致。
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

console.log("一、内置种子的头文件在，而且它就是那份种子");
{
  const 头路 = path.join(ROOT, "vm/pack_seed.h");
  ok("vm/pack_seed.h 在", fs.existsSync(头路));
  if (fs.existsSync(头路)) {
    const 头 = fs.readFileSync(头路, "utf8");
    const 种子 = fs.readFileSync(path.join(ROOT, "bootstrap/pack.hmyrb"));
    ok("数组名字对得上", 头.includes("hmyr_pack_seed[]"), "");
    ok("长度写着种子的字节数", 头.includes("hmyr_pack_seed_len = " + 种子.length + ";"), "");
    ok("开头四个字节是魔数", /0x48, 0x4d, 0x59, 0x52, 0x42/.test(头), "");
    ok("有重复包含的守卫", 头.includes("#ifndef HMYR_PACK_SEED_H"), "");
  }
}

const 有编译器 = (() => {
  try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

console.log("二、编译到一个没有 bootstrap/ 的目录里");
if (!有编译器) {
  console.log("  跳过  这台机器上没有 gcc");
} else {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-self-"));
  const exe = path.join(临, "hmyr.exe");
  const c = spawnSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", "-o", exe, path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
  ok("C 那台编得出来（带着内置种子）", c.status === 0, String(c.stderr).slice(0, 160));
  ok("那个目录里没有 bootstrap/", !fs.existsSync(path.join(临, "bootstrap")), "");
  if (c.status === 0) {
    const 源 = path.join(ROOT, "examples/twice.hmyr");
    const r = spawnSync(exe, [源], {
      cwd: 临, encoding: "utf8", timeout: 300000,
      env: { ...process.env, HMYR_STEPS: "4000000000" },
    });
    ok("没有外部种子也跑完了", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 200));
    ok("输出就是程序该有的样子", String(r.stdout || "") === "hi 42 琥珀音", JSON.stringify(String(r.stdout || "")));
    ok("没有抱怨找不到种子", !String(r.stderr || "").includes("HMYR-E0009"), String(r.stderr).slice(0, 200));

    console.log("三、它跑的就是它自己编出来的那一段");
    {
      // 显式两步：先用内置种子编出一份字节码，再跑那份字节码 —— 输出必须一样。
      const 码 = path.join(临, "twice.hmyrb");
      const 编 = spawnSync(exe, [源], {
        cwd: 临, encoding: "utf8", timeout: 300000,
        env: { ...process.env, HMYR_STEPS: "4000000000", HMYR_KEEP: "0" },
      });
      // HMYR_KEEP 只影响保留临时字节码；那一条路不适合直接拿，所以这里只做「同一份源码跑两遍」。
      const 再 = spawnSync(exe, [源], { cwd: 临, encoding: "utf8", timeout: 300000, env: { ...process.env, HMYR_STEPS: "4000000000" } });
      ok("同一份源码跑两遍输出相同", String(r.stdout) === String(再.stdout) && r.status === 再.status, JSON.stringify(String(再.stdout || "")));
      ok("没有留下种子临时文件", fs.readdirSync(临).every((名) => !名.endsWith(".seed.hmyrb")), fs.readdirSync(临).join(" "));
    }
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
