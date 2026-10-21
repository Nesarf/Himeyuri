// 能力内核那一层：谁在借世界，而借来的东西能不能换掉。
//
// 这一套钉两件事，而它们是同一件事的两面：
//
//   一、能力层之外不出现 node: 模块。这是一条静态检查——它证明「没有引进来」，
//       而不是「跑的时候没调到」。说清这一点，是因为两者差得很远，而把前者说成后者
//       是这一份里最容易犯的谎。
//   二、换一份能力实现，同一段程序仍然给出同一个值。这一件是行为上的，也是这一层存在的理由：
//       如果换掉能力之后程序的行为变了，那这个「能力层」就只是把 import 挪了个位置。
//
// 第二件事用一个记账的能力来验：它把每一次访问写进一个列表，并交回固定值。
// 于是「程序借了世界什么」从一件要去读源码才知道的事，变成一份可以打印出来的清单。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 读 = (相对) => fs.readFileSync(path.join(ROOT, 相对), "utf8");

// 一份记账的能力：世界照旧（真的读文件、真的问在不在），只是把每一次访问写下来。
//
// 这一份的意义要说清：验的不是「换掉世界，答案不变」——那当然会变，读到 abc 的源码
// 解析不出同样的东西。验的是「换掉接口的实现，答案不变」，而那是这一层能成立的前提。
const 记账能力 = () => {
  const 记 = [];
  const 包 = (组, 名, 真实现) => (...args) => { 记.push(组 + "." + 名); return 真实现(...args); };
  return {
    记,
    cap: {
      file: {
        read: 包("file", "read", (p) => fs.readFileSync(p)),
        exists: 包("file", "exists", (p) => fs.existsSync(p)),
        write: 包("file", "write", (p, buf) => fs.writeFileSync(p, buf)),
      },
      process: { argv: 包("process", "argv", () => ["hmyr", "x.hmyr"]), exec: 包("process", "exec", () => ({ status: 0 })), chdir: 包("process", "chdir", () => {}), cwd: 包("process", "cwd", () => process.cwd()) },
      time: { now: 包("time", "now", () => 1700000000000), sleep: 包("time", "sleep", () => 1) },
      env: { home: 包("env", "home", () => os.homedir()), temp: 包("env", "temp", () => os.tmpdir()) },
      path: { join: 包("path", "join", (...p) => path.join(...p)), resolve: 包("path", "resolve", (...p) => path.resolve(...p)), dirname: 包("path", "dirname", (p) => path.dirname(p)), basename: 包("path", "basename", (p) => path.basename(p)) },
      terminal: { size: 包("terminal", "size", () => ({ columns: 80, rows: 24 })), clear: 包("terminal", "clear", () => ""), escape: 包("terminal", "escape", () => ""), color: 包("terminal", "color", () => ""), hide: 包("terminal", "hide", () => ""), show: 包("terminal", "show", () => "") },
      // Unicode 那一组也在这里：它是数据，和别的组一样可能被换掉。
      unicode: {
        normalize: 包("unicode", "normalize", (s) => s.normalize("NFC")),
        isLetter: 包("unicode", "isLetter", (s) => /\p{L}/u.test(s)),
        isMark: 包("unicode", "isMark", (s) => /\p{M}/u.test(s)),
      },
    },
  };
};

console.log("一、能力层的形状：八组，而每一组都有那一份契约里写着的成员");
{
  const cap = 本机能力();
  for (const 组 of ["file", "process", "time", "env", "path", "terminal", "unicode"]) {
    ok(组 + " 这一组在", cap[组] && typeof cap[组] === "object", typeof cap[组]);
  }
  ok("file 有读、写、问在不在", ["read", "exists", "write"].every((k) => typeof cap.file[k] === "function"));
  ok("process 有跑程序、改目录、取参数", ["exec", "chdir", "argv"].every((k) => typeof cap.process[k] === "function"));
  ok("time 有现在与等一会儿", ["now", "sleep"].every((k) => typeof cap.time[k] === "function"));
  ok("path 有拼、拆", ["join", "resolve", "dirname", "basename"].every((k) => typeof cap.path[k] === "function"));
  ok("terminal 只交回字符串（六件都在）", ["size", "clear", "escape", "color", "hide", "show"].every((k) => typeof cap.terminal[k] === "function"));
  ok("unicode 有归一化与两条属性", ["normalize", "isLetter", "isMark"].every((k) => typeof cap.unicode[k] === "function"));
  ok("unicode 真的能归一化", cap.unicode.normalize("e\u0301") === "\u00e9");
  ok("unicode 真的能分辨字母与附加符", cap.unicode.isLetter("a") === true && cap.unicode.isMark("\u0301") === true);
  // 真的读一次：这一条让「是不是真的接上了」有一个可核的答案。
  ok("file.read 真的读得到一个已知文件", String(cap.file.read(path.join(ROOT, "SPEC.txt")).subarray(0, 8)).toLowerCase().includes("himeyuri"), "读不到");
  ok("file.exists 对不存在的东西说假", cap.file.exists(path.join(ROOT, "没有这个文件.txt")) === false);
}

console.log("二、终端那一组不需要真的有一个终端在场");
{
  const cap = 本机能力({ terminal: { size: { columns: 120, rows: 40 } } });
  const 尺 = cap.terminal.size();
  ok("尺寸取自传进来的那一份", 尺.columns === 120 && 尺.rows === 40, JSON.stringify(尺));
  ok("清屏交回一串转义而不是去清屏", typeof cap.terminal.clear() === "string" && cap.terminal.clear().length > 0);
}

console.log("三、静态：能力层之外不出现 node: 模块");
{
  // 说清这是静态的：它证明「没有引进来」，不证明「跑的时候没调到」。
  // 而那正是静态检查能给的全部，把它的能力说成更多就是不诚实。
  ok("最小求值器不引 node: 模块", !/from "node:/.test(读("src/minimal-eval.mjs")), "引了");
  // 例外也要说清：求值器要拿一份「空的」能力当兜底，而那个模块本身要用 node:。
  ok("能力层自己引 node: 模块（那是它的职责）", /from "node:fs"/.test(读("src/capabilities.mjs")));
}

console.log("四、换一份能力实现，同一段程序仍然给出同一个值");
{
  const { loadUnit } = await import("../src/loader.mjs");
  const { 最小运行 } = await import("../src/minimal-eval.mjs");
  const 层 = loadUnit(path.join(ROOT, "self/run.hmyr"));

  const 跑一次 = (cap) => {
    const rt = 最小运行(层, { capabilities: cap });
    let 出 = "";
    rt.write = (t) => { 出 += t; };
    rt.writeErr = () => {};
    rt.argv = ["hmyr", path.join(ROOT, "examples/hello.hmyr")];
    const 码 = rt.callFunction(rt.functions.get("命令行入口"), [], null);
    return { 码, 出: 出.trim() };
  };

  const 真 = 跑一次(本机能力());
  const 记 = 记账能力();
  const 假 = 跑一次(记.cap);
  ok("真能力给 5", 真.码 === 0 && 真.出 === "5", JSON.stringify(真));
  ok("记账能力也给同一个 5（换掉接口的实现，答案不变）", 假.码 === 真.码 && 假.出 === 真.出, JSON.stringify(假));
  // 而它顺手交出了「这一趟借了什么」的清单：那一份是可核的事实，比一句说明硬。
  ok("记账能力交出了一份访问清单", 记.记.length > 0, String(记.记.length));
  ok("清单里含 file.read（启动器真的读了自举层与目标）", 记.记.includes("file.read"), [...new Set(记.记)].join(" "));
  ok("清单里含 file.exists（它先问在不在）", 记.记.includes("file.exists"), "没有");
  // 只报了这三类中的两类，因为 hello 那条路不写文件、不跑程序、不等时间。
  ok("hello 那条路不写文件、不跑程序、不等时间",
    !记.记.includes("file.write") && !记.记.includes("process.exec") && !记.记.includes("time.sleep"),
    [...new Set(记.记)].join(" "));
}

console.log("五、宿主求值器里的文件内置也走能力层");
{
  const { loadUnit, runUnit } = await import("../src/loader.mjs");
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cap-host-"));
  try {
    const 入口 = path.join(目录, "read.hmyr");
    // main 声明 file 效果才能读：没声明就调 read_text 会撞 R0201，那是另一套钉着的事。
    fs.writeFileSync(入口, "fn main() -> String effects(file) {\n  return read_text(\"SPEC.txt\")\n}\n");
    const 记 = 记账能力();
    const 层 = loadUnit(入口);
    const rt = runUnit(层, { capabilities: 记.cap });
    rt.write = () => {};
    const 值 = rt.callFunction(rt.functions.get("main"), [], null);
    ok("读到的确实是 SPEC 的开头", String(值).toLowerCase().includes("himeyuri"), JSON.stringify(String(值).slice(0, 30)));
    ok("而它走的是能力层（清单里有 file.read）", 记.记.includes("file.read"), [...new Set(记.记)].join(" ") || "（清单是空的）");
    ok("读文件这件事没有绕过能力层去碰 fs", 记.记.filter((x) => x === "file.read").length === 1, 记.记.join(" "));
  } finally {
    fs.rmSync(目录, { recursive: true, force: true });
  }
}

console.log("六、宿主求值器里已经没有一处直连");
{
  const 源 = 读("src/eval.mjs");
  // 判据排除两类行：`rt.cap.*`（已经走能力层）与纯注释（不执行，只是提到那些名字）。
  const 触碰 = 源.split(/\r?\n/).filter((l) => !l.includes("rt.cap.") && !/^\s*\/\//.test(l) && /fs\.|os\.|path\.|process\.|spawnSync|Worker|node:/.test(l));
  ok("求值器里一处直连都没有", 触碰.length === 0, 触碰.join(" | "));
  ok("也没有 node: 的 import", !/from "node:/.test(源), "仍在引");
  // 加载器是 Stage 0 的另一份，它读文件、拼路径，于是它也要拿能力，而不是自己 import fs。
  ok("加载器也不引 node: 模块", !/from "node:/.test(读("src/loader.mjs")), "仍在引");
  // 那两个不再需要的东西也该消失：Node 自己算模块位置（import.meta.dirname），
  // 编码表走能力层读。留着它们就说明还有一条绕过去的路。
  ok("不再用 fileURLToPath 算模块位置", !源.includes("fileURLToPath"));
  // 「求值器也能当命令用」这一面搬到了 bin/run-eval.mjs，而不是被删掉。
  const 命令面 = 读("bin/run-eval.mjs");
  ok("命令行那一面搬到了 bin/run-eval.mjs", 命令面.length > 100);
  ok("而那一条用的是显式给的能力", /capabilities: 本机能力\(\)/.test(命令面), "没有显式给");
  // 一个不给能力的求值器仍然起得来：库要能直接用（默认给本机那一份）。
  // 而它的每一条能力路径都还是从那一个对象上取，于是换一份实现照旧成立。
  const { Runtime } = await import("../src/eval.mjs");
  let 起得来 = true;
  try { new Runtime({}); } catch (e) { 起得来 = false; }
  ok("求值器默认自带本机能力（库用起来不必每次给）", 起得来);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
