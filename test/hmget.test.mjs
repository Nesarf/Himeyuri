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
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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

console.log("八、http 来源：这一版明说不做");
{
  const r = 跑(["--from", "https://example.com/pkg", "--into", 根, "庚包"]);
  ok("拒绝并说清为什么", r.status !== 0 && String(r.stderr || "").includes("不从网络取"),
    String(r.stderr || "").slice(0, 160));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
