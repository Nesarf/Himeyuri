// 「完全独立化」的总验收：证据要汇成一条命令，不然「齐了」只是一句自述。
//
// 这一套不重复那些证据（种子有 seed、世界面有 builtin-gap、工具账本有
// tooling-ledger、运行时路径有 runtime-path）。它只验一件事：
// 那条命令跑出来的表，五条都在，而且结论那一行说的是「齐了」。
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

const r = spawnSync("node", [path.join(ROOT, "tools/independence.mjs")], { encoding: "utf8", cwd: ROOT });
const 出 = String(r.stdout || "");
const 行 = (名) => {
  const m = new RegExp("^\\s*" + 名 + "\\s+(.*)$", "m").exec(出);
  return m ? m[1].trim() : "";
};

console.log("一、那条命令跑得动");
ok("退出码是零", r.status === 0, String(r.status) + " " + String(r.stderr).slice(0, 160));
ok("输出不为空", 出.trim().length > 0, "");

console.log("二、五条都在，而且各自有内容");
ok("种子那一行有字节数", /^\d+ 字节，HMYRB$/.test(行("种子")), 行("种子"));
ok("世界面那行说差零", 行("世界面").includes("差 0 格"), 行("世界面"));
ok("工具账本那行点了项数与两种状态", /^\d+ 项：搬了 \d+，不搬 \d+/.test(行("工具账本")), 行("工具账本"));
ok("运行时路径那行说零工具", 行("运行时路径").includes("零工具"), 行("运行时路径"));

console.log("三、结论说的是「齐了」，而不是「差不多了」");
{
  const 结论 = 行("结论");
  ok("结论里写着近读法齐了", 结论.includes("近读法齐了"), 结论);
  ok("结论里写着远读法逐项结清", 结论.includes("远读法逐项结清"), 结论);
  ok("结论里点了四处的名字", 结论.includes("自举") && 结论.includes("字节码"), 结论);
  ok("没有「没结清」的字样", !结论.includes("没结清"), 结论);
}

console.log("四、那几格的话是能查的（SELFRUN 里真有）");
{
  const 文 = fs.readFileSync(path.join(ROOT, "design/SELFRUN.txt"), "utf8");
  ok("SELFRUN 写了六处对齐的数", 文.includes("自举 64") && 文.includes("宿主 64"), "");
  ok("SELFRUN 写了两种读法的判据", 文.includes("近的那一种") || 文.includes("近读法"), "");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
