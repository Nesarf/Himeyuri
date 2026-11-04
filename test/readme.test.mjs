// README 里那几个数字：它们必须与仓库此刻的样子一致。
//
// 为什么要有这一份：README 是外人看到的第一页，而它写着「202 个套件」「47 份设计稿」
// 「错误码表（105 个）」—— 这三处今天已经分别是 217、51、108，没有一处对。
// 这与 builtin-gap 那一列是同一个病：一个数字写下来之后没人核，它就会慢慢变成
// 一句装饰。区别只在于 README 更显眼。
//
// 判据只做一件事：从 README 里把这三个数抽出来，与仓库此刻数一遍的结果比。
// 数字变了就红，红的人去改 README —— 那是这一份存在的意义，不是麻烦。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODES } from "../conformance/codes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = path.join(ROOT, "README.md");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 仓库此刻的数。三处都要现数，不能抄 —— 抄来的数就是这一份要防的那种东西。
const 套件数 = fs.readFileSync(path.join(ROOT, "tools/suite-list.txt"), "utf8")
  .split("\n").filter((l) => l.trim() !== "").length;
const 设计稿数 = fs.readdirSync(path.join(ROOT, "design")).filter((f) => f.endsWith(".txt")).length;
const 错误码数 = Object.keys(CODES).length;

// 取数要能对着「任意一段文本」取，因为反向那一节会用改坏之后的文本再取一次。
const 取数 = (源, re) => {
  const m = re.exec(源);
  return m ? Number(m[1]) : null;
};
const 套件式 = /test\/\s+(\d+) 个套件/;
const 设计式 = /design\/\s+(\d+) 份设计稿/;
const 码式 = /错误码表（(\d+) 个）/;

const 文 = fs.readFileSync(README, "utf8");

console.log("一、README 里写的数等于仓库此刻的数");
{
  const 写套件 = 取数(文, 套件式);
  ok("写着套件数", 写套件 !== null, "没找到那一行");
  ok("套件数与 tools/suite-list.txt 一致（写 " + 写套件 + "，实 " + 套件数 + "）",
    写套件 === 套件数, "");

  const 写设计 = 取数(文, 设计式);
  ok("写着设计稿数", 写设计 !== null, "没找到那一行");
  ok("设计稿数与 design/ 下的 .txt 数一致（写 " + 写设计 + "，实 " + 设计稿数 + "）",
    写设计 === 设计稿数, "");

  const 写码 = 取数(文, 码式);
  ok("写着错误码数", 写码 !== null, "没找到那一行");
  ok("错误码数与 conformance/codes.mjs 的条目数一致（写 " + 写码 + "，实 " + 错误码数 + "）",
    写码 === 错误码数, "");
}

console.log("二、反向：把 README 里的套件数改错一位，第一条判据必须不成立");
{
  // 一条判据若从没见过红，它就是个占位符。这里真的改一次文件、再取一次数、
  // 再比较 —— 而不是用一个算术比较假装验过了。跑完换回原文。
  const 原 = 文;
  const 写套件 = 取数(原, 套件式);
  if (写套件 === null) {
    ok("反向改动落到了位置（否则这一节什么都没验）", false, "没找到套件数那一行");
  } else {
    const 坏 = 原.replace(new RegExp("test/\\s+" + 写套件 + " 个套件"), "test/           " + (写套件 + 1) + " 个套件");
    if (坏 === 原) {
      ok("反向改动落到了位置（否则这一节什么都没验）", false, "替换没有命中");
    } else {
      fs.writeFileSync(README, 坏, "utf8");
      try {
        const 再取 = 取数(fs.readFileSync(README, "utf8"), 套件式);
        ok("改错一位之后与实际的数不符（判据抓得住）", 再取 !== 套件数, 再取 + " 对 " + 套件数);
      } finally {
        fs.writeFileSync(README, 原, "utf8");
      }
    }
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
