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
import { 设脱敏, 在用脱敏, 脱线 } from "../src/redact.mjs";

// 编译执行那一面：与这个入口的另一面（解释）相对照。
//
// 解释那一面走 self/run.hmyr，会把 main 的返回值也打出来 —— 那是 REPL 的显示选择。
// 编译这一面不打印返回值，跑的就是程序本身 —— 这才与 C 那台 hmyr <源码.hmyr> 的语义一致，
// 于是「同一个程序，两台机器」这句话就有了可以逐字节比较的两个入口。
if (process.argv.includes("--compile")) {
  const 其余 = process.argv.slice(2).filter((x) =>
    x !== "--compile" && x !== "--host-scalars" && x !== "--own-scalars" && x !== "--own-arithmetic");
  const 目标 = 其余[0];
  if (!目标) {
    console.error("用法：node bin/hmyr.mjs --compile 程序.hmyr [参数...]");
    process.exit(2);
  }
  // 不引入 fs：加载器自己读文件，而这个启动器「不直接碰文件系统」是一条被验收盯着的性质。
  const [{ loadUnit }, { 跑字节码 }, { 本机能力 }, path] = await Promise.all([
    import("../src/loader.mjs"),
    import("../src/vm.mjs"),
    import("../src/capabilities.mjs"),
    import("node:path"),
  ]);
  const 绝对 = path.resolve(目标);
  const 层 = loadUnit(绝对);
  if (!层.ok) {
    for (const e of 层.diagnostics.errors) console.error(e.code + " " + e.message);
    process.exit(1);
  }
  try {
    const vm = 跑字节码(层, {
      capabilities: 本机能力(),
      argv: [目标, ...其余.slice(1)],
      stepLimit: Number(process.env.HMYR_STEPS || 50000000),
      // 与解释那条路同一个默认：字符串住在码元序列里。
      字符串用码元序列: !process.argv.includes("--host-scalars"),
    });
    vm.write = (s) => process.stdout.write(s);
    vm.writeErr = (s) => process.stderr.write(s);
    const r = vm.调用("main", [], null);
    if (!r.ok) { console.error(r.码 + " " + r.话); process.exit(1); }
    process.exit(typeof r.值 === "number" ? Math.trunc(r.值) : 0);
  } catch (e) {
    // 编译器遇到它不认的形状（比如一个字段调用）时抛的是 编译错，而它带编号。
    // 一个会露出栈的启动器，对读它的人没有用处 —— 那句话已经写在下面装载自举层的地方。
    if (e && e.code && String(e.code).startsWith("HMYR-")) {
      console.error(e.code + " " + e.message);
      process.exit(1);
    }
    throw e;
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 子集读 = (source) => 子集解(切(source));

let 层;
try {
  层 = loadUnit(path.join(ROOT, "self/run.hmoca"), { reader: 子集读 });
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
// 第一个是标准流（默认），后两个是 --pipe 与 --socket，而它们都不需要语言侧改一行 ——
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
//
// --socket <形状> 把 print 的出口换成一条 socket。这是「出口可替换」那条规矩的第四个用法，
// 也是四个里唯一一个能连到另一台机器的：前三个都在本机（标准流、文件、命名管道）。
//
// 形状由前缀说明，三种写在同一行上：
//
//   tcp:host:port         TCP。host 不能省，要本机就明写 127.0.0.1；IPv6 字面量暂不支持。
//   pipe:<名字>           Windows 命名管道，名字照写 \\.\pipe\xxx。
//   unix:<路径>           Unix 域套接字，只在 POSIX 上有意义（Windows 上 Node 没有它）。
//
// 前缀与路径之间用冒号切；路径里可以再有冒号，所以只切第一个，TCP 那一种再从最后切一次。
//
// 默认不开。不带 --socket 时出口仍是标准流，一行都不变 —— 这一条是故意的，理由写在
// design/RELAY.txt 的「第四个出口」那一段：一个默认就能往外连的解释器，等于把
// 「这台机器能不能上网」变成「这个程序能不能上网」。
//
// 连不上要出声，报 HMYR-E0002 并以 2 退出。形状写错也报同一个编号，
// 因为这两种的结果一样：输出没有去处。退回标准流是更坏的选择 —— 那是静默丢输出。
import { 档位, 档预设, 档步限 } from "../tools/file-kind.mjs";

const 参数 = process.argv.slice(1);

// --no-zone-check 是启动器自己的开关，解释器那边不认识它。留着它，自举层会把它
// 当成一个文件路径去读（症状是「cannot read './--no-zone-check'」）——
// 所以它在这里就被拿掉，与「谁消费哪个开关」这件事一起留在这一行。
const 区检查关 = 参数.includes("--no-zone-check");
if (区检查关) 参数.splice(参数.indexOf("--no-zone-check"), 1);

// 容器：给一个 .hm-ittgn-krgn-m 时直接跑它 —— 解到临时目录，把参数里那个路径换成入口。
// 判据只看后缀，与 C 那台看 .hmoca 是同一条规矩：不猜文件内容。
// 入口由 src/ittgn.mjs 挑（先源码后字节码，先 main 后与包同名），这里不重复那一套判断。
{
  // 只看「目标」那一个位置：第一个非开关参数。否则 --装 后面那个包路径也会被当成要跑的容器，
  // 于是「装一个还不存在的包」会先被这里截住，报一句读不到。
  const 第几 = 参数.findIndex((a) => !a.startsWith("--"));
  const 是容器目标 = 第几 >= 0 && 参数[第几].toLowerCase().endsWith(".hm-ittgn-krgn-m");
  if (是容器目标) {
    const { 解容器 } = await import("../src/ittgn.mjs");
    const 解 = 解容器(path.resolve(参数[第几]));
    if (!解.ok) { process.stderr.write(解.错 + "\n"); process.exit(1); }
    参数[第几] = 解.入口;
  }
}
const 用宿主 = 参数.includes("--host-eval");
// 两件事拆开：字符串的底（默认码元序列）与数的算术（默认宿主，因为自家那份慢三百倍）。
// 拆开是为了量的时候分得清是哪一件引起的 —— 合在一个开关里，红了也不知道该收回哪一个。
const 自家标量 = !参数.includes("--host-scalars");
// 自家算术现在是默认；--host-arithmetic 退回宿主那一条（对照与排查用）。
// --own-arithmetic 仍然接受，那是同一个意思，留着不报错。
const 自家算术 = !参数.includes("--host-arithmetic");
if (!自家算术) 数.用自家算术(false);
if (参数.includes("--redact") || process.env.HMYR_REDACT === "1") 设脱敏(true);

// 带值的开关要从两处剔掉：开关本身与它后面那一个值。
const 取带值 = (名) => {
  const i = 参数.indexOf(名);
  if (i < 0 || i + 1 >= 参数.length) return null;
  return 参数[i + 1];
};
const 出路径 = 取带值("--out");
const 管道名 = 取带值("--pipe");
const 套接字规 = 取带值("--socket");
const 递给语言 = 参数.filter((a, i) => {
  if (a === "--host-eval" || a === "--minimal-eval" || a === "--own-scalars" || a === "--redact") return false;
  if (a === "--out" || a === "--pipe" || a === "--socket") return false;
  if (i > 0 && (参数[i - 1] === "--out" || 参数[i - 1] === "--pipe" || 参数[i - 1] === "--socket")) return false;
  return true;
});

// 把 --socket 的取值拆成「连什么」。拆不出来时交回 null，由调用处出声。
//
// 只切第一个冒号：前缀之后是名字或路径，而路径里本来就可以有冒号（Windows 的
// \\.\pipe\ 里就有两个）。TCP 那一种再从最后一个冒号切一次，这样 host 可以是
// 域名、可以带点的 IPv4，而端口永远是最后那一截。
//
// IPv6 字面量暂不支持：它自带冒号，与这个切法打架。要支持得先约好方括号写法，
// 而那是一件值得单独想清楚的事，不是这里顺手能加的。
const 解套接字 = (规) => {
  const 分 = 规.indexOf(":");
  if (分 < 0) return null;
  const 族 = 规.slice(0, 分);
  const 余 = 规.slice(分 + 1);
  if (族 === "tcp") {
    const 末 = 余.lastIndexOf(":");
    if (末 <= 0) return null;
    const 端口字 = 余.slice(末 + 1);
    if (!/^[0-9]+$/.test(端口字)) return null;
    const 端口 = Number(端口字);
    if (端口 < 1 || 端口 > 65535) return null;
    return { 族: "tcp", 主机: 余.slice(0, 末), 端口 };
  }
  // pipe: 与 unix: 在实现上是同一条路（net.connect 收一个名字），分开写只是让
  // 命令行上那句意图读得出来：一个是 Windows 的命名管道，一个是 POSIX 的套接字文件。
  if (族 === "pipe" || 族 === "unix") {
    if (余 === "") return null;
    return { 族, 路径: 余 };
  }
  return null;
};

// 档位：hmsnp 与 hmhsr 是同一份内容的两档入口，而决定行为的是名字 ——
// 档位由后缀定，判断只有一处（tools/file-kind.mjs 的 档位）。
// steady 走得稳：步限五百万、线程池一个；elastic 吃满硬件：步限两亿、线程不设限。
// 没有档位（.hmoca）时保持原来那两个数 —— 普通文件的跑法不该因为多了两档而变。
const 目标路 = 参数.slice(1).find((a) => !a.startsWith("--"));
const 档 = 档位(目标路);
// 环境变量仍然优先：HMYR_STEPS 是「我这次就要这个数」，比档位的预设更近。
const 步限 = Number(process.env.HMYR_STEPS || 0) || 档步限(目标路);
// 线程上限也由档位给 —— 能力层不知道谁还活着，它只收下这个数，
// 而「活着的线程数不能超过它」这一条在 vm-builtins.mjs 的 thr_spawn 里兑现。
const 能力 = 本机能力({ 线程上限: 档 ? 档预设[档].线程 : 0 });

// 三区模型的编译期那一半（design/MEMORY.txt 第一条硬规则）。
//
// 检查放在这里，是因为默认这条路把解析交给了自举层：用户程序由 self/ 里那份装载器读，
// 而它写在 HMYR 里，调不到宿主的检查器。所以在把命令行交给解释器之前，
// 宿主先用自己那两层把入口读一遍 —— 只为区检查的报告。
//
// 只有区那一条会拦。读不动的（子集那一层认的窄，遇上看不懂的构造会抛）与别的诊断
// 一律放过去：那些事由解释器那边说，启动器不替它讲，否则「我读不懂」会变成
// 「你的程序错了」—— 那两句之间的差别，正是这一层最不该抹掉的东西。
//
// --no-zone-check 关掉它。开关必须存在：一条误报会把整条路堵死，
// 而堵死之后人只会去改启动器。
if (目标路 && !区检查关) {
  let 检查 = null;
  try {
    检查 = loadUnit(path.resolve(目标路), { capabilities: 能力 });
  } catch {
    检查 = null;
  }
  if (检查) {
    for (const w of 检查.diagnostics.warnings) {
      if (w.code === "HMYR-載-016") process.stderr.write(w.code + " " + w.message + "\n");
    }
    const 区错 = 检查.diagnostics.errors.filter((e) => e.code === "HMYR-R0301");
    if (区错.length) {
      for (const e of 区错) process.stderr.write(e.code + " " + e.message + "\n");
      process.exit(1);
    }
  }
}

// 这一层跑的是自举解释器（self/ 那六份），不是用户的程序。解释器替程序执行，
// 必然碰得到全部效果，所以这里关掉内置的效果检查 —— 目标程序的效果由 self/eval.hmyr 查。
//
// 步数上限也要放大：解释器跑一个三百行的目标程序，步数本来就接近默认那五百万；
// 路径长一点、字符串多一点，就越过了。撞上去的样子是「跑得太久」，与「跑错了」很像。
const rt = 用宿主
  ? runUnit(层, { stage0: true })
  : 最小运行(层, { capabilities: 能力, 字符串用码元序列: 自家标量, 检查效果: false, stepLimit: 步限 });

// 出口：标准流、一条命名管道、一条 socket，或者一个文件。
// 文件那个出口经能力层拿 —— 启动器不自己碰文件系统，那是这一层的规矩
// （test/bootstrap.test.mjs 钉着它）。管道与 socket 用的是 net，不是文件系统，所以在这里直接连。
//
// 同时给多个出口时按 --pipe、--socket、--out 的顺序取第一个：三个都是显式给的，
// 而先给的那个更具体。这一条只写在这里 —— 脚本里不该同时给两个，写了也没有好处。
let 出口 = null;
// 异步的出口要先记下来：它们的 end() 之后还有一段在飞，收尾时要等（见文件末尾）。
let 异步口 = null;
if (管道名) {
  const 管道 = net.connect(管道名);
  // 连不上要出声：静静地把 print 丢掉，比报错更难查。
  管道.on("error", (err) => {
    process.stderr.write("HMYR-行-021 the pipe cannot be opened: " + (在用脱敏() ? "<path>" : String(err && err.message ? err.message : err)) + "\n");
    process.exit(2);
  });
  出口 = { write: (s) => 管道.write(s), close: () => 管道.end() };
  异步口 = 管道;
} else if (套接字规) {
  const 点 = 解套接字(套接字规);
  if (点 === null) {
    // 形状写错时报的是同一个编号：结果一样，输出没有去处。
    // 消息里把三种形状念一遍，因为写错的人此刻最需要的就是这句。
    process.stderr.write("HMYR-行-021 the socket cannot be opened: expected tcp:host:port, pipe:<name> or unix:<path>\n");
    process.exit(2);
  }
  const 连 = 点.族 === "tcp" ? net.connect(点.端口, 点.主机) : net.connect(点.路径);
  连.on("error", (err) => {
    // 原因照实说。开了脱敏、而形状里带着的是一段路径时，那一截换成 <path>：
    // TCP 的 host 与 port 不是路径，删掉它反而让人不知道自己在连什么。
    const 因 = String(err && err.message ? err.message : err);
    process.stderr.write("HMYR-行-021 the socket cannot be opened: " + (在用脱敏() && 点.族 !== "tcp" ? "<path>" : 因) + "\n");
    process.exit(2);
  });
  出口 = { write: (s) => 连.write(s), close: () => 连.end() };
  异步口 = 连;
} else if (参数.includes("--socket")) {
  // 写了开关却没有值。这一种最容易被当成「没给」而静默退回标准流，
  // 于是要在这里接住：与形状写错是同一件事 —— 用户要的那条出口没有建立起来。
  process.stderr.write("HMYR-行-021 the socket cannot be opened: --socket needs a value, <shape> follows it in the next argument\n");
  process.exit(2);
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
  if (异步口 !== null) {
    // 管道与 socket 那边都是异步的：end() 之后还有一段在飞，process.exit 不会替我们等。
    // 不等的症状是「输出少了一截，而且只在快的时候少」。
    // 两秒的定时器是兜底：对面收了 FIN 却迟迟不给 close 时，仍然要退出去。
    let 走了 = false;
    const 走 = () => { if (!走了) { 走了 = true; process.exit(码); } };
    异步口.on("finish", 走);
    异步口.on("close", 走);
    setTimeout(走, 2000);
  } else {
    process.exit(码);
  }
} else {
  process.exit(码);
}
