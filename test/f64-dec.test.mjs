// 十进制装配的验收：conformance/f64-dec.hmoca 跑出来的八个字节，与 src/decimal.mjs 相同。
//
// 为什么对手是 src/decimal.mjs 而不是手写常数：这一条验的正是「自举那一层把
// 十进制字面量读成零」那个缺口（design/OPEN.txt 第一条）。手写常数等于把我对这个
// 算法的理解抄两遍，抄错了两边一起错 —— 而这条路上已经试过一次「两边一起错成一样」。
//
// 样本挑的四类：正规、次正规、溢出、下溢。次正规那一类是这个文件存在的理由 ——
// 1e-320 在自举层那边读成零，而在这里它该是 0x00000000000007e8。
//
// 走 --compile 而不是直接跑源码：直接跑走的是最小求值器，步限按「小程序」定的，
// 而装十进制要乘 320 次 5 的幂、再除 320 次 —— 那是二十万步量级，会撞限。
// 编成字节码之后跑得快三个数量级，这也是 cvm 与 vmrun 那几套一直的做法。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 装十进制 } from "../src/decimal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 位模式（BigInt）→ 八个字节、低字节先，与探针打印的十六个十六进制字符同一个顺序。
const 八字 = (位) => {
  let 出 = "";
  for (let i = 0; i < 8; i++) 出 += Number((位 >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0");
  return 出;
};

const 样本组 = [
  ["一", 1n, 0n],
  ["三分之一档：0.1", 1n, -1n],
  ["二分之一", 5n, -1n],
  ["往右一点", 123456789n, -8n],
  ["大尾数", 123456789012345678901234567890n, -30n],
  ["次正规：1e-320", 1n, -320n],
  ["次正规：1e-323", 1n, -323n],
  ["下溢：1e-324", 1n, -324n],
  ["快路下溢：1e-400", 1n, -400n],
  ["最大的有限档：1e308", 1n, 308n],
  ["溢出：1e309", 1n, 309n],
  ["负号：0.1 的相反数", 1n, -1n, true],
  ["零尾数", 0n, -5n],
];

for (const 条 of 样本组) {
  const [名, 尾, 指, 负 = false] = 条;
  const 应 = 八字(装十进制(尾, Number(指), 负));
  const r = spawnSync(process.execPath,
    [path.join(ROOT, "bin/hmyr.mjs"), "--compile", "conformance/f64-dec.hmoca",
    尾.toString(16), String(指), 负 ? "1" : "0"],
    { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  const 出 = String(r.stdout || "").trim().split(/\r?\n/).pop() || "";
  ok(名 + "：" + 应, r.status === 0 && 出 === 应,
    r.status !== 0 ? String(r.stderr || "").slice(0, 160) : (出 + " 对 " + 应));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
