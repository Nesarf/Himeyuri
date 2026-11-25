// 可移植性：发布出去的源码里不该留维护者这台机器的布局。
//
// 为什么需要它：签名那三样（钥匙、allowed_signers、ssh-keygen 的程序）原先在五处各写了一遍
// 绝对路径，于是公开仓库的源码里带着用户名、密钥文件名与盘符。那是痕迹不是材料，
// 可它没必要出去 —— 而没有任何判据看着这件事，所以它一直待着（2026-11-26 才发现）。
//
// 判据只说三件具体的事，不铺开成「不许出现盘符」——那一类会误伤客户机路径
// （tools/guest-recheck.mjs 拼的是 VirtualBox 客户机里的 C:\Users\<用户名>，
//  那是被访机器的约定，与维护者的磁盘无关）。
//
// 规则的模式都是拼出来的：这个文件自己就住在 tools/ 下，而它要扫 tools/。
// 直接写成一整条字面量，判据会先抓住自己。
//
//   node tools/check-portability.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const 判 = (标签, 条件, 明细 = "") => {
  if (条件) { passed++; console.log("  通过  " + 标签 + (明细 ? "  " + 明细 : "")); }
  else { failed++; console.log("  不通过  " + 标签 + (明细 ? "  " + 明细 : "")); }
};

// 扫哪些地方：发布物带出去的那些树。
const 树 = ["tools", "test", "bin", "src", "self", "design", "examples", "kpb", "port", "vm", "conformance", "scripts"];
const 文本 = new Set([".mjs", ".js", ".cjs", ".hmoca", ".hmyr", ".hmtr", ".txt", ".md", ".json", ".ps1", ".c", ".h", ".yml", ".yaml"]);
// 代码与文档要分开：文档会如实记下当时的命令（design/FULLSELF.txt 就写着一次 git 与 ssh
// 的排查过程，里面那个系统目录是任何人机器上都一样的），而代码里写死盘符是会让别人的机器跑不起来的。
const 代码 = new Set([".mjs", ".js", ".cjs", ".hmoca", ".hmyr", ".hmtr", ".ps1", ".c", ".h"]);
const 跳过 = new Set(["node_modules", ".git", "dist", "build", ".tmp-"]);

const 走 = (目录, 出 = []) => {
  let 項;
  try { 項 = fs.readdirSync(目录, { withFileTypes: true }); } catch { return 出; }
  for (const e of 項) {
    if (跳过.has(e.name) || e.name.startsWith(".tmp-")) continue;
    const 全 = path.join(目录, e.name);
    if (e.isDirectory()) { 走(全, 出); continue; }
    if (文本.has(path.extname(e.name).toLowerCase())) 出.push(全);
  }
  return 出;
};

const 文件 = [];
for (const t of 树) 走(path.join(ROOT, t), 文件);

// 三条规则：模式拼出来，判据不自伤。
const 盘 = "[A-Za-z]:";
const 斜 = "[\\\\/]+";
const 规则 = [
  {
    名: "源码里没有私钥与 allowed_signers 的家",
    模: new RegExp(盘 + 斜 + "Users" + 斜 + "[^\\\\/\\s\"']+" + 斜 + "\\.ssh"),
  },
  {
    名: "源码里没有 ssh-keygen 的本机安装位置",
    模: new RegExp(盘 + 斜 + "Windows" + 斜 + "System32" + 斜 + "OpenSSH"),
    只代码: true,
  },
  {
    名: "源码里没有维护者工作盘的布局",
    模: new RegExp(盘 + 斜 + "(DaShaoHuo|LetMeGo|dsh-home)" + 斜),
  },
];

const 扫一遍 = (候选= 文件) => {
  const 命中 = [];
  for (const f of 候选) {
    let 內;
    try { 內 = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (內.indexOf("\u0000") >= 0) continue; // 二进制
    const 行们 = 內.split(/\r?\n/);
    const 是代码 = 代码.has(path.extname(f).toLowerCase());
    for (const r of 规则) {
      if (r.只代码 && !是代码) continue;
      for (let i = 0; i < 行们.length; i++) {
        if (r.模.test(行们[i])) 命中.push(path.relative(ROOT, f) + ":" + (i + 1) + "  " + r.名);
      }
    }
  }
  return 命中;
};

console.log("一、扫得到的树：" + 文件.length + " 份文本");
判("树里扫到了东西（否则这条判据是空的）", 文件.length > 20, 文件.length + " 份");

console.log("二、三条规则各自成立");
const 真命中 = 扫一遍();
for (const r of 规则) {
  const 这些 = 真命中.filter((h) => h.endsWith(r.名));
  判(r.名, 这些.length === 0, 这些.length === 0 ? "0 处" : 这些.slice(0, 4).join(" | "));
}

console.log("三、反向：这条判据真的会红");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "portability-"));
  try {
    // 三份样本都用 join 拼出来：源码里不该出现完整的那串，否则这个判据会先抓住自己。
    const 坏 = path.join(临, "bad.mjs");
    const 坏路 = ["D:", "Users", "someone", ".ssh", "id_x"].join("/");
    fs.writeFileSync(坏, "const k = \"" + 坏路 + "\";\n", "utf8");
    const 命中 = 扫一遍([坏]);
    判("造一份违规文件，规则一抓得住", 命中.length >= 1, 命中.length + " 处");

    const 好 = path.join(临, "good.mjs");
    fs.writeFileSync(好, "const k = path.join(os.homedir(), \".ssh\", \"id_x\");\n", "utf8");
    const 干净 = 扫一遍([好]);
    判("而一份用 homedir 拼出来的不算违规", 干净.length === 0, 干净.length + " 处");

    const 客户机 = path.join(临, "guest.mjs");
    const 客路 = ["C:", "Users", "someone"].join("\\");
    fs.writeFileSync(客户机, "const 客 = \"" + 客路 + "\";\n", "utf8");
    const 客命中 = 扫一遍([客户机]);
    判("客户机那种拼接不算违规（它拼的不是维护者的磁盘）", 客命中.length === 0, 客命中.length + " 处");
  } finally {
    fs.rmSync(临, { recursive: true, force: true });
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
