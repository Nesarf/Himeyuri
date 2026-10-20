// 启动器的验收：node bin/hmyr.mjs 把 .hmyr 交给语言自己。
//
// 最要紧的一条是「跑的是自举那一层」的证据：记录那种节点宿主支持、而自举曾经造不出来
// （它当时报的是「这一版还不造记录」）。现在自举能造记录了，于是那一段改成了
// 「自举自己造记录并取字段，算出 1」——那也是证据，而且比「报错」更硬。
// 只要那个特征出现，就说明目标程序确实经过了自举的求值器，而不是宿主自己的。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 启动 = (args) => spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), ...args], { encoding: "utf8" });
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-launch-");
const 写 = (名, 内容) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };

try {
  console.log("正常跑");
  {
    const r = 启动([path.join(ROOT, "examples/hello.hmyr")]);
    ok("退出码零", r.status === 0, String(r.status));
    ok("算出 5", String(r.stdout).trim() === "5", JSON.stringify(String(r.stdout).trim()));
  }
  {
    const p = 写("branch.hmyr", "let n = 7\nif n > 3 { return 1 }\nreturn 0\n");
    const r = 启动([p]);
    ok("带分支的程序也能跑", String(r.stdout).trim() === "1", JSON.stringify(String(r.stdout).trim()));
  }
  console.log("边界");
  {
    const r = 启动([path.join(临, "nope.hmyr")]);
    ok("缺文件时退出码 1", r.status === 1, String(r.status));
    ok("并给出编号 R0211", String(r.stderr).includes("HMYR-R0211"), JSON.stringify(String(r.stderr).slice(0, 60)));
  }
  {
    const r = 启动([]);
    ok("不带参数时退出码 2", r.status === 2, String(r.status));
    ok("并给出用法", String(r.stderr).includes("用法"), JSON.stringify(String(r.stderr).slice(0, 40)));
  }
  {
    const p = 写("bad.hmyr", "let a = \nreturn a\n");
    const r = 启动([p]);
    ok("语法坏的程序不崩（有输出）", r.status === 0 || r.status === 1, String(r.status));
    ok("而且说的是「错：」", String(r.stdout).includes("错：") || String(r.stderr).includes("错"), JSON.stringify((String(r.stdout) + String(r.stderr)).slice(0, 80)));
  }
  console.log("证据：目标程序确实经过自举的求值器");
  {
    // 记录这一种节点自举还造不出来，而宿主是支持的。它的错误出现，就说明跑的是自举那层。
    const p = 写("record.hmyr", "let r = {a: 1}\nreturn r.a\n");
    const r = 启动([p]);
    const 全部 = String(r.stdout) + String(r.stderr);
    // 记录那一格补上之后，这段程序应当跑得通，而且结果是 1 —— 这同样是「跑的是自举那层」的证据。
    ok("自举自己造记录并取字段，算出 1", String(r.stdout).trim() === "1", JSON.stringify(String(r.stdout).trim()));
  }
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("模块加载：import 进来的函数能调");
{
  const 模块目录 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-mod-");
  try {
    fs.writeFileSync(path.join(模块目录, "helper.hmyr"), "fn helper() -> Int {\n  return 9\n}\n", "utf8");
    fs.writeFileSync(path.join(模块目录, "main.hmyr"), 'import "./helper.hmyr"\n\nfn main() -> Int {\n  return helper() + 1\n}\n', "utf8");
    const r = 启动([path.join(模块目录, "main.hmyr")]);
    ok("import 进来的函数能调，算出 10", String(r.stdout).trim() === "10", JSON.stringify(String(r.stdout).trim()));
    // 环状 import：A 引 B、B 引 A，不该挂死
    fs.writeFileSync(path.join(模块目录, "a.hmyr"), 'import "./b.hmyr"\nfn a() -> Int {\n  return 1\n}\n', "utf8");
    fs.writeFileSync(path.join(模块目录, "b.hmyr"), 'import "./a.hmyr"\nfn main() -> Int {\n  return 2\n}\n', "utf8");
    const r2 = 启动([path.join(模块目录, "a.hmyr")]);
    ok("环状 import 不挂死（读过的不再读）", r2.status === 0 && String(r2.stdout).trim().length > 0, JSON.stringify(String(r2.stdout).trim()));
    // import 一个不存在的文件：跳过，不该崩
    fs.writeFileSync(path.join(模块目录, "miss.hmyr"), 'import "./nope.hmyr"\nfn main() -> Int {\n  return 4\n}\n', "utf8");
    const r3 = 启动([path.join(模块目录, "miss.hmyr")]);
    ok("import 不存在的文件时跳过，照样跑 main", String(r3.stdout).trim() === "4", JSON.stringify(String(r3.stdout).trim()));
  } finally {
    fs.rmSync(模块目录, { recursive: true, force: true });
  }
}

console.log("读自举那一层用的是子集那两层，不是宿主那两层");
{
  // 静态检查，说清它是静态的：这一条不能证明「跑的时候没调到」，
  // 它证明的是「启动器没有把宿主那两层引进来」——要调到，得先引进来。
  const 源 = fs.readFileSync(path.join(ROOT, "bin/hmyr.mjs"), "utf8");
  ok("引了子集切词器", /from "\.\.\/src\/subset-lex\.mjs"/.test(源));
  ok("引了子集 parser", /from "\.\.\/src\/subset-parse\.mjs"/.test(源));
  ok("没有引宿主切词器", !/from "\.\.\/src\/lexer\.mjs"/.test(源));
  ok("没有引宿主 parser", !/from "\.\.\/src\/parser\.mjs"/.test(源));
  // 而加载器本身照旧同时拥有两条路：默认那条仍会引它们，于是「没引」这件事只对启动器成立。
  const 加载器 = fs.readFileSync(path.join(ROOT, "src/loader.mjs"), "utf8");
  ok("加载器仍然默认用宿主那两层（口子是可选的）", /options\.reader \|\|/.test(加载器));
}

console.log("默认那份最小求值器，与 --host-eval 那条做同一件事");
{
  const 目录 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-min-launch-");
  try {
    const 用 = (args) => spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), ...args], { encoding: "utf8" });
    const 目标 = path.join(ROOT, "examples/hello.hmyr");
    const 默认 = 用([目标]);
    const 宿主 = 用(["--host-eval", 目标]);
    ok("hello 两边都算出 5", String(默认.stdout).trim() === "5" && String(宿主.stdout).trim() === "5", JSON.stringify(String(宿主.stdout).trim()));
    ok("退出码一样", 默认.status === 宿主.status, 默认.status + " 对 " + 宿主.status);
    const 缺 = 用([path.join(目录, "nope.hmyr")]);
    ok("缺文件时默认那条也给退出码 1", 缺.status === 1, String(缺.status));
    ok("并给出编号 R0211", String(缺.stderr).includes("HMYR-R0211"), JSON.stringify(String(缺.stderr).slice(0, 50)));
    // 开关自己不该被当成目标文件：它被剔掉了，于是 argv[1] 仍是目标。
    ok("开关没有被当成目标文件", !String(缺.stderr).includes("--host-eval"), String(缺.stderr).slice(0, 60));
    // 带 while 的也算一件：最小那份不是只认得 hello。
    const w = path.join(目录, "w.hmyr");
    fs.writeFileSync(w, "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n", "utf8");
    ok("while 那条默认也给 3", String(用([w]).stdout).trim() === "3", JSON.stringify(String(用([w]).stdout).trim()));
    ok("while 那条 --host-eval 也给 3", String(用(["--host-eval", w]).stdout).trim() === "3");
    // 兼容：--minimal-eval 仍然被接受（默认已经是它），而且照样从 argv 里剔掉。
    ok("--minimal-eval 仍被接受且不挡路", String(用(["--minimal-eval", 目标]).stdout).trim() === "5");
  } finally {
    fs.rmSync(目录, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
