// 正则库的验收：同一批模式与文本，HMYR 与宿主的 RegExp 给出同一个位置。
//
// 为什么比位置而不是「有没有匹配」：一个错位的引擎也常常「有匹配」，而位置错了
// 就等于整件事错了。所以每一行比的是「起,止」两个字。
//
// 对手是 RegExp，因为它就是那个「同一个意思」的定义 —— 这一份要实现的是回溯语义，
// 而 JS 的正则正是回溯。样本里 a*ab 对 aaab 那一条是专门为回退挑的：
// a* 先吞完三个 a，再发现后面要 b 却只剩 b —— 那时必须退回去吞两个。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 与 conformance/regex.hmoca 里那十六个一一对应，顺序也一致。
const 样本 = [
  ["abc", "xxabcyy"],
  ["a*b", "aaab"],
  ["a*ab", "aaab"],
  ["[a-c]+", "zzabc"],
  ["[^a]+", "aaXYZ"],
  ["^ab", "abc"],
  ["^ab", "xab"],
  ["ab$", "xab"],
  ["ab$", "abc"],
  ["a|bc", "zbc"],
  ["\\d+", "ab123"],
  ["a.c", "abc"],
  ["(ab)+", "ababc"],
  ["b*", "aaab"],
  ["x?", "abc"],
  ["[0-9][0-9]", "a42b"],
];

const 期望 = (式, 文) => {
  try {
    const m = new RegExp(式).exec(文);
    return m ? m.index + "," + (m.index + m[0].length) : "无";
  } catch {
    return "编译失败";
  }
};

const 跑 = () => spawnSync(process.execPath,
  [path.join(ROOT, "bin/hmyr.mjs"), "--compile", "conformance/regex.hmoca"],
  { cwd: ROOT, encoding: "utf8", timeout: 300000 });

console.log("一、探针跑得动");
const r = 跑();
ok("conformance/regex.hmoca 编得动、跑得动", r.status === 0, String(r.stderr || "").slice(0, 200));
const 行们 = String(r.stdout || "").trim().split(/\r?\n/);
ok("打出十六行加两行收尾", 行们.length === 样本.length + 2, String(行们.length));

console.log("二、每一行与 RegExp 相同");
for (let i = 0; i < 样本.length; i++) {
  const [式, 文] = 样本[i];
  const 应 = 式 + "|" + 文 + "|" + 期望(式, 文);
  ok(式 + " 对 " + 文 + " → " + 期望(式, 文), 行们[i] === 应, "这边 " + 行们[i]);
}

console.log("三、认不出的模式要被拒绝");
{
  const 那行 = 行们[样本.length];
  ok("坏模式被拒绝", 那行 === "坏模式被拒绝", 那行);
}

console.log("四、全找给出每一个位置");
{
  const 应 = [..."banana".matchAll(/a/g)].map((m) => m.index + "-" + (m.index + 1)).join(";");
  const 那行 = 行们[样本.length + 1];
  ok("全找=" + 应, 那行 === "全找=" + 应, 那行);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
