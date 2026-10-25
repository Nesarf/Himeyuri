// 种子与内置表同步：种子是提交的产物，它不会自己跟上源码。
//
// 这一套的由来：跑一段用 split 的程序，走 hmyr prog.hmoca 那条路（种子编译），
// 得到 HMYR-R0104 there is no such function。而 split 是早就搬完的一格。
// 于是量了一下种子到底认得多少 —— 七十二个内置里只认得三十一个。
//
// 为什么以前没人发现：self-contained 那一套验的是「可执行文件自带编译器」，
// 而它跑的例子只用 print 与 str。判据通过，能力缺了一整批。这是「判据不发声」
// 的又一例，也是为什么这一套要单独存在而不是塞进 self-contained：
// 那一套的十五项判据都是好的，不该被这一条拖红。
//
// 判据只有一条：种子认得全部内置。重建种子（bootstrap-seed 那一格，挂 HMYR_HEAVY）
// 之后它就该绿。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const r = spawnSync(process.execPath, [path.join(ROOT, "tools/seed-gap.mjs")], { encoding: "utf8" });
const 文 = String(r.stdout || "") + String(r.stderr || "");

ok("seed-gap 跑得通", 文.includes("种子认得哪些内置"), String(r.stderr).slice(0, 200));

// 自证那一行是这一套的前提：判据要能看见已知存在的东西（print），
// 也要能拒绝一个不存在的名字 —— 否则「全部认得」可能只是「什么都算认得」。
ok("判据自证通过（print 认得 · 一个假名字不认得）", /自证：print 认得 · 一个假名字 不认得/.test(文),
  String(/自证[^\n]*/.exec(文)?.[0] || "（没有这一行）"));

const m = /不认识\s+(\d+)\s+个/.exec(文);
const 缺 = m ? Number(m[1]) : -1;
ok("种子认得全部内置", 缺 === 0,
  "现在有 " + (缺 < 0 ? "?" : 缺) + " 个内置种子不认识；重建种子之后应当为 0");

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
