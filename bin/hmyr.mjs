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
import net from "node:net";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 本机能力 } from "../src/capabilities.mjs";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";
import * as 数 from "../src/numbers.mjs";
import { 设脱敏, 脱线 } from "../src/redact.mjs";

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
// 两个求值器，而默认是小的那一份：src/minimal-eval.mjs，只认那张量出来的表
// （11 种表达式、5 种语句、16 个内置，见 design/BOOTSTRAP.txt 第九节与第十节）。
//
// --host-eval 换回宿主那份跑，那是给人对照用的：同一份程序两条路给出同一个答案，
// 那才是「这一份能顶替」的证据。--minimal-eval 还认，但已经没有意义了——默认就是它。
//
// --own-scalars 把标量也换成自家那两套：算术走 src/f64.mjs，字符串走 src/units.mjs。
// 它能跑、答案不变，而代价是整数密集处慢约四倍、浮点密集处慢约三百倍
// （design/F64.txt 里量过的那两个数）。所以它不是一个默认，是一个能开的门。
//
// --redact 把诊断里的路径藏起来（换成 <path>），编号一个都不动。
// 默认不藏，因为多数时候人在本地看自己的日志；发出去的日志不该替人说出机器布局。
// 同名环境变量 HMYR_REDACT 也认：有些调用方不方便加参数。
//
// --out <文件> 把 print 的出口换成一个文件。这是「出口可替换」那条规矩的第二个用法：
// 第一个是标准流（默认），第三个会是命名管道或 socket，而它们都不需要语言侧改一行 ——
// print 只认那个出口对象，出口由调用方给。
//
// --pipe <名字> 把 print 的出口换成一个命名管道。这是「出口可替换」那条规矩的第三个用法：
// 第一个是标准流（默认），第二个是 --out 那个文件，而它们都不需要语言侧改一行 ——
// print 只认那个出口对象，出口由调用方给。
//
// 为什么值得单独做一条：程序不必知道自己被谁接走。谁在管道那头听，是调用方的事；
// 而语言侧写的仍然是 print("...")。
//
// 名字按调用方给的用：Windows 是 \\.\pipe\xxx，别的机器上就是一个 FIFO 的路径。
// 默认不开网络这一条照抄 —— 管道是本机的，不是 socket。
const 参数 = process.argv.slice(1);
const 用宿主 = 参数.includes("--host-eval");
const 自家标量 = 参数.includes("--own-scalars");
if (自家标量) 数.用自家算术(true);
if (参数.includes("--redact") || process.env.HMYR_REDACT === "1") 设脱敏(true);

// 带值的开关要从两处剔掉：开关本身与它后面那一个值。
const 取带值 = (名) => {
  const i = 参数.indexOf(名);
  if (i < 0 || i + 1 >= 参数.length) return null;
  return 参数[i + 1];
};
const 出路径 = 取带值("--out");
const 管道名 = 取带值("--pipe");
const 递给语言 = 参数.filter((a, i) => {
  if (a === "--host-eval" || a === "--minimal-eval" || a === "--own-scalars" || a === "--redact") return false;
  if (a === "--out" || a === "--pipe") return false;
  if (i > 0 && (参数[i - 1] === "--out" || 参数[i - 1] === "--pipe")) return false;
  return true;
});

const 能力 = 本机能力();
// 这一层跑的是自举解释器（self/ 那六份），不是用户的程序。解释器替程序执行，
// 必然碰得到全部效果，所以这里关掉内置的效果检查 —— 目标程序的效果由 self/eval.hmyr 查。
//
// 步数上限也要放大：解释器跑一个三百行的目标程序，步数本来就接近默认那五百万；
// 路径长一点、字符串多一点，就越过了。撞上去的样子是「跑得太久」，与「跑错了」很像。
const rt = 用宿主
  ? runUnit(层, { stage0: true })
  : 最小运行(层, { capabilities: 能力, 字符串用码元序列: 自家标量, 检查效果: false, stepLimit: 200000000 });

// 出口：标准流、一个文件，或者一条命名管道。
// 文件那个出口经能力层拿 —— 启动器不自己碰文件系统，那是这一层的规矩
// （test/bootstrap.test.mjs 钉着它）。管道用的是 net，不是文件系统，所以在这里直接连。
let 出口 = null;
let 管道 = null;
if (管道名) {
  管道 = net.connect(管道名);
  // 连不上要出声：静静地把 print 丢掉，比报错更难查。
  管道.on("error", (err) => {
    process.stderr.write("HMYR-E0002 the pipe cannot be opened: " + (在用脱敏() ? "<path>" : String(err && err.message ? err.message : err)) + "\n");
    process.exit(2);
  });
  出口 = { write: (s) => 管道.write(s), close: () => 管道.end() };
} else if (出路径) {
  出口 = 能力.file.stream(出路径);
}
rt.write = (s) => {
  if (出口 !== null) 出口.write(s);
  else process.stdout.write(s);
};
rt.writeErr = (s) => process.stderr.write(脱线(s));
// 与宿主一致：第一个是「解释器名」位，之后才是参数。语言侧取 argv[1] 当目标。
rt.argv = 递给语言;

const 码 = rt.callFunction(rt.functions.get("命令行入口"), [], null);
if (出口 !== null) {
  出口.close();
  if (管道 !== null) {
    // 管道那边是异步的：end() 之后还有一段在飞，process.exit 不会替我们等。
    // 不等的症状是「输出少了一截，而且只在快的时候少」。
    let 走了 = false;
    const 走 = () => { if (!走了) { 走了 = true; process.exit(码); } };
    管道.on("finish", 走);
    管道.on("close", 走);
    setTimeout(走, 2000);
  } else {
    process.exit(码);
  }
} else {
  process.exit(码);
}
