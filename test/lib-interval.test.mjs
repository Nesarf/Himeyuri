// 区间数的验收：conformance/lib-interval.hmoca 里那九条，交给自举那台跑。
//
// 正着跑一次要交回零；把其中一条改坏之后要交回那一条的编号。
// 判据看的是 stdout，不是退出码 —— 自举那条路上 main 的值是被打印出来的，
// 而退出码来自 self/run.hmoca 的 命令行入口（这一条在有理数那一份里第一次撞到）。
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

console.log("一、九条判据全过");
{
  const 正 = 跑(path.join(ROOT, "conformance", "lib-interval.hmoca"));
  ok("交回零", String(正.stdout || "").trim() === "0",
     String(正.stdout || "").slice(0, 60) + " " + String(正.stderr || "").slice(0, 120));
}

console.log("二、改坏一条，它要说得出是哪一条");
{
  // 第一条是「[1,2] 加 [3,4] 的下界正好是 4」。把它改成 5，那一条该红。
  const 原 = path.join(ROOT, "conformance", "lib-interval.hmoca");
  const 坏 = path.join(ROOT, "conformance", ".tmp-bad-interval.hmoca");
  const 文 = fs.readFileSync(原, "utf8").replace("检(下界(和) == 4.0, 1)", "检(下界(和) == 5.0, 1)");
  fs.writeFileSync(坏, 文, "utf8");
  try {
    const 坏跑 = 跑(坏);
    ok("改坏之后交回的不是零", String(坏跑.stdout || "").trim() !== "0", JSON.stringify(String(坏跑.stdout || "").slice(0, 40)));
    ok("而且说的是第一条", String(坏跑.stdout || "").trim() === "1", JSON.stringify(String(坏跑.stdout || "").slice(0, 60)));
  } finally {
    fs.rmSync(坏, { force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
