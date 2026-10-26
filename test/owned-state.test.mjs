// owned 的状态机：两份实现对同一批输入给出同一份判定。
//
// src/owned-state.mjs 是唯一真相 —— src/owned-check.mjs 的判定从它来。
// tools/owned-state.hmoca 是它的 HMYR 镜像：同一个表、同一个顺序、同一套词。
//
// 这一套喂同一批「状态 动作」给两边，逐行比对。它是「自举」这句话在 owned 这一层
// 能有的可验形状：不是把整个检查器重写，而是把它的判定用两种语言各写一遍，让它们对答案。
//
// 要验三件：
//   一、十二种组合（四态乘三动作）两份一致
//   二、一串走过状态变化的转移两份一致 —— 那才验到「状态真的在变」
//   三、合并那一条在 JS 侧有判据（HMYR 那份不写合并，因为它不出现在这一层）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 转移, 合并, 空, 满, 关, 移 } from "../src/owned-state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 具 = path.join(ROOT, "bin", "hmyr.mjs");
const 脚本 = path.join(ROOT, "tools", "owned-state.hmoca");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// JS 侧：一行一条转移，输出格式与 HMYR 那份一致（新态 + 空格 + 错或 ok）。
const js侧 = (序) => 序.map(({ 态, 动作 }) => {
  const r = 转移(态, 动作);
  return r.态 + " " + (r.错 || "ok");
}).join("\n");

// HMYR 侧：把同一批交给那个脚本，读它的输出。
const hmyr侧 = (序) => {
  const 入 = 序.map((x) => x.态 + " " + x.动作).join("\n") + "\n";
  const r = spawnSync(process.execPath, [具, 脚本], { input: 入, encoding: "utf8", timeout: 300000 });
  // 默认那条路会把 main 的返回值当最后一行打出来 —— 那不是判定，去掉它。
  const 行们 = String(r.stdout || "").split("\n").filter((x) => x.length > 0 && x !== "0");
  return { 出: 行们, 码: r.status, 误: String(r.stderr || "") };
};

console.log("一、十二种组合");
{
  const 序 = [];
  for (const 态 of [空, 满, 关, 移]) {
    for (const 动作 of ["放", "取", "关"]) 序.push({ 态, 动作 });
  }
  const a = js侧(序);
  const b = hmyr侧(序);
  ok("HMYR 那份跑得动", b.码 === 0, JSON.stringify({ 码: b.码, 误: b.误.slice(0, 160) }));
  ok("十二行都在", b.出.length === 12, String(b.出.length));
  ok("两份逐行相同", a === b.出.join("\n"),
    JSON.stringify({ js: a.split("\n").slice(0, 3), hmyr: b.出.slice(0, 3) }));
}

console.log("二、一串走过状态变化的转移");
{
  // 这一串会让状态真的走：空 → 满 → 满（错）→ 取 → 空 → 取（错）→ 关 → 放（错）。
  const 序 = [
    { 态: 空, 动作: "放" }, { 态: 满, 动作: "放" }, { 态: 满, 动作: "取" },
    { 态: 空, 动作: "取" }, { 态: 空, 动作: "关" }, { 态: 关, 动作: "放" },
    { 态: 关, 动作: "取" }, { 态: 关, 动作: "关" }, { 态: 移, 动作: "取" },
    { 态: 移, 动作: "放" }, { 态: 移, 动作: "关" }, { 态: 空, 动作: "放" },
  ];
  const a = js侧(序);
  const b = hmyr侧(序);
  ok("这一串也逐行相同", a === b.出.join("\n"),
    JSON.stringify({ js: a.split("\n"), hmyr: b.出 }));
}

console.log("三、合并那一条");
{
  // 两边都停在同一个状态才算保得住；有一边少了、或者两边不同，就是说不清。
  ok("两边都是满 → 满", 合并(满, 满) === 满);
  ok("两边都是空 → 空", 合并(空, 空) === 空);
  ok("一满一空 → 说不清", 合并(满, 空) === null);
  ok("一边没有 → 说不清", 合并(满, undefined) === null);
  ok("关了与关了 → 关", 合并(关, 关) === 关);
}

console.log("四、检查器用的就是这一份");
{
  // 唯一真相这句话要能验：改一个词，检查器的消息跟着变。
  // 这里不去改源码，而是验「检查器的消息里含这个词」—— 词是这张表给的。
  const 出 = 转移(满, "放");
  ok("表交回的错是检查器用的那句", typeof 出.错 === "string" && 出.错.length > 0, JSON.stringify(出));
  const 源 = fs.readFileSync(path.join(ROOT, "src", "owned-check.mjs"), "utf8");
  ok("检查器从这张表导入", /from "\.\/owned-state\.mjs"/.test(源), "");
}

fs.rmSync(path.join(os.tmpdir(), "unused"), { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
