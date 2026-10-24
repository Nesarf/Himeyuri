// 量「加载层」的那一半：同一批真实文件，宿主 loader 与 self/ 的解析链各认不认得下来。
//
// selfcov 量的是求值结果（十四段小程序全对），这一套量更早的一步 —— 切词与搭树。
// 加载层认不得一个文件，后面求值再对也没用；而认得了，才谈得上「换掉 src/」。
// 判据只是形状：两边都说 ok，或两边都说错。错误码不必相同 —— 那是下一步的事。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../tools/self-bridge.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const unit = loadUnit(path.join(ROOT, "self/run.hmyr"));
if (!unit.ok) {
  console.log("self/run.hmyr 加载失败：" + JSON.stringify((unit.diagnostics.errors || []).slice(0, 2).map((e) => e.code)));
  process.exit(1);
}
const rt = runUnit(unit, { stepLimit: 40000000000 });
const 只解析 = (源码) => rt.callFunction(rt.functions.get("只解析"), [源码], null);

const 宿主认不认得 = (源码) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  parse(lex(源码, { diagnostics: d }).tokens, { diagnostics: d });
  return d.errors.length ? "错 " + d.errors[0].code : "ok";
};

// 默认只跑根目录那一批，外加 self/ 的六份核心（词法、链、体、语句、求值、运行）。
// 全部 self/ 是 `--全部`：五十四份一起跑要五十五秒，而这一套的价值在「常驻防退」，
// 不在「一次量全」—— 想量全的人加一个开关就是了。
const 全部 = process.argv.includes("--全部");
const 根目录 = fs.readdirSync(ROOT).filter((n) => n.endsWith(".hmyr")).sort();
const 自助名单 = 全部
  ? fs.readdirSync(path.join(ROOT, "self")).filter((n) => n.endsWith(".hmyr")).sort()
  : ["lex.hmyr", "chain.hmyr", "stmt.hmyr", "body.hmyr", "eval.hmyr", "run.hmyr"];
const 文件们 = [
  ...根目录.map((n) => path.join(ROOT, n)),
  ...自助名单.map((n) => path.join(ROOT, "self", n)),
];

let 宿主认 = 0, 自己认 = 0, 一致 = 0;
const 分歧 = [];
for (const 路 of 文件们) {
  const 源 = fs.readFileSync(路, "utf8");
  let 自己 = "";
  try { 自己 = String(只解析(源)).trim(); } catch (e) { 自己 = "抛：" + String(e && e.message).slice(0, 40); }
  let 宿主 = "";
  try { 宿主 = 宿主认不认得(源); } catch (e) { 宿主 = "抛：" + String(e && e.message).slice(0, 40); }
  const 自己好 = 自己.startsWith("ok");
  const 宿主好 = 宿主.startsWith("ok");
  if (自己好) 自己认++;
  if (宿主好) 宿主认++;
  if (自己好 === 宿主好) 一致++;
  else 分歧.push(path.relative(ROOT, 路).padEnd(28) + " self=" + 自己.slice(0, 40) + "  宿主=" + 宿主.slice(0, 40));
}

console.log("样本 " + 文件们.length + " 个文件（根目录 " + 根目录.length + " + self/ " + 自助名单.length + "）");
console.log("宿主认得 " + 宿主认 + " · self 认得 " + 自己认 + " · 判据一致 " + 一致);
if (分歧.length) {
  console.log("");
  console.log("分歧：");
  for (const 行 of 分歧) console.log("  " + 行);
}
process.exit(分歧.length === 0 ? 0 : 1);
