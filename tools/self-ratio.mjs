// 自举比例：仓库里有多少行是 HMYR 自己写的，多少行是别的语言写的。
//
// 这个数字只在一个方向上诚实。净增 HMYR 代码能让它涨；把对照实现删掉也能让它涨 ——
// 而后者会拆掉「两台机器同一个答案」那句话。所以这一份只报数，不给结论，
// 让人看得见分子与分母各自是什么。
//
// 为什么不把 test/ 算进去：验收是「两个人分别算一遍再对答案」，它不是被验收的
// 那个东西。算进去会让比例随测试数量漂，而测试的多少与自举程度无关。
//
// 用法：node tools/self-ratio.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 数 = (相对, 后缀) => {
  const 全 = path.join(ROOT, 相对);
  if (!fs.existsSync(全)) return { 文: 0, 行: 0 };
  let 文 = 0, 行 = 0;
  for (const e of fs.readdirSync(全, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const 子 = 数(path.join(相对, e.name), 后缀);
      文 += 子.文;
      行 += 子.行;
    } else if (e.name.endsWith(后缀)) {
      文++;
      const 内容 = fs.readFileSync(path.join(全, e.name), "utf8");
      行 += 内容.split("\n").length - (内容.endsWith("\n") ? 1 : 0);
    }
  }
  return { 文, 行 };
};

const 组们 = [
  { 名: "自举", 语: "HMYR", 据: 数("self", ".hmoca") },
  { 名: "自举的宿主侧", 语: "JS", 据: 数("self", ".mjs") },
  { 名: "宿主执行器", 语: "JS", 据: 数("src", ".mjs") },
  { 名: "工具", 语: "JS", 据: 数("tools", ".mjs") },
  { 名: "C 机器", 语: "C", 据: 数("vm", ".c") },
];

const 总行 = 组们.reduce((s, g) => s + g.据.行, 0);
const 自举行 = 组们.filter((g) => g.语 === "HMYR").reduce((s, g) => s + g.据.行, 0);

console.log("自举比例（不含 test/，不含 data/ 与 deps/ 里的语料）");
console.log("");
for (const g of 组们) {
  const 份 = 总行 === 0 ? 0 : (g.据.行 / 总行) * 100;
  console.log(
    "  " + g.名.padEnd(14) + String(g.据.文).padStart(4) + " 份  " +
    String(g.据.行).padStart(6) + " 行  " + 份.toFixed(1).padStart(5) + "%  " + g.语,
  );
}
console.log("");
console.log("  合计 " + 总行 + " 行，其中 HMYR 写的 " + 自举行 + " 行");
console.log("  自举比例 " + (总行 === 0 ? "0.0" : ((自举行 / 总行) * 100).toFixed(1)) + "%");
console.log("");
console.log("  读这个数的两条规矩：");
console.log("    一、删掉对照实现能让它涨，而那会拆掉「两台机器同一个答案」这句话；");
console.log("    二、净增 HMYR 代码也能让它涨，那是唯一诚实的涨法。");
