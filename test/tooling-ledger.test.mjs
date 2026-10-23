// 工具链账本：每一项要么搬了，要么被判为不必搬，两种都要有据可查。
//
// 这一套盯的是「结清」这个词本身：
//   搬了的   必须有一个真的在 check-all 清单里的验收套件 —— 不是「记得跑过」
//   不搬的   必须有理由，而它的文件必须落在 runtime-path 的工具清单里 ——
//            那就是「不在运行时路径上」的可执行证明
//
// 少了这一套，SELFRUN 里那句「逐项结清」就只是句子。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 账本 } from "../tools/tooling-ledger.mjs";
import { 工具们 } from "../tools/runtime-path.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 清单 = fs.readFileSync(path.join(ROOT, "tools/suite-list.txt"), "utf8")
  .split("\n").filter((l) => l.includes("\t")).map((l) => l.split("\t")[0]);

console.log("一、每一项都说清了自己是什么状态");
{
  ok("账本不是空的", 账本.length >= 10, String(账本.length));
  const 无名 = 账本.filter((x) => !x.名 || !x.状态);
  ok("每项都有名字与状态", 无名.length === 0, 无名.map((x) => x.名 || "(无名)").join(" "));
  const 坏状态 = 账本.filter((x) => !x.状态.startsWith("搬") && x.状态 !== "不搬");
  ok("状态只有两种：搬了（可带版本）或不搬", 坏状态.length === 0, 坏状态.map((x) => x.名 + "=" + x.状态).join(" "));
}

console.log("二、搬了的每一项都有真的验收套件");
{
  const 搬了 = 账本.filter((x) => x.状态.startsWith("搬"));
  for (const 项 of 搬了) {
    ok(项.名 + " 的验收「" + 项.验收 + "」在 check-all 清单里", 清单.includes(项.验收), 项.验收);
    ok(项.名 + " 写着自己搬去了哪", !!项.在哪, 项.在哪 || "(没写)");
  }
}

console.log("三、不搬的每一项都有理由，而且有可执行的证明");
{
  const 不搬 = 账本.filter((x) => x.状态 === "不搬");
  ok("有几项是判为不搬的", 不搬.length >= 1, String(不搬.length));
  for (const 项 of 不搬) {
    ok(项.名 + " 说了为什么不搬", !!(项.为什么不搬 && 项.为什么不搬.length > 20), 项.为什么不搬 || "(没写)");
    ok(项.名 + " 给了证明文件", Array.isArray(项.证明) && 项.证明.length > 0, "");
    for (const f of 项.证明 || []) {
      ok(项.名 + " 的证明文件 " + f + " 在", fs.existsSync(path.join(ROOT, f)), f);
      ok(项.名 + " 的证明文件 " + f + " 落在工具清单里", 工具们.has(f), f);
    }
  }
}

console.log("四、判为不搬的覆盖了剩下那几样");
{
  // 三样必须出现在账本里：格式化器、打包发布、语料生成剩下的三支。
  // 格式化器已经有第一版了，所以这里只要求「在账本里」，不要求它是「不搬」。
  const 全证明 = 账本.flatMap((x) => [...(x.证明 || []), x.在哪 || ""]);
  ok("格式化器在账本里", 账本.some((x) => x.名 === "格式化器"), "");
  ok("整文件排版那一份被点名", 全证明.includes("src/format.mjs"), "");
  ok("打包发布被点名", 全证明.includes("tools/package.mjs"), "");
  ok("语料生成剩下的三支被点名", 全证明.includes("tools/ucd-case.mjs") && 全证明.includes("tools/ucd-nfc.mjs") && 全证明.includes("tools/ucd.mjs"), "");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
