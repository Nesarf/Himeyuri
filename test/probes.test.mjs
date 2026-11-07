// probes/ 下的诊断探针：编得动，而且今天跑得动的那一批要跑一遍。
//
// 这些文件原来是 examples/probe-*.hmoca —— 它们是当时为了缩一个问题写的一次性诊断，
// 不是给新人的示例。2026-11-04 把它们搬到 probes/，因为它们是 examples 判据从 41 秒
// 涨到 232 秒的原因。
//
// 2026-11-06 改了这一套的立意：原来只编不跑，理由是「跑起来要么慢、要么要参数」。
// 那天把十五份挨个跑了一遍，全部跑得动，最慢的一份二十秒，一共七十九秒。于是
// 「跑不动」这个理由不成立了，而只编不跑留下一个更大的空子 —— 探针记的是当时的
// 症状与当时的数字，问题修好之后那些数字会变，而只看编译永远看不出来。
//
// 所以现在分两条：编得动（底线），以及「输出与 probes/expected.json 记的一样」。
// 后者是「答案的时效」这一件事的判据：数字变了就红，而红了之后要判断的是
// 「探针该更新」还是「世界变了」—— 那正是留这些探针的意义。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 目录 = path.join(ROOT, "probes");
const 份簇 = fs.existsSync(目录)
  ? fs.readdirSync(目录).filter((f) => f.endsWith(".hmoca")).sort()
  : [];

console.log("一、probes/ 下有一批探针");
ok("至少十份", 份簇.length >= 10, String(份簇.length) + " 份");

console.log("二、每一份都编得动");
const 编起 = Date.now();
{
  const 坏例 = [];
  for (const f of 份簇) {
    const u = loadUnit(path.join(目录, f));
    if (!u.ok) {
      const 码 = u.diagnostics.errors.slice(0, 1).map((e) => e.code).join(",");
      坏例.push(f + "(" + 码 + ")");
    }
  }
  ok("这一批都编得动（" + 份簇.length + " 份）", 坏例.length === 0, 坏例.join(" · "));
}
const 编毫秒 = Date.now() - 编起;

console.log("");
console.log("三、跑一遍，输出与 probes/expected.json 记的一样");
{
  const 期望路 = path.join(目录, "expected.json");
  if (!fs.existsSync(期望路)) {
    ok("expected.json 在", false, "缺那一份就没有可比的");
  } else {
    const 期望 = JSON.parse(fs.readFileSync(期望路, "utf8"));
    const 归一 = (s) => String(s || "").trim().split("\n").map((l) => l.split(ROOT).join("<root>")).join("\n");
    const 变 = [];
    const 账 = [];
    for (const [f, 项] of Object.entries(期望.项)) {
      const 起 = Date.now();
      const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), path.join(目录, f)], {
        cwd: ROOT, encoding: "utf8", timeout: 120000,
      });
      账.push({ 名: f, 毫秒: Date.now() - 起 });
      const 出 = 归一(r.stdout);
      if (r.status !== 项.码 || 出 !== 项.出) {
        变.push(f + "：" + (r.status !== 项.码 ? "退出码 " + r.status + " 对 " + 项.码
          : "输出 " + JSON.stringify(出.slice(0, 40)) + " 对 " + JSON.stringify(项.出.slice(0, 40))));
      }
    }
    ok("这" + 份簇.length + " 份的输出都没变", 变.length === 0, 变.slice(0, 3).join(" · "));
    // 这一行是为了回答「慢在哪一段」。第五节原来没有数 —— 而这一套是全量里最慢的
    // （197.0 秒，另两轮 190.9 与 169.5），只知道自己最慢回答不了该动哪里。
    // 编走的是进程内的 loadUnit，跑是每份起一个 node 去跑 bin/hmyr.mjs（自举层），
    // 两者没有共同的钟，所以分开记。
    if (账.length) {
      const 跑 = 账.reduce((a, b) => a + b.毫秒, 0);
      const 慢 = [...账].sort((a, b) => b.毫秒 - a.毫秒).slice(0, 3)
        .map((x) => x.名.replace(/\.hmoca$/, "") + " " + (x.毫秒 / 1000).toFixed(1) + "s").join(" · ");
      console.log("");
      console.log("这一趟：编 " + (编毫秒 / 1000).toFixed(1) + "s · 跑 " + (跑 / 1000).toFixed(1) +
        "s（" + 账.length + " 份，平均 " + (跑 / 账.length / 1000).toFixed(1) + "s）· 最慢 " + 慢);
    }
  }
}

console.log("");
console.log("四、examples/ 里不再有 probe-*（搬干净了）");
{
  const 例子 = path.join(ROOT, "examples");
  const 剩 = fs.readdirSync(例子).filter((f) => f.startsWith("probe-"));
  ok("examples/ 下一个 probe-* 都没有", 剩.length === 0, 剩.join(" "));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
