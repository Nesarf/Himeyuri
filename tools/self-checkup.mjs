// 一条命令做完自举的三段体检：解释、造字节、验签。
//
// 三段各自是一个套件（selfvmeval、selfvmcompile、sign），而这一件把它们串起来，
// 用一份报告回答「这台机器现在能不能自己跑自己、自己造字节、自己验签」。
//
// 用法：node tools/self-checkup.mjs
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 段们 = [
  ["解释    self-vm-eval", "tools/self-vm-eval.mjs", "自举的解释器跑在虚拟机上，四段程序与宿主给出同样的答案"],
  ["造字节  self-vm-compile", "tools/self-vm-compile.mjs", "自举的编译与打包跑在虚拟机上，五段字节与 JS 那位一致，并验一次真实签名"],
  ["验签    sign", "test/sign.test.mjs", "真实发布的签名验得过，改一个字节验不过"],
];

console.log("自举体检 —— 一条命令跑完三段");
console.log("");
let 总过 = 0;
let 总败 = 0;
const 行们 = [];
for (const [名, 脚本, 说明] of 段们) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 脚本)], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const 用时 = ((Date.now() - t0) / 1000).toFixed(1);
  const 出 = String(r.stdout || "") + String(r.stderr || "");
  const m = /(\d+) passed, (\d+) failed/.exec(出);
  const 过 = m ? Number(m[1]) : 0;
  const 败 = m ? Number(m[2]) : (r.status === 0 ? 0 : 1);
  总过 += 过;
  总败 += 败;
  行们.push({ 名, 过, 败, 用时, 说明, 状态: r.status });
}

for (const 行 of 行们) {
  const 判 = 行.败 === 0 ? "通过" : "不通过";
  console.log("  " + 判 + "  " + 行.名.padEnd(26) + 行.过 + " 项过 · " + 行.败 + " 项红 · " + 行.用时 + " 秒");
  console.log("        " + 行.说明);
}
console.log("");
console.log("合计 " + 总过 + " 项过 · " + 总败 + " 项红");
process.exit(总败 === 0 ? 0 : 1);
