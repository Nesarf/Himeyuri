// 依赖环：宿主模块图里有没有环 —— 把工程地图缺的那一问变成能重跑的一条。
//
// 为什么要有它（2026-11-07）：工程地图给出依赖边，却不报环，于是「有没有环」
// 一直是一次性的手算。那天算出来全仓只有一个环，就在被一百三十五个文件依赖的
// src/loader.mjs 上；三个解析函数搬去 src/resolve.mjs 之后断了。这一套盯着三件：
//   一、仓库现在没有环（搬完之后的状态不许退回去）；
//   二、检测器自己有牙 —— 造一个环它必须报，造一棵无环的树它必须不报；
//   三、扫不到东西时不许报「零环」—— 一个什么都没扫到的检测器，报零是最危险的那种绿。
//
// 第二条是这一套真正的重点：缺了它，「零环」可能只是检测器坏了。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 有环时工具退出码是 1，execFileSync 会抛 —— 而「抛了」本身就是要区分的结果之一，
// 所以把它接住，把退出码与输出一起交回来。
const 跑 = (参) => {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tools/cycles.mjs"), ...参], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") };
  }
};

const 读JSON = (r) => {
  try { return JSON.parse(r.out); } catch { return null; }
};

// 一、仓库自己
const 本地 = 跑(["--json"]);
const 图 = 读JSON(本地);
ok("仓库这一趟读得出结构化结果", 图 !== null, 本地.out.slice(0, 120));
ok("仓库现在没有依赖环", 图 !== null && 图.cycles.length === 0,
   图 ? "cycles=" + 图.cycles.length + (图.cycles.length ? " " + JSON.stringify(图.cycles[0]) : "") : "");
ok("扫到的文件数说得过去", 图 !== null && 图.files > 300, 图 ? "files=" + 图.files : "");
// 边数多于文件数是「解析真的在工作」的下界：一个把所有 import 都读丢的解析器会给 0。
ok("边数多于文件数（解析在工作）", 图 !== null && 图.edges > 图.files, 图 ? "edges=" + 图.edges : "");
ok("无环时退出码是 0", 本地.code === 0, String(本地.code));

// 二、造一棵有环的树
const 环树 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cycles-ring-"));
const 无环树 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cycles-fine-"));
try {
  fs.writeFileSync(path.join(环树, "甲.mjs"), 'import { 乙 } from "./乙.mjs";\nexport const 甲 = () => 乙();\n');
  fs.writeFileSync(path.join(环树, "乙.mjs"), 'import { 甲 } from "./甲.mjs";\nexport const 乙 = () => 甲();\n');
  const 环 = 读JSON(跑(["--root", 环树, "--json"]));
  ok("造出来的环被报出来", 环 !== null && 环.cycles.length === 1,
     环 ? "cycles=" + 环.cycles.length : "读不出结构化结果");
  ok("环里就是那两个文件",
     环 !== null && 环.cycles.length === 1 && 环.cycles[0].sort().join(",") === "乙.mjs,甲.mjs",
     环 && 环.cycles[0] ? JSON.stringify(环.cycles[0]) : "");
  ok("有环时退出码是 1", 跑(["--root", 环树]).code === 1, "");

  // 动态 import 也是一条边 —— 漏掉它，环就会从这一条缝里长回来。
  fs.writeFileSync(path.join(环树, "丙.mjs"), 'const m = await import("./丁.mjs");\nexport default m;\n');
  fs.writeFileSync(path.join(环树, "丁.mjs"), 'import "./丙.mjs";\nexport const 丁 = 1;\n');
  const 三 = 读JSON(跑(["--root", 环树, "--json"]));
  ok("动态 import 也算一条边", 三 !== null && 三.cycles.length === 2, 三 ? "cycles=" + 三.cycles.length : "");

  // 三、一棵没有环的树：不许报环
  fs.writeFileSync(path.join(无环树, "上头.mjs"), 'import { 下 } from "./下头.mjs";\nexport const 上 = () => 下();\n');
  fs.writeFileSync(path.join(无环树, "下头.mjs"), "export const 下 = () => 1;\n");
  const 净 = 读JSON(跑(["--root", 无环树, "--json"]));
  ok("无环的树报零环", 净 !== null && 净.cycles.length === 0, 净 ? "cycles=" + 净.cycles.length : "");
  ok("无环的树退出码是 0", 跑(["--root", 无环树]).code === 0, "");
  ok("无环的树也真的数到了文件", 净 !== null && 净.files === 2, 净 ? "files=" + 净.files : "");

  // 扫不到东西时不许报「零环」—— 空目录与不存在的目录都不该给出一个绿字。
  const 空树 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cycles-empty-"));
  const 空 = 读JSON(跑(["--root", 空树, "--json"]));
  ok("空目录报到 0 个文件（而不是悄悄说零环）", 空 !== null && 空.files === 0, 空 ? "files=" + 空.files : "");
  fs.rmSync(空树, { recursive: true, force: true });

  const 无此 = 跑(["--root", path.join(os.tmpdir(), "hmyr-cycles-不存在-" + Date.now())]);
  ok("目录不存在时不报零环", 无此.code !== 0 && 读JSON(无此) === null, "exit=" + 无此.code);
} finally {
  fs.rmSync(环树, { recursive: true, force: true });
  fs.rmSync(无环树, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
