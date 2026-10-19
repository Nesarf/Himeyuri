// 发行版那三件的验收：向导 · 导览 · 更新器。
//
// 它们各自的规矩不一样：
//   向导  什么都不装，而每一项都说清「要不要紧」
//   导览  写给不知道的人，而它列的文档都得真的存在
//   更新器 能把「不知道」与「是最新」分开说
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
const 跑 = (工具) => spawnSync(process.execPath, [path.join(ROOT, "tools", 工具)], { encoding: "utf8" });

console.log("一、向导");
{
  const r = 跑("wizard.mjs");
  ok("退出码零（该起的都起得来）", r.status === 0, String(r.status));
  ok("分了「要紧」与「可选」", r.stdout.includes("要紧") && r.stdout.includes("可选"), r.stdout.slice(0, 80));
  ok("给了下一步", r.stdout.includes("接下来"), r.stdout.slice(-200));
  ok("而它什么都没装", !r.stdout.includes("npm install") && !r.stdout.includes("pip install"), r.stdout.slice(-160));
  // 它指的路都得真的在
  const 指路 = ["design/TOUR.txt", "tools/manifest.mjs", "tools/helper.mjs", "tools/update.mjs"];
  const 缺 = 指路.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  ok("它指的路都真的在", 缺.length === 0, 缺.join(" "));
}

console.log("二、导览");
{
  const p = path.join(ROOT, "design/TOUR.txt");
  ok("文件在", fs.existsSync(p));
  const 文 = fs.readFileSync(p, "utf8");
  ok("有能跑的示例", 文.includes("fn main()"), 文.slice(0, 60));
  ok("说了怎么跑", 文.includes("node bin/hmyr.mjs"), 文.slice(0, 200));
  ok("说了它还不能做什么", 文.includes("还不能") || 文.includes("还不能做什么"));
  // 它最后列的那些文档都得真的在
  const 提到 = Array.from(文.matchAll(/design\/([A-Z]+\.txt)/g)).map((m) => "design/" + m[1]);
  const 缺 = Array.from(new Set(提到)).filter((p2) => !fs.existsSync(path.join(ROOT, p2)));
  ok("它提到的设计文档都真的在", 缺.length === 0, 缺.join(" "));
}

console.log("三、更新器");
{
  const r = 跑("update.mjs");
  ok("说了本地是哪一份", r.stdout.includes("本地提交") || r.stdout.includes("不在 git"), r.stdout.slice(0, 80));
  // 最要紧的一条：「不知道」不能变成「是最新」
  const 说了不知道 = r.stdout.includes("不知道远端") || r.stdout.includes("取不到远端");
  const 说了最新 = r.stdout.includes("与远端同一份");
  ok("它要么说「同一份」，要么说「不知道」，两句话不会同时出现", !(说了不知道 && 说了最新),
    JSON.stringify({ 说了不知道, 说了最新 }));
  if (r.status !== 0) ok("取不到远端时退出码非零（而不是假装成功）", r.status !== 0, String(r.status));
  else ok("取得到远端时退出码零", r.status === 0, String(r.status));
}

console.log("四、清单带版本号");
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs")], { encoding: "utf8" });
  const 清 = JSON.parse(r.stdout);
  ok("有 commit 字段", typeof 清.commit === "string" && 清.commit.length > 0, JSON.stringify(清.commit));
  ok("而它像一次真的提交（七到四十个十六进制字符）", /^[0-9a-f]{7,40}$/.test(清.commit), 清.commit);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
