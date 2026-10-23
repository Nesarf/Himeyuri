// 运行时路径与工具链是两套东西：这一套钉住那条界线。
//
// design/SELFRUN.txt 的远读法有两种结清方式 —— 把工具搬进 HMYR，
// 或者证明它们不在「跑程序」这条路上。后一种可执行：
// 从入口顺着 import 走一遍，闭包里出现任何工具模块就红。
//
// 它不证明「工具没用」，只证明「跑程序不需要它们」。
// 两者不是一回事，而这一套说的只是后者。
import { 工具们, 闭包, 入口们 } from "../tools/runtime-path.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

console.log("一、工具清单里的文件都在");
{
  const 缺 = [...工具们].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  ok("清单里 " + 工具们.size + " 个文件都存在", 缺.length === 0, 缺.join(" "));
}

console.log("二、五个入口的闭包里没有工具模块");
{
  for (const 入口 of 入口们) {
    const 见 = 闭包(入口);
    const 越界 = [...见].filter((f) => 工具们.has(f)).sort();
    ok(入口 + " 的闭包（" + 见.size + " 个文件）干净", 越界.length === 0, 越界.join(" "));
  }
}

console.log("三、那份闭包确实算得动（不是空集）");
{
  // 没有这一条，一个坏掉的解析器会让上一条永远通过。
  const 见 = 闭包("bin/hmyr.mjs");
  ok("启动器闭包至少十个文件", 见.size >= 10, String(见.size));
  ok("闭包里有自举那条链的求值器", [...见].some((f) => f.includes("minimal-eval")), [...见].join(" "));
}

console.log("四、工具之间可以互相用，而运行时那条路不回头");
{
  // 反向的一句：核心求值器不该被工具反向接进来。
  const 见 = 闭包("src/format.mjs");
  const 反向 = [...见].filter((f) => f === "src/vm.mjs" || f === "bin/hmyr.mjs");
  ok("格式化器不接运行时的执行器", 反向.length === 0, 反向.join(" "));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
