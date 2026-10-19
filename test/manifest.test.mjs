// 清单的验收：它列的每一项都真的存在。
//
// 一份清单最坏的样子是漂亮而假——写着一堆不存在的东西，而读它的人信了。
// 这一套就查那一件事：每个路径都要能 stat 到，而最小内置集要正好是那十五个。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const r = spawnSync(process.execPath, [path.join(ROOT, "tools/manifest.mjs")], { encoding: "utf8" });
ok("清单工具跑得动", r.status === 0, String(r.status));
let 清单 = null;
try { 清单 = JSON.parse(r.stdout); } catch (e) { console.log("    解析失败：" + String(e.message).slice(0, 80)); }
ok("输出是一份 JSON", 清单 !== null);

if (清单) {
  console.log("一、内核那一节");
  ok("内置数大于四十", typeof 清单.kernel.builtins === "number" && 清单.kernel.builtins > 40, String(清单.kernel.builtins));
  ok("最小内置集正好十五个", 清单.kernel.minimalSet.length === 15, String(清单.kernel.minimalSet.length));
  ok("而它是排过序的（于是能 diff）", JSON.stringify(清单.kernel.minimalSet) === JSON.stringify([...清单.kernel.minimalSet].sort()));

  console.log("二、它列的每一项都存在");
  const 缺 = [];
  for (const 件 of 清单.standardLibrary) if (!fs.existsSync(path.join(ROOT, 件.file))) 缺.push(件.file);
  for (const 件 of 清单.suites) if (!fs.existsSync(path.join(ROOT, 件.path))) 缺.push(件.path);
  for (const 件 of 清单.tools) if (!fs.existsSync(path.join(ROOT, "tools", 件))) 缺.push("tools/" + 件);
  for (const 件 of 清单.documents) if (!fs.existsSync(path.join(ROOT, "design", 件))) 缺.push("design/" + 件);
  ok("一个都不缺", 缺.length === 0, 缺.slice(0, 4).join(" "));

  console.log("三、数量对得上");
  ok("标准库至少有一件", 清单.standardLibrary.length >= 1, String(清单.standardLibrary.length));
  ok("套件数大于六十", 清单.suites.length > 60, String(清单.suites.length));
  // 不写死一个数：documents 是 design/ 里的 .txt，而别的文档（README.md）不在这里。
  // 于是这里只查下限，而那才是这一条该说的话。
  ok("文档至少十份", 清单.documents.length >= 10, String(清单.documents.length));
  ok("工具数大于四", 清单.tools.length > 4, String(清单.tools.length));

  console.log("四、路径写成斜杠（于是清单跨平台）");
  const 反斜杠 = 清单.standardLibrary.filter((f) => f.file.indexOf("\\") >= 0);
  ok("标准库的路径里没有反斜杠", 反斜杠.length === 0, JSON.stringify(反斜杠.slice(0, 2)));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
