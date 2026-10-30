// write_text：规格里有它，而两处求值器一直没转发。这一套钉住它真的写得出来，
// 也钉住「写进去的与读回来的同一个」。
//
// 它用最小求值器直接跑 conformance/write-text.hmoca，而不经启动器 ——
// 因为自举层现在还不认目标程序的效果声明，凡是声明 effects(file) 的程序在那一层会撞 HMYR-內-001。
// 那是加载/求值那一侧的缺口，记在 design/LIB.txt 的「还缺什么」里。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 最小运行 } from "../src/minimal-eval.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 路 = "E:/DaShaoHuo/cache/tmp/hmyr-write-text.txt";

console.log("一、写得出来，而且读回来是同一份");
{
  fs.rmSync(路, { force: true });
  const 层 = loadUnit(path.join(ROOT, "conformance/write-text.hmoca"));
  ok("程序读得进", 层.ok, JSON.stringify(层.diagnostics.errors.slice(0, 2).map((e) => e.code)));
  if (层.ok) {
    let 码 = null, 错 = "";
    try {
      const rt = 最小运行(层, { write: () => {}, capabilities: 本机能力() });
      // 目标程序从 argv 取路径 —— 自举层那条路已经把它交进环境，这里手动给同一份。
      // 第一位是程序自己的名字，与语言的规矩一致。
      rt.argv = ["conformance/write-text.hmoca", 路];
      码 = rt.callFunction(rt.functions.get("main"), [], null);
    } catch (e) { 错 = (e.code || "") + " " + e.message; }
    ok("main 交回零（写对了、读回来也对）", 码 === 0, String(码) + " " + 错.slice(0, 60));
  }
  ok("文件真的在", fs.existsSync(路));
  ok("文件内容是那四个字", fs.existsSync(路) && fs.readFileSync(路, "utf8") === "写着玩的",
    fs.existsSync(路) ? JSON.stringify(fs.readFileSync(路, "utf8")) : "(没有文件)");
}

console.log("二、效果那一层：要 file 才有写");
{
  // 不声明 effects(file) 的 main 调 write_text，应当被拒绝（HMYR-內-001），而不是悄悄写出去。
  const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-wt-");
  const p = path.join(临, "noeffect.hmoca");
  fs.writeFileSync(p, 'fn main() -> Int {\n  write_text("' + 临.replace(/\\\\/g, "/") + '/x.txt", "a")\n  return 0\n}\n', "utf8");
  const 层 = loadUnit(p);
  let 码 = null, 错 = "";
  try {
    const rt = 最小运行(层, { write: () => {}, capabilities: 本机能力() });
    码 = rt.callFunction(rt.functions.get("main"), [], null);
  } catch (e) { 错 = (e.code || "") + " " + e.message; }
  ok("没声明效果时被拒绝（HMYR-內-001）", String(错).includes("HMYR-內-001"), String(错).slice(0, 80));
  ok("而被拒绝时也没有写出文件", !fs.existsSync(path.join(临, "x.txt")));
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
fs.rmSync(路, { force: true });
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
