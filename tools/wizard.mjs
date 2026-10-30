// 向导：第一次到这里的人该做什么。
//
// design/DISTRO.txt 里数过 Nyarch 的七样，向导是其中一样。
// 它的规矩有三条：
//   一、什么都不装。装东西是人的决定，不是向导的决定。
//   二、每一项检查都说清「要不要紧」——「没有 python」与「没有 node」不是一个量级。
//   三、最后给下一步，而不是给一堆结论。
//
//   node tools/wizard.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let 要紧 = 0, 可选 = 0;

const 行 = (标志, 标题, 说明) => {
  const 符 = { 有: "[有]  ", 没有: "[没有]", 缺: "[缺]  " }[标志] || "[    ]";
  console.log("  " + 符 + " " + 标题);
  if (说明) console.log("         " + 说明);
};
const 查 = (条件, 标题, 说明, 必要性) => {
  if (条件) { 行("有", 标题, 说明); return true; }
  if (必要性 === "要") { 要紧++; 行("缺", 标题, 说明 + "（这一件不为真，别的都起不来）"); }
  else { 可选++; 行("没有", 标题, 说明 + "（没有也行，只是会少一点东西）"); }
  return false;
};

console.log("");
console.log("  Himeyuri 向导");
console.log("  " + "=".repeat(60));
console.log("");

console.log("  一、起得来吗");
查(Number(process.versions.node.split(".")[0]) >= 20, "Node 20 以上（现在是 " + process.versions.node + "）",
  "这一份用纯 ESM，没有构建、没有依赖——就靠它。", "要");
查(fs.existsSync(path.join(ROOT, "bin/hmyr.mjs")), "启动器 bin/hmyr.mjs",
  "跑一个 .hmyr 文件用它：node bin/hmyr.mjs 你的文件.hmoca", "要");
查(fs.existsSync(path.join(ROOT, "src/eval.mjs")), "宿主的求值器",
  "语言跑在这一层上；将来会换成自举那一层（见 design/SELFRUN.txt）。", "要");

console.log("");
console.log("  二、验一遍吗");
{
  const 套件 = (fs.readFileSync(path.join(ROOT, "tools/check-all.mjs"), "utf8").match(/test\/[a-z0-9\-]+\.test\.mjs/g) || []).length;
  行("有", "套件 " + 套件 + " 套", "全量跑：node tools/check-all.mjs —— 绿了才说明这一份是好的。");
  const 清单 = path.join(ROOT, "dist/manifest.json");
  if (fs.existsSync(清单)) {
    const 签 = 清单 + ".sig";
    行("有", "一份已经打好的清单" + (fs.existsSync(签) ? "（还带签名）" : ""),
      "验它：node tools/verify.mjs —— 一次就说清内容与签名对不对。");
  } else {
    行("没有", "还没有打好的清单", "打一份：node tools/package.mjs");
  }
}

console.log("");
console.log("  三、能用什么（都是可选的）");
{
  const py = process.env.HMYR_PYTHON || "E:/DaShaoHuo/Python-managed/bin/python.exe";
  查(fs.existsSync(py), "Python（颜色桥与 PNG 导出用）",
    "没有它，颜色那一层与像素导出跑不了；别的照常。", "可选");
  const 钥匙 = "C:/Windows/System32/OpenSSH/ssh-keygen.exe";
  const 私钥 = "C:/Users/Administrator/.ssh/signing_ed25519_20261011";
  查(fs.existsSync(钥匙) && fs.existsSync(私钥), "签名钥匙（发布物签名用）",
    "没有它，包只有哈希没有签名；那正是 S.M.Y.T. 对压缩归档的做法能成立的前提。", "可选");
}

console.log("");
console.log("  四、接下来");
console.log("     想跑一段看看：   node bin/hmyr.mjs examples/hello.hmoca");
console.log("     想读这门语言：   design/TOUR.txt（给人读的，不是给做的人读的）");
console.log("     想知道它装了什么：node tools/manifest.mjs");
console.log("     遇到错误编号：   node tools/helper.mjs HMYR-行-010");
console.log("     想知道自己旧了： node tools/update.mjs");
console.log("");
if (要紧 === 0) console.log("  起得来。上面的可选件缺几件也不要紧。");
else console.log("  有 " + 要紧 + " 件要紧的东西不为真，先补它们。");
console.log("");
process.exit(要紧 === 0 ? 0 : 1);
