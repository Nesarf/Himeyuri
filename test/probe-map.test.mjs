// probes/ 的探针与 design/PROBES.txt 对不对得上。
//
// 三向：漏了（有一份探针没人知道它问什么）、多了（表里有一份已经不在）、
// 空问（写了文件名却没写「当时在问什么」）。
//
// 第四向是这张表真正的用处：从索引回答「某个问题该看哪份探针」。
// 一张表如果三向都对、却答不出「短路求值的问题看哪份」，它就是装饰。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const 表路 = path.join(ROOT, "design/PROBES.txt");

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

function 读表() {
  const 文 = fs.readFileSync(表路, "utf8");
  const 行们 = [];
  for (const l of 文.split("\n")) {
    const m = l.match(/^ {2}(\S+\.hmoca) +(\d+) +(\S.*?) {2,}(\S.*)$/);
    if (m) 行们.push({ 文件: m[1], 行数: Number(m[2]), 问: m[3].trim(), 答: m[4].trim() });
  }
  return 行们;
}

const 实际 = fs.readdirSync(path.join(ROOT, "probes")).filter((f) => f.endsWith(".hmoca")).sort();
const 表 = 读表();

console.log("一、三向：漏了、多了、空问");
ok("probes/ 下每一份都在表里", 表.filter((x) => !实际.includes(x.文件)).length === 0,
  JSON.stringify(表.filter((x) => !实际.includes(x.文件)).map((x) => x.文件)));
ok("表里没有已删的探针", 实际.filter((f) => !表.some((x) => x.文件 === f)).length === 0,
  JSON.stringify(实际.filter((f) => !表.some((x) => x.文件 === f))));
ok("每一条都写了「当时在问什么」", 表.filter((x) => x.问.length < 4).length === 0,
  JSON.stringify(表.filter((x) => x.问.length < 4).map((x) => x.文件)));
ok("每一条都写了答案落在哪（没有也算写了）", 表.filter((x) => x.答.length < 2).length === 0);

console.log("");
console.log("二、四向：这四件事该看哪一份探针");
{
  const 问 = [
    ["短路求值里 && 的右边该不该算", "有前提不成立", "probe-and.hmoca"],
    ["两个机器上 argv 里装了什么", "argv", "probe-argv.hmoca"],
    ["含换行的字符串怎么算长度", "换行", "probe-len.hmoca"],
    ["宿主启动器能不能引入自举层的模块", "宿主启动器", "probe-load.hmoca"],
  ];
  for (const [名, 词, 期望] of 问) {
    const 命中 = 表.filter((x) => x.问.includes(词)).map((x) => x.文件);
    ok(名 + " 指向 " + 期望, 命中.length === 1 && 命中[0] === 期望, JSON.stringify(命中));
  }
}

console.log("");
console.log("三、行数那格不能是瞎写的");
{
  const 偏 = 表.filter((x) => {
    const p = path.join(ROOT, "probes", x.文件);
    if (!fs.existsSync(p)) return false;
    return Math.abs(fs.readFileSync(p, "utf8").split("\n").length - x.行数) > 2;
  }).map((x) => x.文件 + " 表 " + x.行数);
  ok("行数与实际差不到两行", 偏.length === 0, JSON.stringify(偏));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
