// 中日英三语：读、写、跑子进程三条边界。
// 今天的实测教训写在最上面：中文 Windows 的控制台按 GBK 输出，而运行时按 UTF-8 解码，
// 于是每个汉字都变成 U+FFFD。这份验收就是为了让那件事不再发生，而且可跑。
//
// 所有观察都由一个 Himeyuri 程序自己做、自己打印；宿主只读它打印的行并核对。
// 内置函数住在求值器的内置表里，所以「用语言自己的调用语法」是唯一诚实的到达方式。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const SCRATCH = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/hmyr-i18n-");
const p = (n) => path.join(SCRATCH, n).replace(/\\/g, "/");

/** 跑一个 Himeyuri 程序，把它打印的东西交回来 */
function run(source) {
  const diagnostics = { items: [], errors: [], warnings: [], add(s, c, m) { this.items.push({ s, c, m }); }, error(c, m) { this.add("error", c, m); }, warn(c, m) { this.add("warning", c, m); } };
  const { ast } = parse(lex(source, { diagnostics }).tokens, { diagnostics });
  const errs = diagnostics.items.filter((x) => x.s === "error");
  if (errs.length) throw new Error("解析失败：" + errs.map((x) => x.c + " " + x.m).join(" | "));
  const rt = new Runtime({});
  let out = "";
  rt.write = (s) => { out += s; };
  rt.run(ast);
  return out;
}

try {
  // 样本按字节写死：「你好」的 GBK 是 C4 E3 BA C3，「あい」的 Shift_JIS 是 82 A0 82 A2。
  // 这台运行时解得开它们却编不出来，所以只能这样造样本。
  fs.writeFileSync(p("zh-gbk.txt"), Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0x0a]));
  fs.writeFileSync(p("ja-sjis.txt"), Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x0a]));

  const out = run(`fn say(t: String) -> Int {
  // print 不自己加换行——它就是「写出这些字符」。所以每个观察自己带上换行。
  print(t + "\\n")
  return 0
}

fn main() -> Int effects(file, process) {
  say("zh-gbk:" + read_text(${JSON.stringify(p("zh-gbk.txt"))}, "gbk"))
  say("zh-auto-len:" + str(len(read_text(${JSON.stringify(p("zh-gbk.txt"))}))))
  say("ja-sjis:" + read_text(${JSON.stringify(p("ja-sjis.txt"))}, "shift_jis"))
  say("write-ok:" + str(write_text(${JSON.stringify(p("en-utf8.txt"))}, "hello 你好 こんにちは")))
  say("split:" + str(len(split("一\\n二\\n三", "\\n"))))
  say("codepage:" + console_codepage())
  let r = run_program("cmd", ("/c", "echo 你好，世界"), 8000, "gbk")
  say("proc-gbk:" + str(r.code) + "|" + r.stdout)
  let r2 = run_program("cmd", ("/c", "echo 你好，世界"), 8000)
  say("proc-utf8:" + str(r2.code) + "|" + str(len(r2.stdout)))
  return 0
}
`);
  const lines = out.split("\n").filter((l) => l.length);
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(key + ":"));
    return line === undefined ? null : line.slice(key.length + 1);
  };

  console.log("中文：GBK 解出来要是中文");
  ok("按 GBK 读文件读出了「你好」", get("zh-gbk") === "你好", JSON.stringify(get("zh-gbk")));
  ok("不说编码时按 UTF-8 读，于是它就坏了（这正是必须声明编码的理由）", get("zh-auto-len") !== "3", "长度为 " + get("zh-auto-len"));

  console.log("\n日文：Shift_JIS 同理");
  ok("按 Shift_JIS 读出了「あい」", get("ja-sjis") === "あい", JSON.stringify(get("ja-sjis")));

  console.log("\n写：UTF-8 要对得上字节");
  {
    ok("写文件成功并回报字符数", /^\d+$/.test(String(get("write-ok"))), String(get("write-ok")));
    const bytes = fs.readFileSync(p("en-utf8.txt"));
    ok("以 ASCII 开头", bytes.subarray(0, 5).toString("latin1") === "hello");
    ok("中文部分是正确的 UTF-8（你 = E4 BD A0）", bytes.includes(Buffer.from([0xe4, 0xbd, 0xa0])));
    ok("日文部分是正确的 UTF-8（こ = E3 81 93）", bytes.includes(Buffer.from([0xe3, 0x81, 0x93])));
  }

  console.log("\n写 GBK：现在写得出来，字节要对得上");
  {
    const outGbk = p("zh-gbk-out.txt");
    run(`fn main() -> Int effects(file) {
  write_text(${JSON.stringify(outGbk)}, "你好，世界", "gbk")
  return 0
}
`);
    const bytes = fs.readFileSync(outGbk);
    const want = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7]);
    ok("写出的字节就是 GBK 的「你好，世界」", bytes.equals(want), bytes.toString("hex"));
  }
  {
    // 一个扩展 B 的汉字：它不在 GBK 里，也不是 emoji，正好用来验「表里没有就拒绝」
    const outside = p("outside.txt");
    const ch = String.fromCodePoint(0x20000);
    let raised = null;
    try {
      run(`fn main() -> Int effects(file) {
  write_text(${JSON.stringify(outside)}, "字${ch}字", "gbk")
  return 0
}
`);
    } catch (e) { raised = (e.code || "") + " " + e.message; }
    ok("表里没有的字符被拒绝，编号 HMYR-內-004", !!raised && raised.includes("HMYR-內-004"), String(raised));
    ok("而且没有留下半截文件", !fs.existsSync(outside));
  }
  {
    // big5 与 shift_jis 现在都有表了，所以换一个真的没有表的编码来验这条。
    const noTable = p("no-table.txt");
    let raised = null;
    try {
      run(`fn main() -> Int effects(file) {
  write_text(${JSON.stringify(noTable)}, "x", "iso2022_jp")
  return 0
}
`);
    } catch (e) { raised = (e.code || "") + " " + e.message; }
    ok("没有表的编码（iso2022_jp）被拒绝，编号 HMYR-內-003", !!raised && raised.includes("HMYR-內-003"), String(raised));
  }

  console.log("\n有了表的编码就能写：日本语与繁体中文");
  {
    const 日 = p("ja-sjis-out.txt");
    run(`fn main() -> Int effects(file) {
  write_text(${JSON.stringify(日)}, "こんにちは", "shift_jis")
  return 0
}
`);
    const 字节 = fs.readFileSync(日);
    ok("写出的 Shift_JIS 能解码回原文", new TextDecoder("shift_jis").decode(字节) === "こんにちは", 字节.toString("hex"));
    const 繁 = p("zh-big5-out.txt");
    run(`fn main() -> Int effects(file) {
  write_text(${JSON.stringify(繁)}, "繁體中文", "big5")
  return 0
}
`);
    ok("写出的 Big5 能解码回原文", new TextDecoder("big5").decode(fs.readFileSync(繁)) === "繁體中文");
  }

console.log("\n不认识的编码名：拒绝，并点名编号");
  {
    let raised = null;
    try {
      run(`fn main() -> Int effects(file) {
  read_text(${JSON.stringify(p("zh-gbk.txt"))}, "no-such-encoding")
  return 0
}
`);
    } catch (e) { raised = (e.code || "") + " " + e.message; }
    ok("被拒绝，编号是 HMYR-詞-008", !!raised && raised.includes("HMYR-詞-008"), String(raised));
  }

  console.log("\n切行与代码页");
  ok("split 切出三行", get("split") === "3", String(get("split")));
  {
    const cp = get("codepage");
    ok("console_codepage 给出一个值", !!cp && cp.length > 0, String(cp));
    console.log("        （本机控制台代码页：" + cp + "）");
  }

  console.log("\n子进程：今天那个乱码案例");
  ok("按 GBK 解码子进程输出，得到那五个字", get("proc-gbk") === "0|你好，世界", JSON.stringify(get("proc-gbk")));
  ok("不说编码时按 UTF-8 解，于是它就坏了", !String(get("proc-utf8")).includes("你好，世界"), JSON.stringify(get("proc-utf8")));
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
