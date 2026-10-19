// HMYR 的启动器：把 .hmyr 交给语言自己。
//
//   node bin/hmyr.mjs <file.hmyr>
//
// 这一步还借宿主一件事：**把 self/ 那六件读进来**（它们本身是 .hmyr 文件，
// 而读它们需要宿主自己的词法与求值器）。除此之外，目标程序的词法、语法、语句与求值
// 全部由自举那六件做——这就是它与「node 直接跑宿主求值器」的区别。
//
// 能力边界照旧写在明处：内核只做四件事——读文件、写终端、取环境、退出码。
// 其余一概交给语言。等自举能认声明了，连「包一层函数壳」也会由它自己做。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);

const target = process.argv[2];
if (!target) {
  process.stderr.write("用法：node bin/hmyr.mjs <file.hmyr>\n");
  process.exit(2);
}

// 借宿主的那一件事：把自举的六件读进来。之后目标程序不再经过宿主的语言层。
const rt = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")));
rt.write = (s) => process.stdout.write(s);

let 源码;
try {
  源码 = fs.readFileSync(path.resolve(target), "utf8");
} catch (err) {
  // 读不到就报编号，与 capabilities 那份契约一致（R0211）。
  process.stderr.write("HMYR-R0211 cannot read '" + target + "': " + String(err && err.message ? err.message : err) + "\n");
  process.exit(1);
}

// 读目标文件，以及它 import 的那几个。
//
// 只认「一行 import \"./x.hmyr\"」这种写法：够用，而且不假装认得别的形式。
// 读文件是能力内核的事；合并与去重是语言的事（self/run.hmyr 的 跑模块们）。
const 源码们 = [];
const 读过 = new Set();
const 读 = (p) => {
  const 绝对 = path.resolve(p);
  if (读过.has(绝对)) return;
  读过.add(绝对);
  const 内容 = fs.readFileSync(绝对, "utf8");
  源码们.push(内容);
  const re = /^\s*import\s+"([^"]+)"\s*$/gm;
  let m;
  while ((m = re.exec(内容)) !== null) {
    const 它 = path.resolve(path.dirname(绝对), m[1]);
    if (fs.existsSync(它)) 读(它);
  }
};
读(target);

const 结果 = rt.callFunction(rt.functions.get("跑模块们"), [源码们], null);
process.stdout.write(String(结果) + "\n");
