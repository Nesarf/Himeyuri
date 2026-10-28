// 两位打包者交出同样的字节。
//
// 这里的「两位」是 self/pack.hmoca（HMYR 写的）与 src/code-file.mjs（JS 写的）。
// 判据是逐字节相同 —— 而不是「读回来能跑」：能跑是必要条件，而两边写出的字节
// 差两个也可能是能跑的。这一条要的是「同一份源码，两台机器，一个字节都不差」。
//
// 为什么它值一整套：design/COMPILER.txt 的「还借在 JS 那边的」最后一条就是
// .hmoks 的落盘。这一套钉住之后，那句话才有资格改成一个过去的时态。
//
// 第一条真的抓到过东西：空元组。JS 那一侧写成 0x04 加长度零，C/HMYR 那一侧
// 写成 0x00（这门语言没有 null，空元组就是它）—— 同一个程序差两个字节。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const 根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-pack-"));

let 过 = 0, 败 = 0;
const ok = (名, 条件, 细) => {
  if (条件) { 过++; console.log("  通过  " + 名); }
  else { 败++; console.log("  不通过  " + 名 + (细 ? "  " + 细 : "")); }
};

const 跑 = (参) => spawnSync(process.execPath, 参, { cwd: 根, encoding: "utf8", timeout: 600000 });

// 两边各写一份，交回 [pack 的字节, code-file 的字节]（失败时那一侧是 null）。
const 两边写 = (源, 名) => {
  const js  = path.join(临, 名 + "-codefile.hmoks");
  const pk  = path.join(临, 名 + "-pack.hmoks");
  const r1 = 跑(["tools/compile-hmyr.mjs", 源, js]);
  const r2 = 跑(["bin/hmyr.mjs", "--compile", "self/pack.hmoca", pk, 源]);
  return {
    js: fs.existsSync(js) ? fs.readFileSync(js) : null,
    pk: fs.existsSync(pk) ? fs.readFileSync(pk) : null,
    记: (r1.stderr || "") + (r2.stderr || ""),
  };
};

const 比 = (名, 源) => {
  const { js, pk, 记 } = 两边写(源, 名);
  if (!js || !pk) {
    ok(名 + "：两边都写出了文件", false, (记 || "").slice(0, 200));
    return;
  }
  ok(名 + "：长度相同", js.length === pk.length, "code-file " + js.length + " / pack " + pk.length);
  if (js.length !== pk.length) return;
  let 差 = -1;
  for (let i = 0; i < js.length; i++) if (js[i] !== pk[i]) { 差 = i; break; }
  ok(名 + "：逐字节相同", 差 < 0,
    差 < 0 ? "" : ("第一个不同在第 " + 差 + " 字节（code-file " +
       js[差].toString(16) + " / pack " + pk[差].toString(16) + "）"));
};

console.log("一、一个不带全局、不带效果的函数");
比("hello", "examples/hello.hmoca");

console.log("二、声明了效果的那个（examples/arena-on-board.hmoca）");
比("arena-on-board", "examples/arena-on-board.hmoca");

console.log("三、带模块级 const 的（全局那一栏）");
{
  const 源 = path.join(临, "记一个.hmoca");
  fs.writeFileSync(源,
    "const 基数 = 100\n" +
    "\n" +
    "fn 加(a: Int) -> Int {\n" +
    "  return a + 基数\n" +
    "}\n" +
    "\n" +
    "fn main() -> Int effects(process) {\n" +
    "  print(str(加(7)) + chr(10))\n" +
    "  return 0\n" +
    "}\n", "utf8");
  比("带全局", 源);
}

console.log("四、pack 写出来的东西读得回来，而且跑得出同一个答案");
{
  // 用一个会打印的程序：hello 的 main 是 return a + b，它什么也不打印，
  // 而「读回来跑得出同一个答案」要一段看得见的输出。
  const 源 = "examples/arena-on-board.hmoca";
  const pk = path.join(临, "读过.hmoks");
  跑(["bin/hmyr.mjs", "--compile", "self/pack.hmoca", pk, 源]);
  ok("文件在", fs.existsSync(pk), "");
  if (fs.existsSync(pk)) {
    const 头 = fs.readFileSync(pk).subarray(0, 5).toString("latin1");
    ok("开头是魔数 HMYRB", 头 === "HMYRB", 头);
    // 用 C 那台跑它：那是最不依赖 JS 的一条路。
    const c = 跑(["tools/run-bytecode.mjs", pk]);
    ok("读回来跑得出同一个答案", (c.stdout || "").includes("块数=20"), JSON.stringify((c.stdout || "").slice(0, 60)));
  }
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(过 + " passed, " + 败 + " failed");
if (败 > 0) process.exitCode = 1;
