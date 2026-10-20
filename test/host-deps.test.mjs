// Stage 0 依赖宿主的哪些语言原语：三张表，逐个对上。
//
// 这一套钉的是 design/HOSTMIN.txt 那份清单。它扫的不是「运行时真的调到」，
// 而是「源码里出现了什么」——所以它是上界，而不是用量。这一点写在文件头，
// 因为把上界说成用量是这类统计最容易犯的错。
//
// 剥注释与字符串是必须的：第一次扫的时候 process 冒出来了，而它只是字符串里的效果名。
// 一个误报会让清单多一条，而清单里的每一条都有人会当成「必须提供」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 剥掉注释与字符串，只留下代码。剥得粗一点没关系：这里要的是「名字出没出现在代码里」，
// 不是一份能喂给编译器的源码。
const 剥 = (文) => 文
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ")
  .replace(/([^:])\/\/.*$/gm, "$1")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, "``");

const 份们 = ["src/minimal-eval.mjs", "src/loader.mjs", "src/subset-lex.mjs", "src/subset-parse.mjs", "src/diagnostics.mjs"];
const 源们 = 份们.map((相对) => 剥(fs.readFileSync(path.join(ROOT, 相对), "utf8")));
const 全部 = 源们.join("\n");

const 计 = (词) => (全部.match(new RegExp("\\b" + 词 + "\\b", "g")) || []).length;

console.log("一、宿主全局：正好这十项");
{
  const 应 = ["String", "Error", "Array", "Math", "JSON", "Map", "Set", "Object", "Number", "TextDecoder"];
  const 候补 = ["Object", "Array", "String", "Number", "Boolean", "Math", "JSON", "Date", "Map", "Set",
    "WeakMap", "WeakSet", "RegExp", "Error", "TypeError", "RangeError", "Symbol", "Promise", "Buffer",
    "URL", "TextDecoder", "TextEncoder", "Intl", "globalThis", "process", "console", "require"];
  const 实 = 候补.filter((名) => 计(名) > 0).sort();
  ok("正好十项", 实.length === 10, 实.join(" "));
  ok("而它们是那十项", JSON.stringify(实) === JSON.stringify([...应].sort()), 实.join(" "));
  // 三项值得各自钉一句，因为它们是「本可以出现而没出现」的那一类。
  ok("没有 Promise（执行器是同步的）", 计("Promise") === 0);
  ok("没有 RegExp（正则只出现在字符串里）", 计("RegExp") === 0);
  ok("没有 Symbol 与 Proxy", 计("Symbol") === 0 && 计("Proxy") === 0);
  // 一处旧误报的墓碑：process 在剥掉字符串之后必须为零。
  ok("process 不算依赖（它只是效果名的字符串值）", 计("process") === 0, String(计("process")));
}

console.log("二、语言构造：正好这八种");
{
  const 构造 = [
    ["class", /\bclass\s+\S/],
    ["try/catch", /\btry\s*\{/],
    ["throw", /\bthrow\b/],
    ["instanceof", /\binstanceof\b/],
    ["new", /\bnew\s+[A-Z]/],
    ["spread", /\.\.\./],
    ["arrow", /=>/],
    ["getter/setter", /\b(get|set)\s+\w+\s*\(/],
  ];
  const 用 = 构造.filter(([, 论]) => 论.test(全部)).map(([名]) => 名);
  ok("正好八种", 用.length === 8, 用.join(" "));
  ok("没有 async/await", !/\b(async|await)\b/.test(全部));
  ok("没有模板字面量", !/`/.test(全部));
  ok("没有可选链与空值合并", !/\?\./.test(全部) && !/\?\?/.test(全部));
}

console.log("三、那份清单写进了文档，而文档写清了它是上界");
{
  const 文 = fs.readFileSync(path.join(ROOT, "design/HOSTMIN.txt"), "utf8");
  ok("文档在", 文.length > 500);
  ok("写了十项全局", 文.includes("String 13 · Error 12 · Array 10"));
  ok("写了它是上界而不是用量", 文.includes("上界"));
  ok("写了 process 那处误报", 文.includes("效果名的字符串值"), "没写");
  ok("写了下一步的两个候选", 文.includes("量下界") || 文.includes("包一层"));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
