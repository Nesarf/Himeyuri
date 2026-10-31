// 整文件排版：self/fmt.hmoca 与 src/format.mjs 对同一批真实文件的输出相比。
//
// 两件事分开验，因为它们本来就不同：
//   一、没有注释的文件里，两者应当逐字节相同；
//   二、有注释的文件里，自举那一份会把注释留下，而宿主那一份按设计丢弃并报 HMYR-形-001 ——
//       所以「相同」不成立，但该成立的是「去掉注释行之后相同」。
//
// 这一套同时把 SELFRUN 里那句「整文件排版仍在 src/format.mjs」改写成一个可以跑的事实。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { format } from "../src/format.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 自举 = runUnit(loadUnit(path.join(ROOT, "self/fmt.hmoca")), { stepLimit: 400000000 });
const 自举整 = (源) => {
  try { return String(自举.callFunction(自举.functions.get("整文件"), [源], null)).trim(); }
  catch (e) { return "抛错：" + String(e && e.message).slice(0, 80); }
};
const 读 = (路) => fs.readFileSync(path.join(ROOT, 路), "utf8");

console.log("一、没有注释的文件：规范之后两边相同，而汉字那一侧由自举保留");
// 2026-11-02 起两台在关键字写法上不同，而这个不同有来源：
//
//   自举那台（self/fmt.hmoca）从原文按位置切片取字，所以源码里写「返回」它就印「返回」；
//   宿主那台（src/format.mjs）从 AST 重建，而 AST 不记「关键字原来怎么写」，
//   于是它印自己的规范形式 —— 也就是 ASCII。
//
// 这不是哪一个写错了，是两条路能拿到的信息不同。所以判据分两条：
// 一、把汉字写法规范成 ASCII 之后，两边逐行相同（排版那一层是一致的）；
// 二、自举那一侧确实保留了汉字（免得哪一天它悄悄也规范了，而这条没人看）。
// 十五个词的规范（长词在前，免得 否则 被 若 那一条先吃掉）。这份表要与
// src/lexer.mjs 的 关键字别名 同步 —— 那边一加词，这里就要跟，否则这条判据
// 会以「排版不同」的样子报错，而真正的原因是它认不出新写法。
const 规范 = (s) => s
  .replace(/否则/g, "else").replace(/效果串/g, "effects").replace(/不变式/g, "invariant")
  .replace(/返回/g, "return").replace(/引入/g, "import").replace(/常量/g, "const")
  .replace(/借用/g, "borrow").replace(/拥有/g, "own").replace(/托管/g, "managed")
  .replace(/要求/g, "requires").replace(/保证/g, "ensures")
  .replace(/若/g, "if").replace(/定/g, "let").replace(/当/g, "while").replace(/作/g, "as");
for (const 路 of ["examples/arith.hmoca", "examples/over.hmoca", "examples/twice.hmoca"]) {
  const 源 = 读(路);
  const 乙 = String(format(源, { quiet: true }).text).trim();
  const 甲 = 自举整(源);
  ok(路 + "（规范之后）", 规范(甲) === 规范(乙), 规范(甲) === 规范(乙) ? "" : "行数 " + 甲.split("\n").length + " 对 " + 乙.split("\n").length);
  const 有汉字 = /返回|若|定|当/.test(源);
  if (有汉字) ok(路 + "（自举保留了汉字）", /返回|若|定|当/.test(甲), 甲.split("\n").slice(0, 3).join(" / "));
}

console.log("二、有注释的文件：自举那一份把注释留下，宿主那一份按设计丢弃");
{
  const 路 = "examples/demo.hmoca";
  const 源 = 读(路);
  const 甲 = 自举整(源);
  const 乙r = format(源, { quiet: true });
  ok("自举的输出里有注释行", 甲.split("\n").some((l) => l.trim().startsWith("//")), 甲.split("\n")[0]);
  ok("宿主的输出里没有注释行", String(乙r.text).split("\n").every((l) => !l.trim().startsWith("//")));
  // 去掉注释行与空行之后，两岸应当一致 —— 关键字写法同样先规范（理由见第一节那段注释）
  const 洗 = (t) => t.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const a = 洗(甲), b = 洗(String(乙r.text));
  const A = 规范(a.join("\n")), B = 规范(b.join("\n"));
  ok("去掉注释之后两边一致（关键字规范之后）", A === B,
    A === B ? "" : "第 " + (a.findIndex((l, i) => 规范(l) !== 规范(b[i] || "")) + 1) + " 行起不同");
}

console.log("三、行尾的 carriage return 不会漏进输出");
{
  // 输入由这一节自己造：要验的是「排版器不把 CR 漏出去」，那件事不该依赖
  // 仓库里某一份文件的换行方式 —— 那份文件现在是 LF，而判据以前写着「它本身是 CRLF」，
  // 于是这一条红得毫无道理：被测的东西没坏，只是它踩的那块地板换了。
  const 源 = 读("conformance/lib-strings.hmoca").replace(/\r?\n/g, "\r\n");
  ok("输入确实是 CRLF", 源.includes("\r\n"));
  const 甲 = 自举整(源);
  ok("输出里没有 CR", !甲.includes("\r"), 甲.includes("\r") ? "第一处 CR 在第 " + (甲.split("\n").findIndex((l) => l.includes("\r")) + 1) + " 行" : "");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
