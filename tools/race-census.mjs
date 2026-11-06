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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 注释换成等长空格 —— 下标不变，行号还对得上。字符串**不**动：
// 排除区间要靠 .on("error" 与 .catch( 认出来，把字符串也抹成空格就认不出了
// （第一版就是这么错的，于是 error 守卫里的 resolve 又被当成当场收尾）。
const 净 = (源) => 源
  .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

let 块数 = 0, 处 = 0;
for (const d of ["test", "tools"]) {
  for (const f of fs.readdirSync(path.join(ROOT, d))) {
    if (!f.endsWith(".mjs")) continue;
    const 源 = 净(fs.readFileSync(path.join(ROOT, d, f), "utf8"));
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

      // 排除区间：.on("error" 与 .catch( 各自的回调块
      const 排除 = [];
      for (const m of 体.matchAll(/\.on\(\s*"error"|\.catch\s*\(/g)) {
        const 花 = 体.indexOf("{", m.index);
        if (花 < 0) continue;
        const [a, b] = 切块(块起 + 花);
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
          console.log(d + "/" + f + ":" + 行号(p) +
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
