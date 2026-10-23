// 运行时路径的 import 闭包：从入口出发顺着 import 走，看有没有工具模块。
//
// 为什么要有它：design/SELFRUN.txt 的「远读法」有两种结清方式 ——
// 把工具搬进 HMYR，或者证明它们不在「跑程序」这条路上。
// 后一种是可执行的：闭包算出来，碰到工具就红。
//
// 用法：node tools/runtime-path.mjs          列出每个入口的闭包与越界项
//       node tools/runtime-path.mjs --check  只报越界（给测试用）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 「工具」这一类：它们只服务于人在开发时的动作，不参与跑程序。
export const 工具们 = new Set([
  "src/format.mjs",
  "src/lsp.mjs",
  "src/embed.mjs",
  "src/reflect.mjs",
  "src/adapter.mjs",
  "tools/package.mjs",
  "tools/release.mjs",
  "tools/manifest.mjs",
  "tools/verify.mjs",
  "tools/corpus.mjs",
  "tools/ucd.mjs",
  "tools/ucd-c.mjs",
  "tools/ucd-case.mjs",
  "tools/ucd-nfc.mjs",
  "tools/check-all.mjs",
  "tools/check-docs.mjs",
  "tools/check-builtins.mjs",
  "tools/builtin-gap.mjs",
  "tools/helper.mjs",
  "tools/wizard.mjs",
  "tools/bench.mjs",
  "tools/update.mjs",
  "tools/conformance.mjs",
  "tools/compile-hmyr.mjs",
  "tools/emit-code.mjs",
  "tools/run-bytecode.mjs",
  "tools/arm-size.mjs",
]);

function 闭包(入口) {
  const 见 = new Set();
  const 栈 = [入口];
  while (栈.length) {
    const f = 栈.pop();
    if (见.has(f)) continue;
    let 源;
    try { 源 = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
    见.add(f);
    for (const m of 源.matchAll(/(?:^|\s)(?:import|export)[^;]*?from\s+"([^"]+)"/g)) {
      const p = m[1];
      if (!p.startsWith(".")) continue;   // node: 与裸名不算工具
      const 全 = path.posix.normalize(path.posix.join(path.posix.dirname(f), p));
      if (fs.existsSync(path.join(ROOT, 全))) 栈.push(全);
    }
    // 动态 import() 也算：它一样把一条路接进来。
    for (const m of 源.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
      const p = m[1];
      if (!p.startsWith(".")) continue;
      const 全 = path.posix.normalize(path.posix.join(path.posix.dirname(f), p));
      if (fs.existsSync(path.join(ROOT, 全))) 栈.push(全);
    }
  }
  return 见;
}

export { 闭包 };

// 五个入口：node 启动器（它把目标交给自举层）与三份执行器，外加一个只当命令用的入口。
export const 入口们 = ["bin/hmyr.mjs", "bin/run-eval.mjs", "src/eval.mjs", "src/minimal-eval.mjs", "src/vm.mjs"];

// 被别的文件 import（测试）时不出声、不退出；只有直接运行时才是命令。
const 直接运行 = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (直接运行) {
  let 越界总数 = 0;
  const 行们 = [];
  for (const 入口 of 入口们) {
    const 见 = 闭包(入口);
    const 越界 = [...见].filter((f) => 工具们.has(f)).sort();
    越界总数 += 越界.length;
    行们.push(入口 + "：闭包 " + 见.size + " 个文件" + (越界.length ? "，碰到工具 " + 越界.join(" ") : "，一个工具都没碰"));
  }

  if (process.argv.includes("--check")) {
    for (const 行 of 行们) console.log("  " + 行);
    if (越界总数 === 0) console.log("  运行时路径上没有工具模块");
    process.exit(越界总数 === 0 ? 0 : 1);
  }
  for (const 行 of 行们) console.log(行);
  console.log("工具模块 " + 工具们.size + " 个；越界 " + 越界总数 + " 处");
}
