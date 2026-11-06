// 回调竞态：一段里先 resolve 了，之后还有判据。
//
// 由来：2026-11-06 一天里同一种形状查出两处（pipe 与 socket）—— 判据挂在
// 子.on("exit") 或 跑(...).then(...) 上，而整段的 promise 在 sock.on("end") 里
// 就 resolve 了。文件末尾的 process.exit 于是常常赶在那些判据前面，它们一次都不跑，
// 而总数里只看得见少了一项。arm 那一次是同一类：判据被时序挡在门外，静默。
//
// 判据是位置，不是名字：块内的第一处“当场 resolve”出现在任何一处判据之前，就报。
// 三条例外，每一条都来自一次假阳性：
//   · 注释与字符串先换成等长空格 —— 否则工具会读到自己注释里的 resolve 与 ok。
//   · setTimeout(resolve, …) 与 setImmediate(resolve) 是延迟的，不算当场收尾。
//   · .on("error", …) 与 .catch(…) 里的东西只在出错时跑，那里的 resolve 与判据
//     都不参与“正常路径”的先后（socket 的假阳性就是 error 那一支的 resolve）。
//
// 用法：node tools/race-census.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 用法：
//   node tools/race-census.mjs                 扫 test/ 与 tools/
//   node tools/race-census.mjs --dir <目录>     只扫那一个目录
// --dir 是为 test/race-census.test.mjs 的自检加的：那一套要造一个已知有问题的样本
// 来证明这个工具抓得到，而样本不该写进仓库 —— 写进临时目录、扫临时目录就够。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参数 = process.argv.slice(2);
const 指 = 参数.indexOf("--dir");
const 目录表 = 指 >= 0 && 参数[指 + 1]
  ? [path.isAbsolute(参数[指 + 1]) ? 参数[指 + 1] : path.join(ROOT, 参数[指 + 1])]
  : [path.join(ROOT, "test"), path.join(ROOT, "tools")];

// 两份等长文本，用同一个下标空间：
//   · 去注释 —— 用来认 .on("error" 与 .catch(，那三处要靠字符串才认得出来
//   · 去注释与字符串 —— 用来找 ok( 与 resolve(，否则一套自检里那段「样本源码」
//     字符串会被当成真代码读进来（test/race-census.test.mjs 第一次跑就是这样：
//     工具抓到了那一套自己）
// 抹成等长空格而不是删掉，这样两份文本的下标一致，行号也算得对。
const 去注释 = (源) => 源
  .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
const 去注释与串 = (源) => 去注释(源)
  .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => '"' + " ".repeat(m.length - 2) + '"')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'");

let 块数 = 0, 处 = 0;
for (const 目录 of 目录表) {
  for (const f of fs.readdirSync(目录)) {
    if (!f.endsWith(".mjs")) continue;
    const 原文 = fs.readFileSync(path.join(目录, f), "utf8");
    const 认文 = 去注释(原文);        // 认 .on("error" 用这一份：字符串还看得见
    const 源 = 去注释与串(原文);      // 切块与找判据用这一份：字符串里的代码不算代码
    const 行首 = [0];
    for (let i = 0; i < 源.length; i++) if (源[i] === "\n") 行首.push(i + 1);
    const 行号 = (位) => { let n = 1; for (let i = 0; i < 行首.length; i++) if (行首[i] <= 位) n = i + 1; return n; };
    const 切块 = (起) => {
      let 深 = 0;
      for (let i = 起; i < 源.length; i++) {
        if (源[i] === "{") 深++;
        else if (源[i] === "}") { 深--; if (深 === 0) return [起, i]; }
      }
      return [起, 源.length - 1];
    };

    let p = 源.indexOf("new Promise(");
    while (p >= 0) {
      块数++;
      const [块起, 块终] = 切块(源.indexOf("{", p));
      const 体 = 源.slice(块起, 块终 + 1);

      // 排除区间：.on("error" 与 .catch( 各自的回调块。找名字用认文（那里字符串还在），
      // 切块用源（那里字符串里的花括号已经抹平，不会把块切歪）。
      const 排除 = [];
      for (const m of 认文.slice(块起, 块终).matchAll(/\.on\(\s*"error"|\.catch\s*\(/g)) {
        const 花 = 源.indexOf("{", 块起 + m.index);
        if (花 < 0) continue;
        const [a, b] = 切块(花);
        排除.push([a, b]);
      }
      const 在排除区 = (位) => 排除.some(([a, b]) => 位 >= a && 位 <= b);

      const 决 = [...体.matchAll(/(?<!setTimeout\()(?<!setImmediate\()\bresolve\s*\(/g)]
        .map((m) => 块起 + m.index).filter((位) => !在排除区(位));
      const 判 = [...体.matchAll(/(?:^|[^\w.])ok\(/g)]
        .map((m) => 块起 + m.index).filter((位) => !在排除区(位));

      if (决.length && 判.length) {
        const 首决 = Math.min(...决);
        const 后头 = 判.filter((位) => 位 > 首决);
        if (后头.length) {
          处++;
          console.log(path.basename(目录) + "/" + f + ":" + 行号(p) +
            "  当场 resolve 在第 " + 行号(首决) + " 行，之后还有 " + 后头.length +
            " 条判据（第 " + 后头.map(行号).join(",") + " 行）");
        }
      }
      p = 源.indexOf("new Promise(", 块终);
    }
  }
}
console.log("");
console.log("扫过 " + 块数 + " 个 new Promise 块，" + 处 + " 处有竞态形状");
