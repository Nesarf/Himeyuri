// 逐步加大：逐行扫一份清单，在哪个规模上撑不住。
//
// 造的是合法清单（JSON.stringify 的两空格形式），每一项的路径都故意不存在 ——
// 这样量到的是「逐行扫」本身，不会被真正的 sha256 掩盖。
//
//   node bench/verify-scale.mjs
//
// 走仓库自己的那一套：self/verify.hmyr 加载进来，用 node 的字节码机器跑。
// 不需要编 C，也不需要事先烘好的 .hmyrb —— 一份脚本在这台机器上就能重跑。
// 代价是每档都多一次编译（约半秒的常数开销），所以小规模那几行看着会偏高。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-bench-"));
const 件 = path.join(临, "scale.json");

const 造 = (项数) => JSON.stringify({
  name: "himeyuri",
  language: "HMYR",
  kernel: { builtins: 64, minimalSet: ["print", "len"] },
  standardLibrary: Array.from({ length: 项数 }, (_, i) => ({
    file: "runtime/x" + i + ".hmoca",
    functions: 1,
    lines: 2,
    sha256: "0123456789abcdef",
  })),
  suites: [],
  tools: [],
  documents: [],
  digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}, null, 2) + "\n";

const 层 = loadUnit(path.join(ROOT, "self/verify.hmoca"));
if (!层.ok) {
  for (const e of 层.diagnostics.errors.slice(0, 4)) console.error(e.code + " " + e.message);
  process.exit(1);
}

for (const 项数 of [10, 40, 160, 640, 2560]) {
  const 文 = 造(项数);
  fs.writeFileSync(件, 文, "utf8");
  const 出 = [];
  const t0 = Date.now();
  const vm = 跑字节码(层, {
    write: (t) => 出.push(t), writeErr: () => {},
    argv: ["verify", 件], capabilities: 本机能力(), stepLimit: 4000000000,
  });
  const r = vm.调用("main", [], null);
  const 秒 = ((Date.now() - t0) / 1000).toFixed(2);
  const 尾 = 出.join("").trim().split("\n").filter((l) => l.includes("对得上")).pop() || (r.ok ? "" : r.码 + " " + r.话);
  console.log("项数 " + String(项数).padStart(5) + "（" + String(文.length).padStart(7) + " 字节）：" + 秒 + " 秒  " + 尾.trim());
}

fs.rmSync(临, { recursive: true, force: true });
