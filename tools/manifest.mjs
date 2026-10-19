// 一份清单：这一份发行版里装了什么。
//
// 为什么要有它：design/DISTRO.txt 里数过 Nyarch 的七样，而「清单」是其中一样。
// 没有它，一个发行版说不出「我装了什么」——而说不出的东西，别人没法信任，也没法对比。
//
// 输出是一份 JSON，字段按稳定顺序写，于是它能被 diff：
// 两份清单的差就是两份发行版的差。
//
//   node tools/manifest.mjs            打到标准输出
//   node tools/manifest.mjs --out x.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 读 = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// 一、内核：代码里的内置，与那十五个最小的
const 源 = 读("src/eval.mjs");
const 起 = 源.indexOf("const BUILTINS = {");
let 深 = 0, 终 = -1;
for (let i = 源.indexOf("{", 起); i < 源.length; i++) {
  if (源[i] === "{") 深++;
  else if (源[i] === "}") { 深--; if (深 === 0) { 终 = i; break; } }
}
const 主体 = 源.slice(源.indexOf("{", 起) + 1, 终);
const 内置们 = [];
for (const 行 of 主体.split("\n")) {
  const m = /^  ([a-z_][a-z0-9_]*):/.exec(行);
  if (m) 内置们.push(m[1]);
}

const 运行时文档 = 读("design/RUNTIME.txt");
const 节起 = 运行时文档.indexOf("最小的内置集");
const 节 = 运行时文档.slice(节起, 运行时文档.indexOf("小库该有什么", 节起));
const 效果名 = new Set(["file", "process", "thread"]);
const 最小集 = Array.from(new Set(
  节.split("\n").filter((l) => /^ {4}[a-z_]/.test(l))
    .flatMap((l) => Array.from(l.matchAll(/[a-z_][a-z0-9_]*/g)).map((m) => m[0]))
    .filter((n) => !效果名.has(n))
)).sort();

// 二、标准库：runtime/ 里的文件与函数数
const 库 = [];
const 走 = (dir) => {
  const 全 = path.join(ROOT, dir);
  if (!fs.existsSync(全)) return;
  for (const e of fs.readdirSync(全, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) 走(p);
    else if (e.name.endsWith(".hmyr")) {
      const 文本 = 读(p);
      const 函数 = (文本.match(/^fn /gm) || []).length;
      // 路径写成斜杠：清单要能 diff，而反斜杠只在 Windows 上成立。
      库.push({ file: p.split(path.sep).join("/"), functions: 函数, lines: 文本.split("\n").length });
    }
  }
};
走("runtime");

// 三、套件：check-all 里登记的
const 检查 = 读("tools/check-all.mjs");
const 套件们 = Array.from(检查.matchAll(/\["([a-z0-9]+)", "([^"]+)"/g)).map((m) => ({ name: m[1], path: m[2] }));

// 四、工具与文档
const 工具们 = fs.readdirSync(path.join(ROOT, "tools")).filter((n) => n.endsWith(".mjs")).sort();
const 文档们 = fs.readdirSync(path.join(ROOT, "design")).filter((n) => n.endsWith(".txt")).sort();

const 清单 = {
  name: "himeyuri",
  language: "HMYR",
  generatedAt: new Date().toISOString().slice(0, 10),
  kernel: {
    builtins: 内置们.length,
    minimalSet: 最小集,
  },
  standardLibrary: 库,
  suites: 套件们,
  tools: 工具们,
  documents: 文档们,
};

const 出了 = JSON.stringify(清单, null, 2) + "\n";
const 参 = process.argv.slice(2);
const 出位 = 参.indexOf("--out");
if (出位 >= 0 && 参[出位 + 1]) {
  fs.writeFileSync(path.resolve(参[出位 + 1]), 出了, "utf8");
  console.log("  已写 " + 参[出位 + 1] + "（" + 出了.split("\n").length + " 行）");
} else {
  process.stdout.write(出了);
}
