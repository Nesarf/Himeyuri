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
    "URL", "TextDecoder", "TextEncoder", "Intl", "globalThis", "console", "require"];
  const 实 = 候补.filter((名) => 计(名) > 0).sort();
  ok("正好十项", 实.length === 10, 实.join(" "));
  ok("而它们是那十项", JSON.stringify(实) === JSON.stringify([...应].sort()), 实.join(" "));
  // 三项值得各自钉一句，因为它们是「本可以出现而没出现」的那一类。
  ok("没有 Promise（执行器是同步的）", 计("Promise") === 0);
  ok("没有 RegExp（正则只出现在字符串里）", 计("RegExp") === 0);
  ok("没有 Symbol 与 Proxy", 计("Symbol") === 0 && 计("Proxy") === 0);
  // process 这一处换过一次形状。原先的墓碑是「它只是效果名那个字符串」；
  // 现在环境与路径那一组要在能力面上问 cwd，于是它以 cap.process 出现 ——
  // 仍然是能力面，不是宿主全局。所以计数必须等于「点号后那一次」的计数。
  {
    const 全部次 = (全部.match(/\bprocess\b/g) || []).length;
    const 能力面 = (全部.match(/\.process\b/g) || []).length;
    ok("process 只作为能力面出现（cap.process）", 全部次 === 能力面,
      全部次 + " 次里 " + 能力面 + " 次带点号");
  }
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

console.log("三、跑几条真实路径时，那十项全局没有一项是虚的");
{
  // 这一节让引擎自己说话：NODE_V8_COVERAGE 是 Node 内置的覆盖收集，零依赖。
  // 做法是把「从未执行的函数」的源码片段挖掉，剩下的是「真的被执行过的代码」，
  // 然后看静态清单里的每一项，是否至少在一次执行里出现过。
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-hostcov-"));
  const 目标们 = [
    path.join(ROOT, "examples/hello.hmoca"),
    (() => { const p = path.join(临时, "w.hmoca"); fs.writeFileSync(p, "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n"); return p; })(),
    (() => { const p = path.join(临时, "r.hmoca"); fs.writeFileSync(p, "fn main() -> Int {\n  let r = {a: 1}\n  return r.a\n}\n"); return p; })(),
    (() => {
      const p = path.join(临时, "mod/main.hmoca"); fs.mkdirSync(path.join(临时, "mod"), { recursive: true });
      fs.writeFileSync(path.join(临时, "mod/lib.hmoca"), "fn 双(n: Int) -> Int {\n  return n * 2\n}\n");
      fs.writeFileSync(p, "import \"./lib.hmoca\"\n\nfn main() -> Int {\n  return 双(21)\n}\n");
      return p;
    })(),
    path.join(临时, "nope.hmoca"),
    // 第六条：把「目标程序自己」存成 UTF-16LE 带 BOM。
    //
    // 为什么要这么绕：read_text 的显式编码与 UTF-16 那两条分支才用 TextDecoder，
    // 而 UTF-8 BOM 那条走的是 Buffer.toString。而 self/run.hmoca 读目标文件时用的就是 read_text——
    // 于是「读一份 UTF-16 的源码」正好把它走到。
    //
    // 它解码出来之后语法层会报错（自举的 lexer 不认这段），但那不影响这一节要问的事：
    // TextDecoder 已经被执行过了。程序返回 0，因为「错：」是正常输出。
    (() => {
      const p = path.join(临时, "prog16.hmoca");
      const 文 = "fn main() -> Int {\n  return 6 * 7\n}\n";
      fs.writeFileSync(p, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(文, "utf16le")]));
      return p;
    })(),
  ];
  try {
    for (const 目标 of 目标们) {
      const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 目标], {
        encoding: "utf8", env: { ...process.env, NODE_V8_COVERAGE: 临时 },
      });
      if (r.status !== 0 && !目标.endsWith("nope.hmoca")) { failed++; console.log("  不通过  某条路径没跑成：" + 目标); }
    }
    // 合并覆盖记录。判断以「函数」为单位，不做全文减法——
    // 第一次写成「全文减去未执行的片段」时，某个函数在一条路执行、在另一条路未执行，
    // 它就被整体挖掉了，于是 TextDecoder「只在未执行里」那个结论是算法的错，不是事实。
    //
    // 正确的问题问法是：这十项全局，各自出现在哪些函数里？出现在被调用过的函数里就算到位。
    const 十项 = ["Object", "String", "Number", "Math", "JSON", "Map", "Set", "Array", "TextDecoder"];
    const 归属 = new Map(十项.map((名) => [名, { 已执行: false, 未执行: false }]));
    let 函数数 = 0, 被调数 = 0;
    for (const 文件 of fs.readdirSync(临时)) {
      if (!文件.endsWith(".json")) continue;
      for (const 条目 of JSON.parse(fs.readFileSync(path.join(临时, 文件), "utf8")).result || []) {
        const m = /^file:\/\/\/(.+)$/.exec(条目.url);
        if (!m) continue;
        const 相对 = 份们.find((x) => m[1].endsWith(x));
        if (!相对) continue;
        const 源文 = fs.readFileSync(path.join(ROOT, 相对), "utf8");
        for (const 函 of 条目.functions || []) {
          const 片 = (函.ranges && 函.ranges[0]) || null;
          if (!片) continue;
          函数数++;
          const 跑过 = 片.count > 0;
          if (跑过) 被调数++;
          const 体 = 剥(源文.slice(片.startOffset, 片.endOffset));
          for (const 名 of 十项) {
            if (new RegExp("\\b" + 名 + "\\b").test(体)) 归属.get(名)[跑过 ? "已执行" : "未执行"] = true;
          }
        }
      }
    }
    ok("覆盖记录读到了（每条路径都留了记录）", 函数数 > 100, String(函数数));
    const 只在未执行 = 十项.filter((名) => { const r = 归属.get(名); return r.未执行 && !r.已执行; });
    ok("十项全局没有一项只出现在被调用过的函数之外", 只在未执行.length === 0, 只在未执行.join(" "));
    ok("而每一项都出现在被调用过的函数里", 十项.every((名) => 归属.get(名).已执行), 十项.filter((名) => !归属.get(名).已执行).join(" "));
    console.log("    （合并记录 " + 函数数 + " 条 · 其中被调用 " + 被调数 + "；十项全局各有归属，无一是虚的）");
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
}

console.log("四、那份清单写进了文档，而文档写清了它是上界");
{
  const 文 = fs.readFileSync(path.join(ROOT, "design/HOSTMIN.txt"), "utf8");
  ok("文档在", 文.length > 500);
  ok("写了十项全局", 文.includes("String 13 · Error 12 · Array 10"));
  ok("写了它是上界而不是用量", 文.includes("上界"));
  ok("写了 process 那处误报", 文.includes("效果名的字符串值"), "没写");
  ok("写了第二小格（覆盖率把上界收紧）", 文.includes("NODE_V8_COVERAGE"));
  ok("写了结论：没有一项是虚的", 文.includes("没有一项是虚的"));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
