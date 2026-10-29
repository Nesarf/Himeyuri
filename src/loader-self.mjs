// loadUnit 的自举替身（2026-11-01）。
//
// 顺序取自 self/ 的 加载顺序公开 —— 那一条与宿主的 order 已经对齐过（selfmod 那套
// 量具比的是 order 逐项相同），所以顺序这一层不必再证。
// 语法树仍由宿主的 subset-parse 建：自举层只交回「顺序」，树由宿主自己解析，
// 形状才自动一致（design/FULLSELF.txt 第五节）。
//
// 它需要一台 C 机器：自举层的词法器在最小求值器上跑不动真文件（每个 token 一层
// 递归，而那边只有五百层），所以走字节码。机器路径由 HMYR_C_VM 给出；
// 没有它的时候这一层只交回 order，不交回 ast —— 那仍然够 FULLSELF 那 115 个
// 「只要顺序」的调用方用。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex, Diagnostics } from "./lexer.mjs";
import { 子集解 } from "./subset-parse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 适配源 = path.join(ROOT, "self", "adapter.hmoca");
const 缓存目录 = process.env.HMYR_CACHE || path.join(ROOT, ".cache");

// 适配层的字节码是「adapter.hmoca 加它 import 的整条链」合并出来的，所以判断
// 「还能不能用」必须看整条链的最新修改时间，不能只看 adapter.hmoca 一个。
//
// 为什么（2026-11-01）：原来只比较 adapter.hmoca，于是改了 self/run.hmoca 与
// self/lex.hmoca 之后字节码从不重编 —— 一整轮实验都跑在旧码上，读数全是假的。
// 这里用「整个 self/ 目录里最晚的 .hmoca」当判据：链的成员随时会变，
// 而多编一次的代价只有一秒，比读到一份假读数便宜得多。
function 链最新() {
  let 新 = 0;
  try {
    const 目录 = path.join(ROOT, "self");
    for (const 名 of fs.readdirSync(目录)) {
      if (!名.endsWith(".hmoca")) continue;
      const m = fs.statSync(path.join(目录, 名)).mtimeMs;
      if (m > 新) 新 = m;
    }
  } catch {
    /* 目录读不出来就当作没有更新，走下面那条「不重编」的路。 */
  }
  return 新;
}

function 编适配层() {
  const 码 = path.join(缓存目录, "adapter-self.hmoks");
  try {
    if (fs.existsSync(码) && fs.statSync(码).mtimeMs >= 链最新()) return 码;
  } catch {
    /* 缓存目录不存在或读不到 —— 往下走，去编一份。 */
  }
  try {
    fs.mkdirSync(缓存目录, { recursive: true });
  } catch {
    return null;
  }
  if (process.env.HMYR_SELF_TRACE) console.error("[self] 编适配层 → " + 码);
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "emit-code.mjs"), 适配源, 码], {
    encoding: "utf8",
    // 没有超时的时候，一次坏掉的编译可以把整个套件挂住（2026-11-01 实测：三十分钟无输出）。
    timeout: 120000,
  });
  return r.status === 0 && fs.existsSync(码) ? 码 : null;
}

// 缓存：同一个入口文件、同一个 mtime，它的 order 不会变 —— 而 check-all 里每个套件
// 都是一个独立进程，所以进程内的 Map 没有用，要落到磁盘上（2026-11-01）。
// 键里带 mtime：文件一改就是新键，旧的留着无害。
function 缓存路(绝对) {
  let stamp = 0;
  try {
    stamp = Math.floor(fs.statSync(绝对).mtimeMs);
  } catch {
    stamp = 0;
  }
  const 名 = createHash("sha1").update(绝对 + ":" + stamp).digest("hex").slice(0, 16);
  return path.join(缓存目录, "loader-self", 名 + ".json");
}

// 自举层交回的 order：一个路径一行。它的 拼路径 不做归一（会留下 /a/../b 这种），
// 所以这里补一次 path.resolve —— 那是这一层唯一要替它做的事。
// 子进程的环境：别把 HMYR_LOADER 传下去。
//
// 为什么（2026-11-01）：那个开关会传染 —— 子进程也会用自举加载器，而每用一次
// 又起一个 C 机器。量起点数那一次就是这样把机器推到五百个 node 进程的。
// 步限也给足：默认的五百万步对 self/ 下几百行的文件不够。
function 子环境() {
  const 环境 = { ...process.env, HMYR_STEPS: "200000000" };
  delete 环境.HMYR_LOADER;
  return 环境;
}

function 取顺序(机器, 码, 目录, 相对, 绝对) {
  const 存 = 缓存路(绝对);
  try {
    const 旧 = JSON.parse(fs.readFileSync(存, "utf8"));
    if (Array.isArray(旧) && 旧.length) return { order: 旧.map((s) => path.resolve(s)) };
  } catch {
    /* 没有缓存或读坏了 —— 往下走，去问自举层。 */
  }
  if (process.env.HMYR_SELF_TRACE) console.error("[self] 取顺序 → " + 绝对);
  const r = spawnSync(机器, [码, 目录, 相对], {
    encoding: "utf8",
    // 步限提到启动器主路径那一档：默认的五百万步对 self/ 下几百行的文件不够，
    // 症状是 HMYR-R0102 the program ran for too long（2026-11-01 实测）。
    env: 子环境(),
    // 同上：一次运行没有上限，就是一颗能挂住整个套件的钉子。
    timeout: 120000,
  });
  if (r.status !== 0) {
    return { 错: String(r.stderr || r.stdout || "").trim() || "适配层退出码 " + r.status };
  }
  const 行们 = String(r.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (行们.length === 1 && 行们[0].startsWith("错 ")) return { 错: 行们[0].slice(2) };
  const order = 行们.map((s) => path.resolve(s));
  try {
    fs.mkdirSync(path.dirname(存), { recursive: true });
    fs.writeFileSync(存, JSON.stringify(order), "utf8");
  } catch {
    /* 缓存写不进去不影响这一次的结果。 */
  }
  return { order };
}

/**
 * 与 src/loader.mjs 的 loadUnit 同形状：{ ok, order, modules, 别名表, diagnostics }。
 *
 * 差别写在这里：别名表 这一层不产出（那是包清单的事，还没搬）；没有 C 机器时
 * modules 是空 Map，而 order 仍然是对的。
 */
export function loadUnitSelf(entry, options = {}) {
  const diagnostics = options.diagnostics || new Diagnostics();
  const 机器 = options.机器 || process.env.HMYR_C_VM || "";
  const 绝对 = path.resolve(entry);
  if (!fs.existsSync(绝对)) {
    diagnostics.error("E0302", "cannot read " + 绝对);
    return { ok: false, order: [], modules: new Map(), 别名表: new Map(), diagnostics };
  }

  const 目录 = path.dirname(绝对);
  const 相对 = "./" + path.basename(绝对);
  const 码 = 机器 ? 编适配层() : null;
  if (!机器 || !码) {
    diagnostics.error("E0303", "自举侧的适配层需要一台 C 机器（HMYR_C_VM 未给出）");
    return { ok: false, order: [], modules: new Map(), 别名表: new Map(), diagnostics };
  }

  const 结果 = 取顺序(机器, 码, 目录, 相对, 绝对);
  if (结果.错) {
    /* 自举层交回的错码是 E0301（环）与 E0302（缺文件），与本仓库宿主那一侧同码。 */
    const 码名 = 结果.错.slice(0, 5);
    diagnostics.error(码名 === "E0301" ? "E0301" : "E0302", 结果.错);
    return { ok: false, order: [], modules: new Map(), 别名表: new Map(), diagnostics };
  }

  const order = 结果.order;
  const modules = new Map();
  for (const abs of order) {
    let 源 = "";
    try {
      源 = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const 切好 = lex(源);
    const 解 = 子集解(切好);
    modules.set(abs, 解.ast);
  }
  return { ok: diagnostics.errors.length === 0, order, modules, 别名表: new Map(), diagnostics };
}
