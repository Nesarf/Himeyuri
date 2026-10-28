// 取一个包（tools/hmget.mjs）的验收：design/HMGET.txt 那一页的每一节各一条。
//
// 一个前提：这个套件**不联网**。来源是本地目录与 file:// URL，因为「取」这件事
// 的判据必须可复现 —— 而怎么从网上取是另一层的事（见那一页第二节）。
//
// 而它同时要保住一条更重要的东西：语言侧一行都不碰网络。这个工具是唯一会去
// 外面拿东西的地方，而它拿的仍然是文件。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-hmget-"));
const 源 = path.join(临, "源");
const 根 = path.join(临, "根");
const 工具 = path.join(ROOT, "tools", "hmget.mjs");
const 算 = (路) => "sha256:" + createHash("sha256").update(fs.readFileSync(路)).digest("hex");

// 造一个来源里的包。哈希按真文件算，所以「清单与文件一致」由造的时候保证。
const 造包 = (名, 内容, 改) => {
  const 目录 = path.join(源, 名);
  fs.mkdirSync(目录, { recursive: true });
  fs.writeFileSync(path.join(源, "hmyr.hmkit"), "[]", "utf8");
  const 入口 = path.join(目录, "index.hmoca");
  fs.writeFileSync(入口, 内容, "utf8");
  const 清单 = { 名字: 名, 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 算(入口) };
  if (改) 改(清单);
  fs.writeFileSync(path.join(目录, "hmyr.hmkit"), JSON.stringify(清单), "utf8");
  return { 目录, 入口 };
};

const 跑 = (参) => spawnSync(process.execPath, [工具, ...参], { encoding: "utf8", timeout: 120000 });

// 异步的一版：http 那一条要用它。spawnSync 会把父进程的循环堵住，
// 而「本地起一个服务器再让子进程去取」需要父进程的循环是活的。
const 跑异步 = (参) => new Promise((解, 拒) => {
  const 子 = spawn(process.execPath, [工具, ...参], { stdio: ["ignore", "pipe", "pipe"] });
  let 出 = "", 错 = "";
  子.stdout.on("data", (d) => { 出 += d; });
  子.stderr.on("data", (d) => { 错 += d; });
  子.on("close", (码) => 解({ status: 码, stdout: 出, stderr: 错 }));
  子.on("error", 拒);
});

console.log("一、本地目录来源：取进来，哈希对得上");
{
  造包("甲包", "pub fn 甲() -> Int {\n  return 1\n}\n");
  const r = 跑(["--from", 源, "--into", 根, "甲包"]);
  ok("退出码 0", r.status === 0, String(r.stderr || "").slice(0, 160));
  ok("包装到位", fs.existsSync(path.join(根, "甲包", "index.hmoca")) && fs.existsSync(path.join(根, "甲包", "hmyr.hmkit")),
    JSON.stringify(fs.readdirSync(根)));
  ok("包根有了记号", fs.existsSync(path.join(根, "hmyr.hmkit")), "");
  // 装完要能自证：让 hmkit-check 说它过，而不是工具自己说。
  const 验 = spawnSync(process.execPath, [path.join(ROOT, "tools", "hmkit-check.mjs"), "--all", 根], { encoding: "utf8" });
  ok("hmkit-check 通过", 验.status === 0, String(验.stdout || "").slice(0, 160));
}

console.log("二、file:// 来源：同一条路");
{
  造包("乙包", "pub fn 乙() -> Int {\n  return 2\n}\n");
  const r = 跑(["--from", "file:///" + 源.split(path.sep).join("/"), "--into", 根, "乙包"]);
  ok("file:// 也取得动", r.status === 0 && fs.existsSync(path.join(根, "乙包", "index.hmoca")),
    String(r.stderr || "").slice(0, 160));
}

console.log("三、来源里没有这个包：E0308");
{
  const r = 跑(["--from", 源, "--into", 根, "不存在的包"]);
  ok("报 E0308", String(r.stderr || "").includes("HMYR-E0308"), String(r.stderr || "").slice(0, 120));
}

console.log("四、入口文件的哈希与清单不符：E0309");
{
  const { 入口 } = 造包("丙包", "pub fn 丙() -> Int {\n  return 3\n}\n");
  // 清单造好之后再改文件 —— 那正是「来源被人动过」的样子。
  fs.writeFileSync(入口, "pub fn 丙() -> Int {\n  return 999\n}\n", "utf8");
  const r = 跑(["--from", 源, "--into", 根, "丙包"]);
  ok("报 E0309", String(r.stderr || "").includes("HMYR-E0309"), String(r.stderr || "").slice(0, 160));
}

console.log("五、目标已存在且内容不同：拒绝；--force 才覆盖");
{
  造包("丁包", "pub fn 丁() -> Int {\n  return 4\n}\n");
  跑(["--from", 源, "--into", 根, "丁包"]);
  // 改来源，再取一次。
  造包("丁包", "pub fn 丁() -> Int {\n  return 44\n}\n");
  const r1 = 跑(["--from", 源, "--into", 根, "丁包"]);
  ok("不加 --force 被拒（E0310）", String(r1.stderr || "").includes("HMYR-E0310"), String(r1.stderr || "").slice(0, 160));
  const r2 = 跑(["--from", 源, "--into", 根, "--force", "丁包"]);
  ok("加 --force 就覆盖", r2.status === 0, String(r2.stderr || "").slice(0, 160));
  ok("覆盖之后是新内容",
    fs.readFileSync(path.join(根, "丁包", "index.hmoca"), "utf8").includes("44"), "");
}

console.log("六、依赖：缺哪个报哪个，不递归取");
{
  造包("戊包", "pub fn 戊() -> Int {\n  return 5\n}\n", (清单) => { 清单.依赖 = { 缺的包: 1 }; });
  const r = 跑(["--from", 源, "--into", 根, "戊包"]);
  ok("报 E0305 并点名缺的那个", String(r.stderr || "").includes("HMYR-E0305") && String(r.stderr || "").includes("缺的包"),
    String(r.stderr || "").slice(0, 200));
}

console.log("七、已经在了而且内容相同：不报错，也不重装");
{
  造包("己包", "pub fn 己() -> Int {\n  return 6\n}\n");
  跑(["--from", 源, "--into", 根, "己包"]);
  const 之前 = fs.statSync(path.join(根, "己包", "index.hmoca")).mtimeMs;
  const r = 跑(["--from", 源, "--into", 根, "己包"]);
  ok("退出码 0", r.status === 0, String(r.stderr || "").slice(0, 120));
  ok("说了「已经在了」", String(r.stdout || "").includes("已经在了"), String(r.stdout || "").slice(0, 120));
  ok("没有重写文件", fs.statSync(path.join(根, "己包", "index.hmoca")).mtimeMs === 之前, "");
}

console.log("八、http 来源：从一台本机服务器取，仍然不联网");
{
  // 这一条原来测的是「明确拒绝 http」。2026-10-28 起 http 支持了，所以它换了内容 ——
  // 而判据仍然满足「可复现、不联网」：服务器是这一节自己起来的，端口是随机的，
  // 内容就是同一个临时来源目录。换句话说，http 那一份实现与被测的另外两条
  // 走的是同一批字节。
  造包("庚包", "pub fn 庚() -> Int {\n  return 11\n}\n");
  const 服务器 = http.createServer((请, 应) => {
    const 相对 = decodeURIComponent(请.url.replace(/^\/+/, ""));
    const 全 = path.join(源, 相对);
    if (!全.startsWith(源) || !fs.existsSync(全) || !fs.statSync(全).isFile()) {
      应.writeHead(404); 应.end("no"); return;
    }
    应.writeHead(200); 应.end(fs.readFileSync(全));
  });
  await new Promise((解) => 服务器.listen(0, "127.0.0.1", 解));
  const 端口 = 服务器.address().port;
  const 根2 = path.join(临, "根-http");
  const r = await 跑异步(["--from", "http://127.0.0.1:" + 端口, "--into", 根2, "庚包"]);
  服务器.close();
  ok("退出码 0", r.status === 0, String(r.stderr || "").slice(0, 200));
  ok("包装到位", fs.existsSync(path.join(根2, "庚包", "index.hmoca")), "");
  ok("哈希也验过（错的话会报 E0309）", !String(r.stderr || "").includes("HMYR-E0309"), String(r.stderr || "").slice(0, 120));
  ok("它说了来源是 http", String(r.stdout || "").includes("http"), String(r.stdout || "").slice(0, 160));
}

console.log("八半、http 来源上取一个不存在的包：E0308");
{
  const 服务器 = http.createServer((请, 应) => { 应.writeHead(404); 应.end("no"); });
  await new Promise((解) => 服务器.listen(0, "127.0.0.1", 解));
  const 端口 = 服务器.address().port;
  const r = await 跑异步(["--from", "http://127.0.0.1:" + 端口, "--into", 根, "没有的包"]);
  服务器.close();
  ok("报 E0308", String(r.stderr || "").includes("HMYR-E0308"), String(r.stderr || "").slice(0, 160));
}

console.log("九、卸载：包没了，包根还在");
{
  造包("辛包", "pub fn 辛() -> Int {\n  return 7\n}\n");
  跑(["--from", 源, "--into", 根, "辛包"]);
  const r = 跑(["--remove", "--into", 根, "辛包"]);
  ok("退出码 0", r.status === 0, String(r.stderr || "").slice(0, 160));
  ok("包目录没了", !fs.existsSync(path.join(根, "辛包")), "");
  ok("包根那个记号还在", fs.existsSync(path.join(根, "hmyr.hmkit")), "");
  ok("别的包没受影响", fs.existsSync(path.join(根, "甲包", "index.hmoca")), "");
}

console.log("十、卸载一个不存在的包：E0311");
{
  const r = 跑(["--remove", "--into", 根, "从来没有的包"]);
  ok("报 E0311", String(r.stderr || "").includes("HMYR-E0311"), String(r.stderr || "").slice(0, 140));
}

console.log("十一、有包依赖它：拒绝，--force 才照删");
{
  造包("壬包", "pub fn 壬() -> Int {\n  return 8\n}\n");
  跑(["--from", 源, "--into", 根, "壬包"]);
  造包("癸包", "pub fn 癸() -> Int {\n  return 9\n}\n", (清单) => { 清单.依赖 = { 壬包: 1 }; });
  跑(["--from", 源, "--into", 根, "癸包"]);

  const r1 = 跑(["--remove", "--into", 根, "壬包"]);
  ok("不加 --force 被拒（E0312）", String(r1.stderr || "").includes("HMYR-E0312"), String(r1.stderr || "").slice(0, 160));
  ok("被拒时它还在", fs.existsSync(path.join(根, "壬包")), "");

  const r2 = 跑(["--remove", "--into", 根, "--force", "壬包"]);
  ok("--force 就照删", r2.status === 0 && !fs.existsSync(path.join(根, "壬包")), String(r2.stderr || "").slice(0, 160));
  ok("而它说了会留下缺口", String(r2.stdout || "").includes("癸包"), String(r2.stdout || "").slice(0, 160));
}

console.log("十二、--dry-run：只说话，不动手");
{
  造包("子包", "pub fn 子() -> Int {\n  return 10\n}\n");
  跑(["--from", 源, "--into", 根, "子包"]);
  const r = 跑(["--remove", "--into", 根, "--dry-run", "子包"]);
  ok("退出码 0", r.status === 0, String(r.stderr || "").slice(0, 120));
  ok("说了会删什么", String(r.stdout || "").includes("会删掉"), String(r.stdout || "").slice(0, 160));
  ok("说了这是 dry-run", String(r.stdout || "").includes("什么都没动"), String(r.stdout || "").slice(0, 160));
  ok("包还在", fs.existsSync(path.join(根, "子包", "index.hmoca")), "");
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
