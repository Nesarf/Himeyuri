// 由位（八个字节 → 一个数）的验收：conformance/lib-f64.hmoca 里那十一节，交给自举那台跑。
//
// 判据的规矩与 conformance/lib-rational.hmoca 一样：全过交回零，否则交回那一条的编号。
// 所以这一页只做两件事 —— 正着跑一次要零；把其中一条改坏之后要非零。
//
// 反向那一条在这里比在 lib-rational 那边更要紧：这一份验的是往返（由位 造出数，
// f64_bytes 写回字节，逐字节相同），而「两处一起错、错得对称」正好能让一份往返判据
// 永远绿。改坏一条让它说出编号，才分得开「对了」与「一起错成一样」。
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
  [path.join(ROOT, "bin", "hmyr.mjs"), 文件], { encoding: "utf8", timeout: 600000 });

console.log("一、十一节判据全过");
{
  const 正 = 跑(path.join(ROOT, "conformance", "lib-f64.hmoca"));
  // 走自举那一条路时，main 的返回值是被打印出来的，而退出码来自 self/run.hmoca
  // 的命令行入口 —— 两者不是一件事，所以看 stdout。
  const 出 = String(正.stdout || "").trim().split("\n").pop() || "";
  ok("交回零", 出 === "0", "stdout 末行 " + 出 + " / stderr " + String(正.stderr || "").slice(0, 140));
}

console.log("二、把往返改坏，它要说得出是哪一条");
{
  // 把 往返 那个函数的最后一行从「返回 同」改成「返回 假」—— 于是第一节就红，
  // 而它交回的编号是 1。临时文件写在 conformance/ 里，因为引 入 用的是相对路径。
  const 原 = path.join(ROOT, "conformance", "lib-f64.hmoca");
  const 坏 = path.join(ROOT, "conformance", ".tmp-bad-f64.hmoca");
  const 文 = fs.readFileSync(原, "utf8").replace("  返回 同\n}", "  返回 假\n}");
  if (文 === fs.readFileSync(原, "utf8")) {
    ok("临时文件确实被改过（否则这一节什么都没验）", false, "返回 同 那个位置没找到");
  } else {
    fs.writeFileSync(坏, 文, "utf8");
    try {
      const r = 跑(坏);
      const 出 = String(r.stdout || "").trim().split("\n").pop() || "";
      ok("交回第一条的编号", 出 === "1", "stdout 末行 " + 出);
    } finally {
      fs.rmSync(坏, { force: true });
    }
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
