// zip → 容器：把转换时释放出去的那一对入口收回来，还原成原来的容器。
//
// 这是 design/FILETYPE.txt 第四节里「压缩包 → 容器」那一句。判据只有一条，而且很硬：
// 往返一次之后字节相同。不是「解得出、跑得动」，是逐字节比 —— 那才是「可逆」。
//
// 靠的是转换时留下的成员表（hm-ittgn-krgn-m.txt）：第一行版本，第二行入口名，
// 之后按原顺序排列成员名。没有它，这里只能猜「这个 hmsnp 原本叫什么」，
// 而猜出来的东西往返两次就与原来分家了。
//
// 收的时候跳过根目录那三个东西：两个入口与成员表本身 —— 它们不是容器的成员，
// 它们是容器「被摊开」的样子。
//
// 用法：node tools/ittgn-from-zip.mjs <包.zip> [输出.hm-ittgn-krgn-m]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { 写容器, 容器后缀, 成员表名 } from "../src/ittgn.mjs";

const 参 = process.argv.slice(2);
if (参.length < 1) {
  console.error("用法：node tools/ittgn-from-zip.mjs <包.zip> [输出" + 容器后缀 + "]");
  process.exit(2);
}
const 包路 = path.resolve(参[0]);
const 包名 = path.basename(包路).replace(/\.zip$/i, "");
const 出 = path.resolve(参[1] || path.join(process.cwd(), 包名 + 容器后缀));

const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ittgn-r-"));
const 开 = spawnSync("powershell", ["-NoProfile", "-Command",
  "Expand-Archive -Path '" + 包路 + "' -DestinationPath '" + 目录 + "' -Force"], { encoding: "utf8" });
if (开.status !== 0) {
  console.error("解不开：" + String(开.stderr || 开.stdout).slice(0, 200));
  process.exit(1);
}

const 表路 = path.join(目录, 成员表名);
if (!fs.existsSync(表路)) {
  console.error("HMYR-器-009 这份 zip 里没有成员表（" + 成员表名 + "）—— 它可能不是从容器转来的");
  process.exit(1);
}
const 行们 = fs.readFileSync(表路, "utf8").split("\n").map((x) => x.replace(/\r$/, "")).filter((x) => x.length > 0);
if (行们[0] !== "1") {
  console.error("HMYR-器-010 成员表的版本不认识：" + 行们[0]);
  process.exit(1);
}
const 容器基名 = 行们[1];
const 入口名 = 行们[2];
const 成员名们 = 行们.slice(3);

// 入口的内容取根目录那一对之一。两个都试，因为摊开之后它们本该相同，
// 而「本该相同」这件事不该让这里挑死一个名字 —— 有人可能只留下一个。
const 入口内容 = () => {
  for (const 档 of ["hmsnp", "hmhsr"]) {
    const p = path.join(目录, 容器基名 + "." + 档);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return null;
};
const 入字节 = 入口内容();
if (入字节 === null) {
  console.error("HMYR-器-011 根目录既没有 " + 容器基名 + ".hmsnp 也没有 " + 容器基名 + ".hmhsr —— 这份 zip 不是容器摊开的");
  process.exit(1);
}

const 成员们 = [];
for (const 名 of 成员名们) {
  const 全 = path.join(目录, 名);
  if (名 === 入口名) {
    // 入口那一份从根目录回收：摊开时它被复制成两个入口，原来那个名字下的副本
    // 在 zip 里仍然是成员（转换时没删它），所以两条路都该通；取根目录那一份，
    // 是因为那才是「运行逻辑」的所在。
    成员们.push({ 名, 数据: 入字节 });
    continue;
  }
  if (!fs.existsSync(全)) {
    console.error("HMYR-器-012 成员表里有这个成员，而 zip 里没有：" + 名);
    process.exit(1);
  }
  成员们.push({ 名, 数据: fs.readFileSync(全) });
}

写容器(出, 成员们);
console.log("收回 " + 成员们.length + " 个成员 → " + 出 + "（" + fs.statSync(出).size + " 字节）");
console.log("  入口 " + 入口名 + " 取自根目录那一对入口文件");
fs.rmSync(目录, { recursive: true, force: true });
