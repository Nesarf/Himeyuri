// 跑示例：把 demo.hmyr 的 main 放进求值器，输出直接到终端。
//
// 与套件的区别只有一处：这里不替换 rt.write，于是帧真的写到 stdout；
// 套件那边替换成缓冲，于是同样的帧可以被断言。同一份代码，两种用法。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);

const rt = runUnit(loadUnit(path.join(ROOT, "term.hmoca")));
for (const name of ["glyphs.hmoca", "examples/demo.hmoca"]) {
  rt.registerModule(loadUnit(path.join(ROOT, name)).modules.values().next().value);
}

// 运行时的默认 write 并不写终端（那是 embed 与套件要的），所以这里显式接上 stdout。
rt.write = (s) => process.stdout.write(s);

process.stdout.write(ESC + "[?25l");           // 藏光标，别让它闪
try {
  rt.callFunction(rt.functions.get("main"), [], null);
} finally {
  process.stdout.write(ESC + "[?25h" + ESC + "[0m");   // 无论如何都把光标与颜色收回来
  process.stdout.write("\n");
}
