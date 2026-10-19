// 验一份清单：每个文件的哈希对不对，而清单本身有没有被动过。
//
// 这是「仓库」的第一层。第二层是「谁签的」——那需要密钥，而这一层不需要：
// 内容对不对是可以自己算出来的，信不信是谁给的则不能。
//
// 所以这个工具能回答的问题恰好是：
//   ・我手上这一份，和清单写的那一份，是不是同一份？
// 而它无法回答的问题是：
//   ・这份清单是不是可信的人给的？
//
// 后者要靠签名，而签名要密钥。写在这里，免得有人以为跑过这个就「验过了」。
//
//   node tools/verify.mjs                 现算一份清单并验它（自检）
//   node tools/verify.mjs --in x.json     验一份给定的清单
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 哈 = (p) => {
  const 全 = path.join(ROOT, p);
  if (!fs.existsSync(全)) return null;
  return createHash("sha256").update(fs.readFileSync(全)).digest("hex").slice(0, 16);
};

const 参 = process.argv.slice(2);
const 位 = 参.indexOf("--in");
let 清单;

if (位 >= 0 && 参[位 + 1]) {
  const p = path.resolve(参[位 + 1]);
  try { 清单 = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("  读不了那份清单：" + String(e.message).slice(0, 80)); process.exit(2); }
  console.log("  验 " + p);
} else {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs")], { encoding: "utf8" });
  if (r.status !== 0) { console.error("  清单算不出来：" + String(r.stderr).slice(0, 120)); process.exit(2); }
  清单 = JSON.parse(r.stdout);
  console.log("  验现算的那一份（自检）");
}

// 一、清单本身的 digest
const 去掉 = { ...清单 };
delete 去掉.digest;
const 应 = createHash("sha256").update(JSON.stringify(去掉, null, 2)).digest("hex");
let 对 = 0, 错 = 0, 缺 = 0;
if (清单.digest === 应) { 对++; console.log("  清单本身没被动过（digest 对得上）"); }
else { 错++; console.log("  [不通过] 清单本身被动过了：写着 " + String(清单.digest).slice(0, 16) + "，算出来 " + 应.slice(0, 16)); }

// 二、每一项的哈希
const 验一件 = (label, p, 写) => {
  const 算 = 哈(p);
  if (算 === null) { 缺++; console.log("  [缺] " + label); return; }
  if (算 === 写) { 对++; return; }
  错++;
  console.log("  [不通过] " + label + "：写着 " + 写 + "，算出来 " + 算);
};
for (const 件 of 清单.standardLibrary || []) 验一件(件.file, 件.file, 件.sha256);
for (const 件 of 清单.suites || []) 验一件(件.path, 件.path, 件.sha256);
for (const 件 of 清单.tools || []) 验一件("tools/" + 件.name, "tools/" + 件.name, 件.sha256);
for (const 件 of 清单.documents || []) 验一件("design/" + 件.name, "design/" + 件.name, 件.sha256);

console.log("  对得上 " + 对 + " 项 · 不对 " + 错 + " 项 · 缺 " + 缺 + " 项");
if (错 === 0 && 缺 === 0) console.log("  通过");
else console.log("  不通过");
console.log("  注意：这一份只说明「有清单」，不说明「值得信」——后者要签名，而签名要密钥。");
process.exit(错 === 0 && 缺 === 0 ? 0 : 1);
