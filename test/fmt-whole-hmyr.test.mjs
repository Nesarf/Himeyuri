// 整文件排版：self/fmt.hmoca 与 src/format.mjs 对同一批真实文件的输出相比。
//
// 两件事分开验，因为它们本来就不同：
//   一、没有注释的文件里，两者应当逐字节相同；
//   二、有注释的文件里，自举那一份会把注释留下，而宿主那一份按设计丢弃并报 HMYR-形-001 ——
//       所以「相同」不成立，但该成立的是「去掉注释行之后相同」。
//
// 这一套同时把 SELFRUN 里那句「整文件排版仍在 src/format.mjs」改写成一个可以跑的事实。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { format } from "../src/format.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 自举 = runUnit(loadUnit(path.join(ROOT, "self/fmt.hmoca")), { stepLimit: 400000000 });
const 自举整 = (源) => {
  try { return String(自举.callFunction(自举.functions.get("整文件"), [源], null)).trim(); }
  catch (e) { return "抛错：" + String(e && e.message).slice(0, 80); }
};
const 读 = (路) => fs.readFileSync(path.join(ROOT, 路), "utf8");

console.log("一、没有注释的文件：两边逐字节相同");
for (const 路 of ["examples/arith.hmoca", "examples/over.hmoca", "examples/twice.hmoca"]) {
  const 源 = 读(路);
  const 乙 = format(源, { quiet: true }).text;
  const 甲 = 自举整(源);
  ok(路, 甲 === String(乙).trim(), 甲 === String(乙).trim() ? "" : "行数 " + 甲.split("\n").length + " 对 " + String(乙).split("\n").length);
}

console.log("二、有注释的文件：自举那一份把注释留下，宿主那一份按设计丢弃");
{
  const 路 = "examples/demo.hmoca";
  const 源 = 读(路);
  const 甲 = 自举整(源);
  const 乙r = format(源, { quiet: true });
  ok("自举的输出里有注释行", 甲.split("\n").some((l) => l.trim().startsWith("//")), 甲.split("\n")[0]);
  ok("宿主的输出里没有注释行", String(乙r.text).split("\n").every((l) => !l.trim().startsWith("//")));
  // 去掉注释行与空行之后，两边应当一致
  const 洗 = (t) => t.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const a = 洗(甲), b = 洗(String(乙r.text));
  ok("去掉注释之后两边一致", a.join("\n") === b.join("\n"),
    a.join("\n") === b.join("\n") ? "" : "第 " + (a.findIndex((l, i) => l !== b[i]) + 1) + " 行起不同");
}

console.log("三、行尾的 carriage return 不会漏进输出");
{
  // 输入由这一节自己造：要验的是「排版器不把 CR 漏出去」，那件事不该依赖
  // 仓库里某一份文件的换行方式 —— 那份文件现在是 LF，而判据以前写着「它本身是 CRLF」，
  // 于是这一条红得毫无道理：被测的东西没坏，只是它踩的那块地板换了。
  const 源 = 读("conformance/lib-strings.hmoca").replace(/\r?\n/g, "\r\n");
  ok("输入确实是 CRLF", 源.includes("\r\n"));
  const 甲 = 自举整(源);
  ok("输出里没有 CR", !甲.includes("\r"), 甲.includes("\r") ? "第一处 CR 在第 " + (甲.split("\n").findIndex((l) => l.includes("\r")) + 1) + " 行" : "");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
