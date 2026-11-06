// tools/cond-census.mjs 的基线判据：差额只能变小，不能变大。
//
// 为什么判据是「差额」而不是绝对数：加一条判据时静态与实跑同时加一，差额不变；
// 修好一处被藏起来的判据时实跑加一，差额变小（好事）；而有人把一组判据包进 if
// 而没交代时实跑减几，差额变大 —— 那正是 arm、pipe、socket 那三次的形状。
//
// 这一套验三件：基线是完整的、工具在差额变大时会报、在差额没变时不报。
// 第三件与第二件同样要紧：一个什么都报的工具，红几次之后就没人看了。
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

const 基线路 = path.join(ROOT, "tools/gap-baseline.json");

console.log("一、基线还在，而且记得住每一个套件");
{
  if (!fs.existsSync(基线路)) {
    ok("tools/gap-baseline.json 在", false, "那一份不在就没有可比的");
  } else {
    const 基 = JSON.parse(fs.readFileSync(基线路, "utf8"));
    ok("带着测于与怎么改", typeof 基.测于 === "string" && typeof 基.怎么改 === "string", 基.测于);
    const 项 = Object.entries(基.差额 || {});
    ok("记了超过两百个套件", 项.length > 200, String(项.length));
    ok("每一格都是数字", 项.every(([, v]) => typeof v === "number"),
       JSON.stringify(项.filter(([, v]) => typeof v !== "number").slice(0, 3)));
    // 差额可以是负数：那说明同一条判据在循环里跑了好几次，实跑多于静态。
    // 所以这一格不设下界，也不数负数有几个 —— 那个数随内容变，而判据只有一条：
    // 「它有没有变大」。
  }
}

// 造一份只含一个套件的日志：工具只比这一个，输出小、判断清。
const 跑 = (行) => {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-gap-"));
  const 日路 = path.join(临, "log.txt");
  fs.writeFileSync(日路, 行 + "\n", "utf8");
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, "tools/cond-census.mjs"), 日路], {
      cwd: ROOT, encoding: "utf8", timeout: 120000,
    });
    return String(r.stdout || "");
  } finally {
    fs.rmSync(临, { recursive: true, force: true });
  }
};

console.log("");
console.log("二、差额变大时它要报出来");
{
  // lexer 的静态数是 34：写 30 就是「少跑了四条」，而基线里它是 0。
  const 出 = 跑("  [通过] lexer      30 passed, 0 failed");
  ok("报了 lexer 变大", /变大\s+lexer 从 0 涨到 4/.test(出), 出.split("\n").slice(-2).join(" | "));
}

console.log("");
console.log("三、差额没变时它不许报");
{
  const 出 = 跑("  [通过] lexer      34 passed, 0 failed");
  ok("没有报任何套件变大", /没有一个套件的差额变大/.test(出), 出.split("\n").slice(-2).join(" | "));
  ok("也没有把 lexer 列成变大", !/变大\s+lexer/.test(出));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
