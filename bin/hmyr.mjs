// HMYR 的启动器：把自举那一层读进来，然后让它自己当程序。
//
//   node bin/hmyr.mjs <file.hmyr>
//
// 它现在只剩三件事，而三件都是「宿主才知道」的：
//
//   一、把自举那一层读进来（它自己是 .hmyr，而读它需要宿主的词法与求值器）
//   二、把命令行参数递过去（argv 从哪来是宿主的事）
//   三、按语言交回的退出码退出（进程怎么退是宿主的事）
//
// 以前它还有「拆路径」「读目标」「认 import」「定退出码」，四件都搬进了 self/run.hmyr。
// 那四件里没有一件是关于宿主的——它们都是「一门语言怎么当程序用」。
//
// 剩下这一件的下一步是第三步的后半：连「读自举那一层」也由自举自己做。
// 那需要一门语言能编译它自己，而那是另一件事，不假装它已经成立。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 层 = loadUnit(path.join(ROOT, "self/run.hmyr"));
if (!层.ok) {
  // 自举那一层自己都读不进来，就没有语言可用来说这件事。宿主只好开口。
  process.stderr.write("HMYR-R0211 cannot load self/run.hmyr\n");
  for (const e of 层.diagnostics.errors) process.stderr.write("  " + e.code + " " + e.message + "\n");
  process.exit(1);
}

const rt = runUnit(层);
rt.write = (s) => process.stdout.write(s);
rt.writeErr = (s) => process.stderr.write(s);
// 与宿主一致：第一个是「解释器名」位，之后才是参数。语言侧取 argv[1] 当目标。
rt.argv = process.argv.slice(1);

process.exit(rt.callFunction(rt.functions.get("命令行入口"), [], null));
