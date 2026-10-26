// 两档：hmsnp 是稳定的那个，hmhsr 是弹性的那个。
//
// 它们是同一份内容的两档入口 —— 决定行为的是名字，而名字在文件名上。
// 所以这一套验三件：
//
//   一、判断只有一处：档位由后缀定，不看内容。
//   二、两档落到不同的资源预设上，而一份普通 .hmoca 仍然落在原来那个数上
//      （多了两档，普通文件的跑法不该变）。
//   三、两档跑同一个短程序，输出相同 —— 档位改变的是资源上限，不是结果。
//
// 为什么不验「steady 撞上限」：五百万步在这台解释器上要跑好几分钟，
// 那种判据没人愿意每次跑。撞上限那一层由 src/minimal-eval.mjs 自己的套件覆盖，
// 而这里的「映射对不对」才是新增的那一部分。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 档位, 档预设, 档步限 } from "../tools/file-kind.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 具 = path.join(ROOT, "bin", "hmyr.mjs");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-prof-"));

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (名) => spawnSync(process.execPath, [具, path.join(临, 名)], { encoding: "utf8", cwd: 临, timeout: 180000 });

// 跑文件：不带子命令，直接给 hmyr 一个目标 —— 线程那一节要的就是这条路。
// 环境变量可以覆盖：第七节要在一个干净的 env 下看 steady 的池会不会拦。
const 跑文件 = (参, cwd = 临, env = process.env) =>
  spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd, timeout: 300000, env });

console.log("一、档位由后缀定，只有一处判断");
{
  ok("hmsnp 是 steady", 档位("包.hmsnp") === "steady", String(档位("包.hmsnp")));
  ok("hmhsr 是 elastic", 档位("包.hmhsr") === "elastic", String(档位("包.hmhsr")));
  ok("hmoca 没有档位", 档位("包.hmoca") === null, String(档位("包.hmoca")));
  ok("大小写不敏", 档位("包.HMHSR") === "elastic", String(档位("包.HMHSR")));
  ok("路径里带目录也认", 档位("/a/b/包.hmsnp") === "steady", String(档位("/a/b/包.hmsnp")));
}

console.log("二、两档落到不同的预设上，而普通源码不变");
{
  ok("steady 比 elastic 紧", 档预设.steady.步限 < 档预设.elastic.步限, 档预设.steady.步限 + " 对 " + 档预设.elastic.步限);
  ok("steady 开 GC、elastic 关", 档预设.steady.gc === true && 档预设.elastic.gc === false, JSON.stringify([档预设.steady.gc, 档预设.elastic.gc]));
  ok("steady 只开一个线程", 档预设.steady.线程 === 1, String(档预设.steady.线程));
  ok("hmsnp 的步限取自 steady", 档步限("a.hmsnp") === 档预设.steady.步限, String(档步限("a.hmsnp")));
  ok("hmhsr 的步限取自 elastic", 档步限("a.hmhsr") === 档预设.elastic.步限, String(档步限("a.hmhsr")));
  // 两亿是启动器主路径一直以来的默认：加了档位之后，一份普通源码不该换一个数。
  ok("普通 hmoca 仍是两亿", 档步限("a.hmoca") === 200000000, String(档步限("a.hmoca")));
}

console.log("三、两档跑同一个程序，输出相同");
{
  const 源 = "fn main() -> Int {\n  print(\"两档一样\" + chr(10))\n  return 0\n}\n";
  for (const 名 of ["短.hmsnp", "短.hmhsr", "短.hmoca"]) {
    fs.writeFileSync(path.join(临, 名), 源, "utf8");
  }
  const 甲 = 跑("短.hmsnp");
  const 乙 = 跑("短.hmhsr");
  const 丙 = 跑("短.hmoca");
  ok("steady 跑得出那句话", (甲.stdout || "").includes("两档一样"), JSON.stringify((甲.stdout || "").slice(0, 60)));
  ok("elastic 跑出同样的话", (乙.stdout || "") === (甲.stdout || ""), JSON.stringify([甲.stdout, 乙.stdout]));
  ok("普通源码也跑出同样的话", (丙.stdout || "") === (甲.stdout || ""), JSON.stringify([甲.stdout, 丙.stdout]));
}

console.log("四、HMYR_STEPS 仍然压过档位预设");
{
  // 「我这次就要这个数」比档位的预设更近。压不住的话，想临时放宽的人会以为开关坏了。
  const 源 = "fn main() -> Int {\n  print(\"受控\" + chr(10))\n  return 0\n}\n";
  fs.writeFileSync(path.join(临, "控.hmhsr"), 源, "utf8");
  const r = spawnSync(process.execPath, [具, path.join(临, "控.hmhsr")], {
    encoding: "utf8", cwd: 临, timeout: 180000, env: { ...process.env, HMYR_STEPS: "1000" },
  });
  ok("压到一千步就撞上限", /跑得太久|ran for too long|R0102/i.test(String(r.stdout) + String(r.stderr)), JSON.stringify((String(r.stdout) + String(r.stderr)).slice(0, 120)));
}

console.log("五、C 那台也按档位：同一份内容，两个名字，两种资源上限");
{
  // 这一节要编一次 C 那台（二十来秒）。值当：两档不能被只有一侧认 ——
  // 那样「同一份内容的两档入口」在另一台上就成了两个空名字。
  const 有gcc = (() => { try { return spawnSync("gcc", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } })();
  if (!有gcc) {
    console.log("  跳过  这台机器上没有 gcc —— C 那台那一侧不验");
  } else {
    const exe = path.join(临, "hmyr.exe");
    const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe,
      path.join(ROOT, "vm", "hmyr.c"), "-lm"], { encoding: "utf8" });
    ok("C 那台编得出来", 编.status === 0, String(编.stderr).slice(0, 160));
    const 源 = "fn main() -> Int {\n  print(\"C 那台两档一样\" + chr(10))\n  return 0\n}\n";
    for (const 名 of ["c.hmsnp", "c.hmhsr"]) fs.writeFileSync(path.join(临, 名), 源, "utf8");
    const 跑C = (名) => spawnSync(exe, [path.join(临, 名)], { encoding: "utf8", cwd: 临, timeout: 180000,
      env: { ...process.env, HMYR_MEM_LIMIT: "0" } });
    const 甲 = 跑C("c.hmsnp");
    const 乙 = 跑C("c.hmhsr");
    ok("hmsnp 跑得出那句话", (甲.stdout || "").includes("C 那台两档一样"), JSON.stringify((甲.stdout || "").slice(0, 80)));
    ok("hmhsr 跑出同样的话", (乙.stdout || "") === (甲.stdout || ""), JSON.stringify([甲.stdout.slice(0, 60), 乙.stdout.slice(0, 60)]));
  }
}

console.log("六、线程池那一项在 C 那台上真的拦");
{
  // steady 的预设里写着「线程池一个」。在接上之前那只是预设里的一个数字，没人读它。
  // 这一节要看见的是两件事：第二线程起不来，而且它说的是「池满」而不是「这台机器没线程」——
  // 两者都是 -1，但一个该等、一个该换机器。
  //
  // 只在 C 那台上验：JS 侧跑的是最小求值器，它的 thr_spawn 是假的（恒返回 -1），
  // 所以那一侧连「第一个线程」都起不来，测不出池的深浅。
  const exe = path.join(临, "hmyr.exe");
  if (!fs.existsSync(exe)) {
    console.log("  跳过  C 那台没编出来 —— 线程池那一侧不验");
  } else {
    const 行们 = [
      "fn main() -> Int effects(thread) {",
      '  let 库 = "fn main() -> Int {" + chr(10) + "  return 0" + chr(10) + "}" + chr(10)',
      '  let 甲 = thr_spawn(库, "main")',
      '  print("甲=" + str(甲) + chr(10))',
      '  let 乙 = thr_spawn(库, "main")',
      '  print("乙=" + str(乙) + chr(10))',
      "  return 0",
      "}",
    ].join("\n") + "\n";
    for (const 名 of ["t.hmsnp", "t.hmhsr"]) fs.writeFileSync(path.join(临, 名), 行们, "utf8");
    const 跑C = (名) => spawnSync(exe, [path.join(临, 名)], {
      encoding: "utf8", cwd: 临, timeout: 300000,
      env: { ...process.env, HMYR_MEM_LIMIT: "0", HMYR_STEPS: "4000000000" },
    });
    const 紧 = 跑C("t.hmsnp");
    const 宽 = 跑C("t.hmhsr");
    ok("steady 第一个线程起得来", (紧.stdout || "").includes("甲=1"), JSON.stringify((紧.stdout || "").slice(0, 60)));
    ok("steady 第二个线程起不来", (紧.stdout || "").includes("乙=-1"), JSON.stringify((紧.stdout || "").slice(0, 60)));
    ok("而且它说的是「池满」", (紧.stderr || "").includes("HMYR-R0223"), JSON.stringify((紧.stderr || "").slice(-120)));
    ok("elastic 两个线程都起得来", !(宽.stdout || "").includes("乙=-1") && (宽.stdout || "").includes("甲=1"), JSON.stringify((宽.stdout || "").slice(0, 60)));
  }
}

console.log("七、JS 侧也真的会起线程（最小求值器）");
{
  // 在那之前最小求值器的 thr_spawn 是个桩（恒返回 -1），于是「线程」在默认跑法里
  // 只是一个名字。现在它起的是自己的工人（thr-worker-min.mjs），判据两条：
  // 交回来的值是 42，以及 steady 档下第二个线程撞池。
  const 行们 = [
    "fn main() -> Int effects(thread) {",
    '  let 库 = "fn main() -> Int {" + chr(10) + "  return 42" + chr(10) + "}" + chr(10)',
    '  let 手 = thr_spawn(库, "main")',
    '  let 果 = thr_join(手, 30000)',
    '  print("果=" + 果 + chr(10))',
    "  return 0",
    "}",
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(临, "js.hmoca"), 行们, "utf8");
  const 甲 = 跑文件(["js.hmoca"]);
  ok("线程起得来", (甲.stdout || "").includes("果=42"), JSON.stringify((甲.stdout || "").slice(0, 80)) + JSON.stringify((甲.stderr || "").slice(0, 80)));

  // 两个线程：steady 只给一个槽。
  const 两线 = [
    "fn main() -> Int effects(thread) {",
    '  let 库 = "fn main() -> Int {" + chr(10) + "  return 0" + chr(10) + "}" + chr(10)',
    '  let 甲 = thr_spawn(库, "main")',
    '  print("甲=" + str(甲) + chr(10))',
    '  let 乙 = thr_spawn(库, "main")',
    '  print("乙=" + str(乙) + chr(10))',
    "  return 0",
    "}",
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(临, "两线.hmsnp"), 两线, "utf8");
  const 紧 = 跑文件(["两线.hmsnp"], 临, { ...process.env });
  ok("steady 第二个线程撞池", (紧.stderr || "").includes("HMYR-R0223"), JSON.stringify((紧.stdout || "").slice(0, 60)) + JSON.stringify((紧.stderr || "").slice(-120)));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
