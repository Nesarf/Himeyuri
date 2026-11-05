// 十进制字面量的验收：自举层编出来的数与宿主是同一个数。
//
// 这一条是 design/OPEN.txt 第一条的判据 —— 那一条记的是「次正规字面量读成零」。
// 之前不能写它，因为判据里写 1e-320，它自己就会被读成零，于是那条判据永远绿。
// 现在自举层的 数字值 走的是「尾数乘十的幂、一次舍入」，可以写了。
//
// 对手是宿主：String(Number(字面量))。不是手写常数 —— 手写常数等于把同一份理解
// 抄两遍，而这个仓库已经吃过一次「两边一起错成一样」的亏。
//
// 走 --compile：这一份要验的正是编译期的解析，而 `bin/hmyr.mjs 源码` 那条路
// 用的是最小求值器（它的数到 是另一份实现，不是这一条要验的东西）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 与 conformance/dec-lit.hmoca 里那十二个一一对应，顺序也一致。
const 样本 = [
  "1e-320",
  "1e-323",
  "5e-324",
  "-1e-320",
  "0.1",
  "3.14",
  "1e-5",
  "2.5e-10",
  "9007199254740993",
  "1234567890.123456789",
  "1.7976931348623157e308",
  "1e22",
];

const 跑 = (目标) => spawnSync(process.execPath,
  [path.join(ROOT, "bin/hmyr.mjs"), "--compile", 目标],
  { cwd: ROOT, encoding: "utf8", timeout: 300000 });

console.log("一、自举层与宿主给同一个数");
const r = 跑("conformance/dec-lit.hmoca");
ok("这一份编得动、跑得动", r.status === 0, String(r.stderr || "").slice(0, 200));

const 行 = String(r.stdout || "").trim().split(/\r?\n/);
ok("打出十二行", 行.length === 样本.length, "实际 " + 行.length + " 行");

for (let i = 0; i < 样本.length; i++) {
  const 应 = String(Number(样本[i]));
  ok(样本[i] + " → " + 应, 行[i] === 应, "这边 " + 行[i]);
}

console.log("二、反向：把慢路换回旧写法，判据必须红");
{
  // 旧写法就是被换掉的那一段：先算 10 的幂、再取倒数。1e-320 的 10^320 是无穷，
  // 一除就是零 —— 于是这一节要看到「首行变成 0」，那才说明判据抓得住那个错。
  //
  // 改的是 self/compile.hmoca 本身，所以在 finally 里换回来：这一份跑在别人的
  // 源码上，留下半改的东西比这个判据红更糟。
  // 2026-11-05：数字值 从 compile.hmoca 搬去了 compile-number.hmoca，
  // 所以这一节的破坏性改动要落在新家 —— 否则它找不到那四行，什么都不验就绿了。
  const 原路 = path.join(ROOT, "self/compile-number.hmoca");
  const 原文 = fs.readFileSync(原路, "utf8");
  // 时间戳要一起复原：selfbridge 检查「runtime/*.hmoks 不比它依赖链里任何一份旧」，
  // 而这一节每跑一次都会把 compile.hmoca 的 mtime 推到当下 —— 于是每跑一次这个判据，
  // pack.hmoks 就变旧一次。判据不该有这种副作用，所以改完把 atime 与 mtime 都放回去。
  const 原时 = fs.statSync(原路);
  const 旧路 = [
    "  变 旧幂 = 1.0",
    "  变 旧q = 0",
    "  当 旧q < 0 - 终指 {",
    "    旧幂 = 旧幂 * 10.0",
    "    旧q = 旧q + 1",
    "  }",
    "  变 旧值 = 尾 * 1.0",
    "  若 终指 < 0 {",
    "    旧值 = 旧值 / 旧幂",
    "  } 否则 {",
    "    旧值 = 旧值 * 旧幂",
    "  }",
    "  若 负 {",
    "    返回 0 - 旧值",
    "  }",
    "  返回 旧值",
  ].join("\n");
  const 慢路 = [
    "  若 尾大 {",
    "    返回 由位(装十进制(宽尾, 终指, 负))",
    "  }",
    "  返回 由位(装十进制(宽数(尾), 终指, 负))",
  ].join("\n");
  if (!原文.includes(慢路)) {
    ok("反向改动落到了位置（否则这一节什么都没验）", false, "没找到慢路那四行");
  } else {
    fs.writeFileSync(原路, 原文.replace(慢路, 旧路), "utf8");
    try {
      const rr = 跑("conformance/dec-lit.hmoca");
      const 首 = String(rr.stdout || "").trim().split(/\r?\n/)[0];
      ok("换回旧写法之后 1e-320 读成 0（判据抓得住）", 首 === "0", "首行 " + 首);
    } finally {
      fs.writeFileSync(原路, 原文, "utf8");
      fs.utimesSync(原路, 原时.atime, 原时.mtime);
    }
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
