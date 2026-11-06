// 时间库的验收：conformance/time.hmoca 那十二行，与宿主的 Date 逐字相同。
//
// 为什么对手是 Date：这一条验的是「同一个日历」。自己写期望值等于把闰年规则抄两遍，
// 而闰年规则恰恰是这个库里最容易错的那一段（1900 不是闰年、2000 是）。
//
// 四样东西逐行比：分解出来的 ISO 串、星期几、合成回来的毫秒、解析回 ISO 串的毫秒。
// 前三样由 Date 直接给，第四样是「一进一出之后还是原来那个数」。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 与 conformance/time.hmoca 里那十二个一一对应，顺序也一致。
const 样本 = [
  0,
  -1,
  1,
  86399999,
  86400000,
  1700000000000,
  951782400000,      // 2000-02-29：400 年周期里的闰日
  -2208988800000,    // 1900-01-01：世纪边界，而 1900 不是闰年
  4102444800000,     // 2100-01-01：下一个世纪边界，2100 也不是闰年
  -86400001,
  253402300799999,   // 9999-12-31T23:59:59.999Z
  1234567890123,
];

const 跑 = () => spawnSync(process.execPath,
  [path.join(ROOT, "bin/hmyr.mjs"), "--compile", "conformance/time.hmoca"],
  { cwd: ROOT, encoding: "utf8", timeout: 300000 });

console.log("一、探针跑得动");
const r = 跑();
ok("conformance/time.hmoca 编得动、跑得动", r.status === 0, String(r.stderr || "").slice(0, 200));

const 行批 = String(r.stdout || "").trim().split(/\r?\n/);
ok("打出十二行加一行拒绝", 行批.length === 样本.length + 1, String(行批.length));

console.log("二、每一行与 Date 相同");
for (let i = 0; i < 样本.length; i++) {
  const ms = 样本[i];
  const d = new Date(ms);
  const 应 = [d.toISOString(), String(d.getUTCDay()), String(ms), String(ms)].join("|");
  ok(ms + " → " + d.toISOString(), 行批[i] === 应, "这边 " + 行批[i]);
}

console.log("三、认不出的串要被拒绝，而不是猜一个日子");
{
  const 末 = 行批[行批.length - 1];
  ok("坏串被拒绝", 末 === "坏串被拒绝", 末);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
