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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参 = process.argv.slice(2);
const 位 = 参.indexOf("--out");
const 日期 = new Date().toISOString().slice(0, 10);
const 出 = 位 >= 0 && 参[位 + 1] ? path.resolve(参[位 + 1]) : path.join(ROOT, "dist", "himeyuri-" + 日期 + ".zip");

// 一、先出新清单（它自带每个文件的哈希与整份的 digest）
const 清 = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs"), "--out", path.join(ROOT, "dist/manifest.json")], { encoding: "utf8" });
if (清.status !== 0) { console.error("  清单出不来：" + String(清.stderr).slice(0, 120)); process.exit(2); }
const 清单 = JSON.parse(fs.readFileSync(path.join(ROOT, "dist/manifest.json"), "utf8"));

// 二、要收进去的：清单、源码、标准库、套件、工具、设计文档
const 收 = [path.join(ROOT, "dist/manifest.json")];
const 走 = (dir) => {
  const 全 = path.join(ROOT, dir);
  if (!fs.existsSync(全)) return;
  for (const e of fs.readdirSync(全, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(全, e.name);
    if (e.isDirectory()) 走(path.join(dir, e.name));
    else if (/\.(mjs|hmyr|txt|md)$/.test(e.name)) 收.push(p);
  }
};
for (const d of ["src", "self", "bin", "runtime", "tools", "test", "design", "conformance", "examples"]) 走(d);
for (const f of ["SPEC.txt", "README.md", "LICENSE", "MASCOT.txt", ".gitignore"]) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) 收.push(p);
}
for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith(".hmyr"))) 收.push(path.join(ROOT, f));

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
const 压 = spawnSync("powershell", ["-NoProfile", "-Command",
  "Compress-Archive -Path '" + path.join(暂, "*") + "' -DestinationPath '" + 出 + "' -Force"], { encoding: "utf8" });
fs.rmSync(暂, { recursive: true, force: true });
if (!fs.existsSync(出)) { console.error("  压不出来：" + String(压.stderr).slice(0, 160)); process.exit(2); }

const 大小 = fs.statSync(出).size;
console.log("  收了 " + 收.length + " 个文件");
console.log("  出了 " + path.relative(ROOT, 出) + "（" + Math.round(大小 / 1024) + " KB）");
console.log("  清单 digest " + 清单.digest.slice(0, 16) + " · 内核 " + 清单.kernel.builtins + " 个内置 · 最小集 " + 清单.kernel.minimalSet.length + " 个");
console.log("  注意：这是 zip，而 OnlySign 认的是 PE——要签它得另外决定，不是顺手能做的。");
