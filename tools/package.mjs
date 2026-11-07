// 打包：把这一份源码打成一件能签、能传、能验的东西。
//
// 为什么需要它：OnlySign 签的是它认识的产物（PE），而清单是数据——
// 两者不是一回事。发布这件事在中间：把“一堆源码 + 一份清单”收成一件东西，
// 而那件东西才是要发出去的、也是要签的。
//
// 这一版打的是一份 zip：清单 + 源码 + 文档 + 套件。
// 它现在还不能被 OnlySign 签（那是 zip，不是 PE），而它至少让「发布物」存在了；
// 下一步要么把启动器包成 PE，要么让验签的路认 zip——两者都该先说清再动。
//
//   node tools/package.mjs                 打到 dist/himeyuri-<日期>.zip
//   node tools/package.mjs --out x.zip
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 压目录 } from "../src/zip-writer.mjs";
import { 只留源码 } from "./file-kind-hmyr.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参 = process.argv.slice(2);
const 位 = 参.indexOf("--out");
const 日期 = new Date().toISOString().slice(0, 10);
const 出 = 位 >= 0 && 参[位 + 1] ? path.resolve(参[位 + 1]) : path.join(ROOT, "dist", "himeyuri-" + 日期 + ".zip");

// 一、先出新清单（它自带每个文件的哈希与整份的 digest）
const 清 = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs"), "--out", path.join(ROOT, "dist/manifest.json")], { encoding: "utf8" });
if (清.status !== 0) { console.error("  清单出不来：" + String(清.stderr).slice(0, 120)); process.exit(2); }
const 清单 = JSON.parse(fs.readFileSync(path.join(ROOT, "dist/manifest.json"), "utf8"));

// 二、要收进去的：清单、源码、标准库、套件、工具、设计文档，以及图标
const 收 = [path.join(ROOT, "dist/manifest.json")];
const 走 = (dir) => {
  const 全 = path.join(ROOT, dir);
  if (!fs.existsSync(全)) return;
  for (const e of fs.readdirSync(全, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(全, e.name);
    if (e.isDirectory()) 走(path.join(dir, e.name));
    // 图标也收：包体上要看得见它是什么。PNG 只从 assets/ 收 ——
    // 别处的图片是素材，不是发布物，而「哪一种东西算发布物」正是这一层要回答的。
    // 收哪些后缀：两套名字都要认（design/FILETYPE.txt 第七节）。
    // 只认旧的，改名之后 runtime/ 下的 .hmoca 与 .hmoks 会被这一行静静滤掉 ——
    // 症状是「包里少了文件」，而包照样打得出来、退出码照样是零、清单照样说「全对」。
    // 这一处是 package 那一套报「缺 2 项」时揪出来的：缺的正好是仅有的两份 .hmoca。
    else if (/\.(mjs|hmoca|hmoks|hmtn|txt|md)$/.test(e.name)) 收.push(p);
    else if (dir === "assets" && /\.png$/.test(e.name)) 收.push(p);
  }
};
for (const d of ["src", "self", "bin", "runtime", "tools", "test", "design", "conformance", "examples", "assets"]) 走(d);
for (const f of ["SPEC.txt", "README.md", "LICENSE", "MASCOT.txt", ".gitignore"]) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) 收.push(p);
}
for (const f of 只留源码(fs.readdirSync(ROOT))) 收.push(path.join(ROOT, f));

// 三、压成一个 zip。用 PowerShell 的 Compress-Archive：那是“借能力”，
// 而这一层的价值不在压缩算法，在“哪一种东西算发布物”。
const 暂 = path.join(ROOT, "dist", "_stage");
fs.rmSync(暂, { recursive: true, force: true });
for (const p of 收) {
  // 清单放在包的根：它说的是「这一整包是什么」，而不是「dist/ 里有什么」。
  // 而别的文件保持它们在仓库里的相对位置——那让「包里是一个完整的仓库」这句话成立。
  const 相对 = p === path.join(ROOT, "dist/manifest.json") ? "manifest.json" : path.relative(ROOT, p);
  const 到 = path.join(暂, 相对);
  fs.mkdirSync(path.dirname(到), { recursive: true });
  fs.copyFileSync(p, 到);
}
fs.rmSync(出, { force: true });
// 压包按平台：Windows 用 Compress-Archive，别的平台用 src/zip-writer.mjs。
// 2026-11-03 给 Linux 补这一条时发现 WSL 里连 zip 命令都没有（只有 unzip），
// 于是选的是不借任何外部命令的那一条 —— 与「不依赖」那条目标是同一件事。
let 压 = null;
if (process.platform === "win32") {
  压 = spawnSync("powershell", ["-NoProfile", "-Command",
    "Compress-Archive -Path '" + path.join(暂, "*") + "' -DestinationPath '" + 出 + "' -Force"], { encoding: "utf8" });
} else {
  压目录(暂, 出);
}
fs.rmSync(暂, { recursive: true, force: true });
if (!fs.existsSync(出)) { console.error("  压不出来：" + String(压 ? 压.stderr : "").slice(0, 160)); process.exit(2); }

const 大小 = fs.statSync(出).size;
console.log("  收了 " + 收.length + " 个文件");
console.log("  出了 " + path.relative(ROOT, 出) + "（" + Math.round(大小 / 1024) + " KB）");
console.log("  清单 digest " + 清单.digest.slice(0, 16) + " · 内核 " + 清单.kernel.builtins + " 个内置 · 最小集 " + 清单.kernel.minimalSet.length + " 个");
// 四、分离签名。zip 没有内嵌签名位置，于是签名落在清单旁边一个 .sig 里——
// 那正是 S.M.Y.T. 对 Linux 包与压缩归档的做法，不是这里临时想出来的。
// 钥匙不在就当「没有钥匙」如实说，而不是悄悄跳过。
const 钥匙 = "C:/Windows/System32/OpenSSH/ssh-keygen.exe";
const 私钥 = "C:/Users/Administrator/.ssh/signing_ed25519_20261011";
if (fs.existsSync(钥匙) && fs.existsSync(私钥)) {
  // 先删旧的 .sig：ssh-keygen 在目标已存在时会问一句「Overwrite (y/n)?」，
  // 而脚本里 stdin 被占着，于是它默默不动——旧的签名就这么留了下来，
  // 而它签的是旧的清单。这个坑踩过一次（2026-10-19），写在明处。
  fs.rmSync(path.join(ROOT, "dist/manifest.json.sig"), { force: true });
  const 签 = spawnSync(钥匙, ["-Y", "sign", "-f", 私钥, "-n", "file", path.join(ROOT, "dist/manifest.json")], { encoding: "utf8" });
  if (fs.existsSync(path.join(ROOT, "dist/manifest.json.sig"))) {
    console.log("  清单已签：dist/manifest.json.sig（Ed25519，分离签名）");
  } else {
    console.log("  签名没成：" + String(签.stderr || 签.stdout).trim().slice(0, 100));
  }
} else {
  // 没有钥匙就不签。而旧的 .sig 必须在这里删掉：清单刚被打过，那份签名对应的是
  // 上一份清单 —— 留着它，下游（test/sign、test/ssh）会拿一份过期的签名去验，
  // 报出来的是「验不过」，而真正的原因是「这份签名签的不是这份清单」。
  // 2026-11-03 在 WSL 上踩到：那边没有私钥，跑过一次 package 之后 sign 就红了。
  fs.rmSync(path.join(ROOT, "dist/manifest.json.sig"), { force: true });
  console.log("  这台机器上没有签名钥匙——于是这一包只有内容寻址，没有签名。");
  console.log("  旧的 dist/manifest.json.sig 已删：它对应的是上一份清单。");
}
console.log("  注意：zip 没有内嵌签名位置，所以签的是清单，不是 zip 本身。");

// 谁写谁清：只留两份归档（今天的一份与上一次的一份）。
//
// 为什么要有这两行（2026-11-07）：归档名带日期，所以每跨一天跑一次全量就多一个 ——
// 2026-11-05 到 11-07 攒了三个，而 test/size-audit.test.mjs 的上限是两份，于是那一套红了。
// 它的注释早就写着「要根治得让 release 认一个输出目录，那是另一件事」—— 这一处是那件事
// 的第一步：把清理放在写的人手里，而不是让审计去追。
//
// 只在默认落点（dist/）时清。--out 指定的目录是调用方的事，不碰。
if (位 < 0) {
  const 目录 = path.join(ROOT, "dist");
  const 归档 = fs.existsSync(目录) ? fs.readdirSync(目录).filter((f) => f.endsWith(".zip")).sort() : [];
  for (const f of 归档.slice(0, Math.max(0, 归档.length - 2))) {
    fs.rmSync(path.join(目录, f), { force: true });
    console.log("  清掉更早的归档：" + f);
  }
}
