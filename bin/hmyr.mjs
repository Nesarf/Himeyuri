// HMYR 的启动器：把自举那一层读进来，然后让它自己当程序。
//
//   node bin/hmyr.mjs <file.hmyr>
//
// 它现在只剩三件事，而三件都是「宿主才知道」的：
//
//   一、把自举那一层读进来（它自己是 .hmyr，而读它需要词法与语法）
//   二、把命令行参数递过去（argv 从哪来是宿主的事）
//   三、按语言交回的退出码退出（进程怎么退是宿主的事）
//
// 第一件里的「词法与语法」现在用的是子集那两层（src/subset-lex.mjs + src/subset-parse.mjs），
// 也就是 Stage 0 里不再有 src/lexer.mjs 与 src/parser.mjs 被调到。
// 换过去的依据是那三套套件：六份 token 逐个相同、六份的树逐节点相同（含位置）、
// 以及把它们接进加载器之后两路交出同样的模块顺序、函数表与答案。
//
// 一句明写的代价：子集那两层认得窄，遇上不认的构造会抛，而不是给一棵猜出来的树。
// 于是将来谁往 self/ 里加一个子集还没认的写法，启动器会在这里失败——
// 而在他跑到这里之前，subset-lex / subset-parse / subset-load 三套会先红，红在那个写法上。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 子集读 = (source) => 子集解(切(source));

let 层;
try {
  层 = loadUnit(path.join(ROOT, "self/run.hmyr"), { reader: 子集读 });
} catch (e) {
  // 子集那一层是抛而不是记诊断，于是这里接住它，把它写成与「读不进来」同一种输出。
  // 一个会露出栈的启动器，对读它的人没有用处。
  process.stderr.write("HMYR-R0211 cannot load self/run.hmyr\n  " + e.message + "\n");
  process.exit(1);
}
if (!层.ok) {
  // 自举那一层自己都读不进来，就没有语言可用来说这件事。宿主只好开口。
  process.stderr.write("HMYR-R0211 cannot load self/run.hmyr\n");
  for (const e of 层.diagnostics.errors) process.stderr.write("  " + e.code + " " + e.message + "\n");
  process.exit(1);
}

// 求值器跑在 stage0 模式下：那一层只允许「跑 self/ 那六份真正被走到的」节点与内置
// （十一·五·十三，见 design/BOOTSTRAP.txt 第九节与 test/stage0-eval.test.mjs）。
//
// 这不是把求值器缩小，而是把「它需要多少」变成可执行的约束：六份里哪天有人用上表外的东西，
// 这里会立刻抛，而不是等到某天有人想换掉求值器时才发现「原来还用了这么多」。
const rt = runUnit(层, { stage0: true });
rt.write = (s) => process.stdout.write(s);
rt.writeErr = (s) => process.stderr.write(s);
// 与宿主一致：第一个是「解释器名」位，之后才是参数。语言侧取 argv[1] 当目标。
rt.argv = process.argv.slice(1);

process.exit(rt.callFunction(rt.functions.get("命令行入口"), [], null));
