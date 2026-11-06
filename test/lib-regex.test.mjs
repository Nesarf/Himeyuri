// 正则库的验收：同一批模式与文本，HMYR 与宿主的 RegExp 给出同一个答案。
//
// 答案包括两样：整段匹配的位置，与每个捕获组的位置。后者要 JS 的 d 旗标才拿得到
// （hasIndices）—— 光有 m[1] 那一串字符不够：一个把捕获范围错开的引擎也能给出
// 同样的字符串，而位置错了等于组错了。
//
// 为什么比位置而不是「有没有匹配」：一个错位的引擎也常常「有匹配」，而位置错了
// 就等于整件事错了。
//
// 样本分两类。第一类验语法；第二类验捕获组与懒惰量词 —— 里面几条是有意挑的：
// (a|b)+ 对 abab 要给出「最后参与的那一次」（3,4），(x)?y 对 y 要给出「未参与」，
// a(b*)c 对 ac 要给出「参与但空」（1,1），而 a+? 对 aaa 只许吞一个。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// [模式, 文本, 组数]。组数显式写出来 —— 数括号靠猜会把 (?: 算进去。
const 样本 = [
  ["abc", "xxabcyy", 0],
  ["a*b", "aaab", 0],
  ["a*ab", "aaab", 0],
  ["[a-c]+", "zzabc", 0],
  ["[^a]+", "aaXYZ", 0],
  ["^ab", "abc", 0],
  ["^ab", "xab", 0],
  ["ab$", "xab", 0],
  ["ab$", "abc", 0],
  ["a|bc", "zbc", 0],
  ["\\d+", "ab123", 0],
  ["a.c", "abc", 0],
  ["(ab)+", "ababc", 1],
  ["b*", "aaab", 0],
  ["x?", "abc", 0],
  ["[0-9][0-9]", "a42b", 0],
  ["(a+)(b+)", "aabbb", 2],
  ["(?:ab)+c", "ababc", 0],
  ["(a|b)+", "abab", 1],
  ["a(b*)c", "ac", 1],
  ["(x)?y", "y", 1],
  ["((a)(b))", "ab", 3],
  ["a+?", "aaa", 0],
  ["a.*?b", "axxbxxb", 0],
  ["(a+?)(a+)", "aaa", 2],
  ["[a-z]+", "ABCdef", 0],
  ["\\w+", "ab_1-x", 0],
  ["^(a+)(b+)$", "aabb", 2],
  // 下面这十三个是第三次补的：{n} {n,} {n,m} 与懒惰版，以及四种零宽断言。
  ["a{2}", "aaa", 0],
  ["a{2,3}", "aaaa", 0],
  ["a{2,}", "aaaa", 0],
  ["a{2,3}?", "aaaa", 0],
  ["a{3}", "aa", 0],
  ["a{}", "aa", 0],
  ["(?=ab)ab", "abc", 0],
  ["a(?!b)", "ac", 0],
  ["a(?!b)", "ab", 0],
  ["(?<=a)b", "ab", 0],
  ["(?<!a)b", "cb", 0],
  ["(?<=\\d{2})x", "12x", 0],
  ["(?<=a+)b", "aab", 0],
];

const 期望 = (式, 文, 组数) => {
  let m;
  try {
    m = new RegExp(式, "d").exec(文);
  } catch {
    return "编译失败|-";
  }
  if (!m) return "无|-";
  const 整 = m.index + "," + (m.index + m[0].length);
  if (组数 === 0) return 整 + "|-";
  const 组册 = [];
  for (let k = 1; k <= 组数; k++) {
    const 位 = m.indices[k];
    组册.push(位 ? 位[0] + "," + 位[1] : "-1,-1");
  }
  return 整 + "|" + 组册.join(";");
};

const 跑 = () => spawnSync(process.execPath,
  [path.join(ROOT, "bin/hmyr.mjs"), "--compile", "conformance/regex.hmoca"],
  { cwd: ROOT, encoding: "utf8", timeout: 300000 });

console.log("一、探针跑得动");
const r = 跑();
ok("conformance/regex.hmoca 编得动、跑得动", r.status === 0, String(r.stderr || "").slice(0, 200));
const 行们 = String(r.stdout || "").trim().split(/\r?\n/);
ok("打出 " + 样本.length + " 行加两行收尾", 行们.length === 样本.length + 2, String(行们.length));

console.log("二、每一行与 RegExp 相同（含每组的位置）");
for (let i = 0; i < 样本.length; i++) {
  const [式, 文, 组数] = 样本[i];
  const 应 = 式 + "|" + 文 + "|" + 期望(式, 文, 组数);
  ok(式 + " 对 " + 文 + " → " + 期望(式, 文, 组数), 行们[i] === 应, "这边 " + 行们[i]);
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
