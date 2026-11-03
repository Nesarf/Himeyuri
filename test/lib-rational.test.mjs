// 有理数的验收：conformance/lib-rational.hmoca 里那五条，交给自举那台跑。
//
// 判据的规矩与 conformance/lib-numbers.hmoca 一样：全过交回零，否则交回那一条的编号。
// 所以这一页只做两件事 —— 正着跑一次要零；把其中一条改坏之后要非零。
//
// 为什么加反向那一条：一份永远交回零的判据不是判据。而「改坏之后它还说零」这种错，
// 在正着跑的那一次里看不出来。
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

const 跑 = (文件) => spawnSync(process.execPath,
  [path.join(ROOT, "bin", "hmyr.mjs"), 文件], { encoding: "utf8", timeout: 300000 });

console.log("一、五条判据全过");
{
  const 正 = 跑(path.join(ROOT, "conformance", "lib-rational.hmoca"));
  ok("退出码零", 正.status === 0, String(正.status) + " " + String(正.stderr || "").slice(0, 140));
}

console.log("二、改坏一条，它要说得出是哪一条");
{
  // 把第一条的期望从 1 改成 2 —— 于是 1/3 + 2/3 不再「等于 2」，第 1 条该红。
  // 临时文件写在 conformance/ 里，因为引入用的是相对路径；跑完就删。
  const 原 = path.join(ROOT, "conformance", "lib-rational.hmoca");
  const 坏 = path.join(ROOT, "conformance", ".tmp-bad-rational.hmoca");
  const 文 = fs.readFileSync(原, "utf8").replace("等有理(和, 从两数(1, 1)), 1", "等有理(和, 从两数(2, 1)), 1");
  fs.writeFileSync(坏, 文, "utf8");
  try {
    const 坏跑 = 跑(坏);
    // 判据看的是 stdout 里那个数，不是退出码。走自举那一条路时，main 的返回值是被
    // 打印出来的，而退出码来自 self/run.hmoca 的 命令行入口 —— 两者不是一件事。
    // design/LIB.txt 说「退出码就是那一条的编号」，那句话在自举这条路上并不成立；
    // 2026-11-03 在这条判据里第一次撞到，于是这里按实际行为写。
    ok("改坏之后交回的不是零", String(坏跑.stdout || "").trim() !== "0", JSON.stringify(String(坏跑.stdout || "").slice(0, 40)));
    ok("而且说的是第一条", String(坏跑.stdout || "").trim() === "1", JSON.stringify(String(坏跑.stdout || "").slice(0, 60)));
  } finally {
    fs.rmSync(坏, { force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
