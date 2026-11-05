// self/ 的职责索引（design/SELF.txt）与实际的六十四份文件对不对得上。
//
// 三向是机制：漏了、多了、没写职责。第四向是这个套件真正要问的 ——
// 拿五件具体的改动去查表，看它给不给得出**唯一**的答案。
// 一张表如果三向都对，却答不出「改终端颜色动哪份」，那它只是装饰。
import { 检查, 读表 } from "../tools/selfmap.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、三向：漏了、多了、没写职责");
{
  const r = 检查();
  ok("self/ 下每一份都在表里", r.缺.length === 0, r.缺.join(" "));
  ok("表里没有已删的文件", r.多.length === 0, r.多.join(" "));
  ok("每一条都说得出职责", r.空职责.length === 0, r.空职责.join(" "));
  ok("行数与实际差不到两行", r.行数不对.length === 0, r.行数不对.join(" "));
}

console.log("");
console.log("二、四向：这五件事该动哪一份，表要答得出来");
{
  const 表 = 读表();
  // 每问：一句话 + 一个候选名单 + 期望命中的那一份。
  // 候选名单是「表里职责里含这个词」的全部条目，期望它**恰好一条** ——
  // 多了说明两件事挤在一个名字下，少了说明表没写清。
  const 问 = [
    ["改终端颜色与光标", "终端与按键", "eval-term.hmoca"],
    ["改数字字面量怎么解析", "数字字面量", "compile-number.hmoca"],
    ["改哪几个名字算内置", "内置", "compile-builtins.hmoca"],
    ["改读一棵源码树的方式", "读一棵", "run-load.hmoca"],
    ["改 deflate 的解码", "解码侧", "inflate.hmoca"],
  ];
  for (const [名, 词, 期望] of 问) {
    const 命中 = 表.filter((x) => x.职责.includes(词)).map((x) => x.文件);
    ok(名 + " 指向 " + 期望, 命中.length === 1 && 命中[0] === 期望, JSON.stringify(命中));
  }
}

console.log("");
console.log("三、这张表本身是诚实的");
{
  const 表 = 读表();
  const 空 = 表.filter((x) => x.职责.trim().length === 0);
  ok("没有一条是空职责", 空.length === 0, String(空.length));
  // 六十四份在九组里，没有一组是空的 —— 空组说明分组表与实际脱了节。
  const 文 = await import("node:fs").then((m) => m.readFileSync(new URL("../design/SELF.txt", import.meta.url), "utf8"));
  const 组数 = (文.match(/^-{3,}$/gm) || []).length;
  ok("分组标题至少九个", 组数 >= 9, String(组数));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
