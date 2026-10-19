// 跑一次真的 shell 会话。
//
//   node examples/run-shell.mjs
//
// 它要一个真终端（raw 模式才能逐键到达）。在管道里跑会得到一句实话与退出码 1，
// 而不是装作跑完了——这一点与套件里那条断言一致。
//
// 这一层只做「接上」：把求值器的输出接到 stdout，把 main 换成真会话。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);

const rt = runUnit(loadUnit(path.join(ROOT, "shell-run.hmyr")));
rt.write = (s) => process.stdout.write(s);

process.stdout.write(ESC + "[?25l");           // 藏光标，别让它闪
try {
  process.exitCode = rt.callFunction(rt.functions.get("真会话"), [], null);
} finally {
  process.stdout.write(ESC + "[?25h" + ESC + "[0m");   // 无论如何都把光标与颜色收回来
  process.stdout.write("\n");
}
