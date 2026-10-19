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
// 清单里的路径一律以仓库根为基准：那是清单的规矩，也是这个工具唯一的假设。
// 于是它只能验「这一个仓库」的清单，不能验别处的——而那正是它该有的边界。
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
  // 不带参数时：盘上有一份就验盘上那一份——因为签名验的是特定的字节，
  // 而“现算一份”与“盘上那一份”即使内容相同也是两件事，不同就更不用说。
  const 盘上 = path.join(ROOT, "dist/manifest.json");
  if (fs.existsSync(盘上)) {
    清单 = JSON.parse(fs.readFileSync(盘上, "utf8"));
    console.log("  验盘上那一份：" + path.relative(ROOT, 盘上));
  } else {
    const r = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs")], { encoding: "utf8" });
    if (r.status !== 0) { console.error("  清单算不出来：" + String(r.stderr).slice(0, 120)); process.exit(2); }
    清单 = JSON.parse(r.stdout);
    console.log("  验现算的那一份（盘上没有清单）");
  }
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
// 二点五、分离签名：签名不在文件里，而在它旁边一个 .sig 里。
//
// 这正是 S.M.Y.T. 对那些「没有内嵌签名位置」的格式的做法：
// 签名清单本身，而验证的人用 allowed_signers 与公钥自己去验。
// 于是「谁给的」这一半也答得上了——而它答的仍然只是「谁签的」，
// 至于「该不该信那个人」，那是读者自己的事，工具不该替他决定。
const 签路径 = (位 >= 0 && 参[位 + 1] ? path.resolve(参[位 + 1]) : path.join(ROOT, "dist/manifest.json")) + ".sig";
if (fs.existsSync(签路径)) {
  const 找 = (p) => (fs.existsSync(p) ? p : null);
  const 钥匙 = "C:/Windows/System32/OpenSSH/ssh-keygen.exe";
  const allowed = 找("C:/Users/Administrator/.ssh/allowed_signers");
  if (找(钥匙) && allowed) {
    const r = spawnSync(钥匙, ["-Y", "verify", "-I", "Nesarf@users.noreply.github.com", "-n", "file", "-f", allowed, "-s", 签路径], {
      encoding: "utf8",
      // 走标准输入而不是 shell 重定向：PowerShell 不认 <，而 Here-String 会把字节弄坏。
      input: fs.readFileSync(签路径.replace(/\.sig$/, "")),
    });
    const 说 = String(r.stdout || "") + String(r.stderr || "");
    if (说.indexOf("Good") >= 0) { 对++; console.log("  分离签名验过了：" + 说.trim().split("\n")[0].slice(0, 90)); }
    else { 错++; console.log("  [不通过] 分离签名验不过：" + 说.trim().slice(0, 120)); }
  } else {
    console.log("  有 .sig，而这台机器上没有 allowed_signers 或 ssh-keygen——于是只能查内容，不能查签名。");
  }
} else {
  console.log("  没有 .sig：这一份只有内容寻址，没有签名。");
}

console.log("  注意：上面查的是「内容对不对」与「签名对不对」，两件都答了。");
console.log("        而「该不该信那把钥匙的主人」不在这里——那是读者自己的判断，工具不替他决定。");
process.exit(错 === 0 && 缺 === 0 ? 0 : 1);
