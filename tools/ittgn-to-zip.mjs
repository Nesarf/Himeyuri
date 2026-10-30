// 容器 → zip：摊开成员，把运行逻辑释放成 hmsnp 与 hmhsr 两个入口放在根目录，
// 并留下一个成员表，好让反方向走得回来。
//
// 这是 design/FILETYPE.txt 第四节里「容器 → 压缩包」那一句的落地。四条规矩：
//
//   一、运行逻辑从容器里搬出来，不是复制。容器内不带 hmsnp / hmhsr 成员
//      （装的时候就拒了），所以这一对入口只能在这里生成。
//   二、两个入口共用同一份内容：成员只摊一份，两个入口各是一个文件、指向同一棵内容树。
//      「同一份内容、两个入口、零份副本」—— 数一数目录就核得出来。
//   三、留一张成员表（hm-ittgn-krgn-m.txt）。它记的是成员名与顺序，还有哪一个是入口。
//      没有它，反方向就只能猜「这个 hmsnp 原本叫什么名字」，而猜出来的东西往返两次就分家了。
//   四、hmsnp 与 hmhsr 今天的内容相同 —— 稳定档与弹性档的差别要等 design/MEMORY.txt
//      的三区模型落地的**那一天**。所以这一份不假装它们不同，只保证两个名字都在、都能跑。
//
// 用法：node tools/ittgn-to-zip.mjs <包.hm-ittgn-krgn-m> [输出.zip]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { 读容器, 找入口, 摊开, 容器后缀, 成员表名 } from "../src/ittgn.mjs";

const 参 = process.argv.slice(2);
if (参.length < 1) {
  console.error("用法：node tools/ittgn-to-zip.mjs <包.hm-ittgn-krgn-m> [输出.zip]");
  process.exit(2);
}
const 包路 = path.resolve(参[0]);
const 包名 = path.basename(包路).replace(new RegExp("\\" + 容器后缀 + "$", "i"), "");
const 出 = path.resolve(参[1] || path.join(process.cwd(), 包名 + ".zip"));

const r = 读容器(包路);
if (!r.ok) { console.error(r.错); process.exit(1); }

const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ittgn-x-"));
// 摊开那一层与启动器共用 src/ittgn.mjs 的 摊开：路径归一与跳出目录这两条规矩
// 只该写一遍，否则两个工具迟早会对「什么样的成员名算合法」给出不同答案。
const 开 = 摊开(r.成员们, 目录);
if (!开.ok) { console.error(开.错); process.exit(1); }

const 入口 = 找入口(目录, 包路);
if (!入口) {
  console.error("HMYR-機-008 容器里没有可跑的入口（要先有 hmoca 或 hmoks 成员）");
  process.exit(1);
}
const 入口名 = path.relative(目录, 入口).split(path.sep).join("/");

// 两个入口：内容取容器里那一份，名字按档位各一个。
// 不写成「先复制成 hmsnp 再复制 hmsnp 成 hmhsr」—— 那样第二份是靠第一份生出来的，
// 将来两档真的分家时会看不出「谁才是原始的那一份」。
const 入字节 = fs.readFileSync(入口);
for (const 档 of ["hmsnp", "hmhsr"]) {
  fs.writeFileSync(path.join(目录, 包名 + "." + 档), 入字节);
}

// 成员表：版本、容器基名、入口名、然后按原顺序排列的成员名。
// 容器基名要记，因为根目录那两个入口是按容器名命名的（演示.hmsnp），
// 而 zip 自己可能叫别的（中.zip）—— 反方向只拿 zip 名去猜会找不到入口。
// 它是明文，因为拿到包的人该能一眼看出这个包原本长什么样。
const 行们 = ["1", 包名, 入口名, ...r.成员们.map((m) => m.名)];
fs.writeFileSync(path.join(目录, 成员表名), 行们.join("\n") + "\n", "utf8");

const 压 = spawnSync("powershell", ["-NoProfile", "-Command",
  "Compress-Archive -Path '" + path.join(目录, "*") + "' -DestinationPath '" + 出 + "' -Force"],
{ encoding: "utf8" });

if (压.status !== 0) {
  console.error("压不成：" + String(压.stderr || 压.stdout).slice(0, 200));
  process.exit(1);
}

console.log("摊开 " + fs.readdirSync(目录).length + " 项（含两个入口与一张成员表）→ " + 出);
console.log("  入口取自 " + 入口名);
console.log("  " + 包名 + ".hmsnp 与 " + 包名 + ".hmhsr 内容相同 —— 两档的真实差别还没实现，见文件头");
fs.rmSync(目录, { recursive: true, force: true });
