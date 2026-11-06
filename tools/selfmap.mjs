// self/ 的职责索引：design/SELF.txt 与实际文件对不对得上。
//
// 三向：
//   一、self/ 下每一份 .hmoca 都在表里（漏了就是「有一份没人知道它管什么」）
//   二、表里没有已经删掉的文件（多了就是「表在骗人」）
//   三、每一行都说得出职责（空行等于没写）
//
// 第四向是实用的那一条：从表里回答「改某件事该动哪个文件」。它不是自动能判的，
// 所以那五问写在 test/selfmap.test.mjs 里，由读表的人（这里是一段代码）去查。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const 表路 = path.join(ROOT, "design/SELF.txt");

// 表里的每一行：两格以上的空格之后是行数，再两格之后是职责。
export function 读表() {
  const 文 = fs.readFileSync(表路, "utf8");
  const 行批 = [];
  for (const l of 文.split("\n")) {
    const m = l.match(/^ {2}(\S+\.hmoca) +(\d+) +(.*)$/);
    if (m) 行批.push({ 文件: m[1], 行数: Number(m[2]), 职责: m[3].trim() });
  }
  return 行批;
}

export function 实际的() {
  return fs.readdirSync(path.join(ROOT, "self"))
    .filter((f) => f.endsWith(".hmoca"))
    .sort();
}

// 三向检查，交回 {缺, 多, 空职责, 行数不对}
export function 检查() {
  const 表 = 读表();
  const 表里 = 表.map((x) => x.文件);
  const 实 = 实际的();
  const 缺 = 实.filter((f) => !表里.includes(f));
  const 多 = 表里.filter((f) => !实.includes(f));
  const 空职责 = 表.filter((x) => x.职责.length < 6).map((x) => x.文件);
  const 行数不对 = 表.filter((x) => {
    const p = path.join(ROOT, "self", x.文件);
    if (!fs.existsSync(p)) return false;
    const 真 = fs.readFileSync(p, "utf8").split("\n").length;
    return Math.abs(真 - x.行数) > 2;
  }).map((x) => x.文件 + " 表 " + x.行数);
  return { 表, 缺, 多, 空职责, 行数不对 };
}

if (process.argv[1] && process.argv[1].endsWith("selfmap.mjs")) {
  const r = 检查();
  console.log("表里 " + r.表.length + " 条，self/ 下 " + 实际的().length + " 份");
  if (r.缺.length) console.log("漏了：" + r.缺.join(" "));
  if (r.多.length) console.log("表里有但文件没了：" + r.多.join(" "));
  if (r.空职责.length) console.log("没写职责：" + r.空职责.join(" "));
  if (r.行数不对.length) console.log("行数差得远：" + r.行数不对.join(" "));
  const 全对 = !r.缺.length && !r.多.length && !r.空职责.length && !r.行数不对.length;
  console.log(全对 ? "三向都对得上" : "对不上");
  process.exit(全对 ? 0 : 1);
}
