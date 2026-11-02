// 两份工程地图对同一份文件要说同一句话。
//
// D:\himeyuri 自己那份是 tools/impact.mjs（离线、只要 node、不依赖插件被加载）；
// 另一份是 mega-index-map 的 library_project（语言规则当数据存在 lib/project-map.js 里）。
// 两份各自演进过，而规则不同步不会报错 —— 只会让某个人按错的那张去跑套件。
//
// 这里用独立进程直接调 MIM 的那一份，不经过宿主：插件换上新规则要重启宿主，
// 而这台机器的规矩是不许在会话里动宿主。调用点在参数或 MIM_LIB 里给。
//
//   node tools/map-agree.mjs E:/mega-index-map/lib/project-map.js
//
// 没给就跳过并以 0 退出 —— 这个仓库不该因为另一台机器上没装 MIM 而变红。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 库 = process.argv[2] || process.env.MIM_LIB;
if (!库) {
  console.log("跳过：没给 MIM 的 project-map.js（参数或 MIM_LIB）");
  process.exit(0);
}

const { projectMap } = await import(pathToFileURL(path.resolve(库)).href);

let passed = 0, failed = 0;
const ok = (标签, 条件, 细节 = "") => {
  if (条件) { passed++; console.log("  通过  " + 标签 + (细节 ? "  " + 细节 : "")); }
  else { failed++; console.log("  不通过  " + 标签 + "  " + 细节); }
};

// 每个目标：MIM 那边的答案里要有哪个测试文件，impact 那边的名单里要有哪个套件。
// 三条都是 2026-11-02 那两轮里真出过问题的地方 —— 前两条是「命令行里的 .mjs」，
// 第三条是「被 spawn 的脚本自己 import 的 src」。
const 表 = [
  ["tools/hmget.mjs", "test/hmget.test.mjs", "hmget"],
  ["tools/curve-batch.mjs", "test/curve.test.mjs", "curve"],
  ["src/vm.mjs", "test/curve.test.mjs", "curve"],
];

for (const [目标, 要的测试, 要的套件] of 表) {
  const 甲 = projectMap(ROOT, { op: "affects", file: 目标 });
  const 乙 = execFileSync(process.execPath, [path.join(ROOT, "tools/impact.mjs"), 目标, "--suites"], { encoding: "utf8" }).trim();
  const 套件们 = 乙.split(",").map((s) => s.trim()).filter(Boolean);
  ok("MIM 说改 " + 目标 + " 会碰到 " + 要的测试,
    甲.ok === true && (甲.tests || []).includes(要的测试),
    "它给了 " + (甲 && 甲.ok ? (甲.tests || []).length : 0) + " 个测试");
  ok("impact 说改 " + 目标 + " 会碰到 " + 要的套件,
    套件们.includes(要的套件),
    套件们.join(",") || "（空）");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
