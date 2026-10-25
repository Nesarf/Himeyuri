// verify 的验收：它验清单里每一项的哈希，逐行扫，不做整份解析。
//
// 这一套同时盯着两个安静的错误：
//   一、self/verify.hmyr 会 import sha256.hmyr，而两个文件都有 main。加载器把依赖排在前面，
//       于是「先到者赢」会让 sha256 的自测 main 抢走入口 —— 症状是「跑 verify 输出一个哈希」，
//       看起来还像成功。
//   二、逐行扫如果判「这一行含不含某个键」，那么一个名字就叫 sha256 的套件会让它的 name 行
//       被当成哈希行，读出来的哈希是字面量 sha256。
// 两条都不会崩，只会给出一个错答案 —— 所以要各留一条断言。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 临时件放在仓库里、名字带点，跑完删掉 —— 不去占 C 盘的临时目录。
const 临 = fs.mkdtempSync(path.join(ROOT, ".tmp-verify-"));
const 哈 = (p) => createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex").slice(0, 16);

const 造清单 = ({ 坏 = false, 缺 = false, 坏摘要 = false, 无摘要 = false } = {}) => {
  const 清单 = {
    name: "himeyuri",
    language: "HMYR",
    kernel: { builtins: 64, minimalSet: ["print", "len"] },
    standardLibrary: [
      { file: "runtime/text.hmoca", functions: 5, lines: 120, sha256: 哈("runtime/text.hmoca") },
    ],
    suites: [
      { name: "bitops", path: "test/bitops.test.mjs", sha256: 哈("test/bitops.test.mjs") },
      // 这一项的名字就是 sha256：它是上面第二个错误的回归样本。
      { name: "sha256", path: "test/sha256.test.mjs", sha256: 哈("test/sha256.test.mjs") },
    ],
    tools: [{ name: "arm-size.mjs", sha256: 哈("tools/arm-size.mjs") }],
    documents: [{ name: "ARRAY.txt", sha256: 坏 ? "0000000000000000" : 哈("design/ARRAY.txt") }],
  };
  if (缺) 清单.suites.push({ name: "nope", path: "test/does-not-exist.test.mjs", sha256: "0".repeat(16) });
  // digest 算的是「不含 digest 的那份」，与 tools/manifest.mjs 同一规则。
  // 这里用 node 算，被验的是 HMYR 那一边的重建规则 —— 两边独立。
  if (!无摘要) {
    const 底 = JSON.stringify(清单, null, 2);
    清单.digest = 坏摘要 ? "0".repeat(64) : createHash("sha256").update(底).digest("hex");
  }
  return JSON.stringify(清单, null, 2) + "\n";
};

const 写出 = (名, 文) => { const p = path.join(临, 名); fs.writeFileSync(p, 文, "utf8"); return p; };

console.log("一、源码读得动");
const 源路 = path.join(ROOT, "self/verify.hmoca");
ok("self/verify.hmyr 在", fs.existsSync(源路));
const 层 = loadUnit(源路);
ok("加载没有诊断", 层.ok, JSON.stringify((层.diagnostics.errors || []).slice(0, 1).map((e) => e.code)));
ok("它 import 了 sha256（入口抢位那个错的前提）", fs.readFileSync(源路, "utf8").includes('import "./sha256.hmoca"'));

const 跑 = (清单路) => {
  const 出 = [], 错 = [];
  const vm = 跑字节码(层, {
    write: (t) => 出.push(t), writeErr: (t) => 错.push(t),
    argv: ["verify", 清单路], capabilities: 本机能力(), stepLimit: 400000000,
  });
  const r = vm.调用("main", [], null);
  if (!r.ok) return { 码: 1, 出: 出.join(""), 错: 错.join(""), 坏: r.码 + " " + r.话 };
  return { 码: typeof r.值 === "number" ? Math.trunc(r.值) : 0, 出: 出.join(""), 错: 错.join(""), 坏: "" };
};

console.log("二、一份四种形状各就位的清单（file / path / name 两段），全对");
const 好路 = 写出("ok.json", 造清单());
const 好 = 跑(好路);
ok("退出码 0", 好.码 === 0, 好.码 + " " + 好.坏);
ok("五项都验过", 好.出.includes("对得上 5 项"), JSON.stringify(好.出.slice(0, 160)));
ok("没有不对的、没有缺的", 好.出.includes("不对 0 项") && 好.出.includes("缺 0 项"), JSON.stringify(好.出.slice(0, 160)));
ok("末行是判定", 好.出.trim().endsWith("通过"), JSON.stringify(好.出.trim().slice(-40)));
ok("入口没被 sha256 的 main 抢走（输出是判定，不是一串哈希）", 好.出.includes("对得上") && !/^[0-9a-f]{64}$/m.test(好.出.trim()));
ok("名字叫 sha256 的套件不会被当成哈希行", 好.出.includes("对得上 5 项") && !好.出.includes("写着 sha256"));

console.log("三、哈希对不上：报出是哪一项，并把那一行原文一起给出来");
const 坏路 = 写出("bad.json", 造清单({ 坏: true }));
const 坏 = 跑(坏路);
ok("退出码 1", 坏.码 === 1, 坏.码 + " " + 坏.坏);
ok("点名 design/ARRAY.txt", 坏.出.includes("[不通过] design/ARRAY.txt"), JSON.stringify(坏.出.slice(0, 160)));
ok("算出的是真哈希", 坏.出.includes("3e01244c07f6d1ec"), JSON.stringify(坏.出.slice(0, 160)));
ok("带着那一行的原文", 坏.出.includes("0000000000000000") && 坏.出.includes("sha256"), JSON.stringify(坏.出.slice(0, 200)));
ok("末行是判定", 坏.出.trim().endsWith("不通过"));

console.log("四、清单里有路径不存在：记为缺，不算不对");
const 缺路 = 写出("missing.json", 造清单({ 缺: true }));
const 缺 = 跑(缺路);
ok("退出码 1", 缺.码 === 1, 缺.码 + " " + 缺.坏);
ok("缺 1 项", 缺.出.includes("缺 1 项"), JSON.stringify(缺.出.slice(0, 160)));
ok("点名那一项", 缺.出.includes("[缺] test/does-not-exist.test.mjs"), JSON.stringify(缺.出.slice(0, 160)));
ok("其余五项仍算对", 缺.出.includes("对得上 5 项"));

console.log("五、参数不够时给用法，退出码 2");
{
  const 出 = [], 错 = [];
  const vm = 跑字节码(层, { write: (t) => 出.push(t), writeErr: (t) => 错.push(t), argv: ["verify"], capabilities: 本机能力(), stepLimit: 1000000 });
  const r = vm.调用("main", [], null);
  const 码 = r.ok ? (typeof r.值 === "number" ? Math.trunc(r.值) : 0) : r.码;
  ok("退出码 2", 码 === 2, String(码) + " " + (r.ok ? "" : r.话));
  ok("说了用法", 出.join("").includes("用法"), JSON.stringify(出.join("").slice(0, 80)));
}

console.log("六、整份的 digest：删掉它自己、去掉前一行的尾逗号，再算一次");
{
  const 好二 = 跑(好路);
  ok("digest 对得上", 好二.出.includes("整份的 digest 对得上"), JSON.stringify(好二.出.slice(-160)));

  const 缠路 = 写出("baddigest.json", 造清单({ 坏摘要: true }));
  const 缠 = 跑(缠路);
  ok("digest 被改过时退出码 1", 缠.码 === 1, 缠.码 + " " + 缠.坏);
  ok("点名 digest 对不上", 缠.出.includes("整份的 digest 对不上"), JSON.stringify(缠.出.slice(-160)));
  ok("每一项仍然是对的（两条判定互相独立）", 缠.出.includes("对得上 5 项") && 缠.出.includes("不对 0 项"), JSON.stringify(缠.出.slice(0, 120)));

  const 无摘要路 = 写出("nodigest.json", 造清单({ 无摘要: true }));
  const 无摘要 = 跑(无摘要路);
  ok("没有 digest 时说跳过，不判失败", 无摘要.出.includes("没有 digest"), JSON.stringify(无摘要.出.slice(-120)));
  ok("没有 digest 时退出码仍是 0", 无摘要.码 === 0, 无摘要.码 + " " + 无摘要.坏);
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
