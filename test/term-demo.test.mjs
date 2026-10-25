// demo 的验收：同一条路，两种用法——示例把帧写到终端，套件把帧收进缓冲。
//
// 所以「跑起来好看」与「每一帧可核对」并不冲突：它们只差 rt.write 接在哪里。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "term.hmoca")));
rt.registerModule(loadUnit(path.join(ROOT, "glyphs.hmoca")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 清空键 = () => { while (call("有键", [])) { call("取键", []); } };

console.log("六帧都画出来，而且标题按拍切换");
{
  清空键();
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  const 帧数 = call("demo", [[[0, "42"], [2, "2026"], [4, "42"]], 6]);
  ok("返回的帧数是 6", 帧数 === 6, String(帧数));
  const 帧们 = buffer.split(ESC + "[2J").filter((s) => s.length);
  ok("六处清屏，即六帧", 帧们.length === 6, String(帧们.length));
  ok("第 0 帧是「42」（4 的形状 # # 与 2 的形状 ###）", 帧们[0].includes("# #") && 帧们[0].includes("###"), JSON.stringify(帧们[0].slice(0, 40)));
  ok("第 2 帧起是「2026」（更多笔画）", (帧们[2].split("#").length - 1) > (帧们[1].split("#").length - 1),
    (帧们[2].split("#").length - 1) + " 对 " + (帧们[1].split("#").length - 1));
  ok("没有替换字符", !buffer.includes(String.fromCharCode(0xFFFD)));
}
{
  清空键();
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  call("demo", [[[0, "42"]], 3]);
  const 帧们 = buffer.split(ESC + "[2J").filter((s) => s.length);
  const 第一格 = 帧们[0].indexOf("*");
  const 第二格 = 帧们[1].indexOf("*");
  ok("点逐帧右移一格", 第二格 === 第一格 + 1, String(第一格) + " 再到 " + String(第二格));
}

console.log("按键让它提前收手");
{
  清空键();
  call("推键", ["q"]);
  let buffer = "";
  rt.write = (s) => { buffer += s; };
  const 帧数 = call("demo", [[[0, "42"]], 6]);
  ok("一帧都没画就停下", 帧数 === 0, String(帧数));
  ok("缓冲是空的", buffer === "", JSON.stringify(buffer.slice(0, 20)));
  清空键();
}

console.log("示例文件本身也是可解析的 Himeyuri");
{
  const unit = loadUnit(path.join(ROOT, "examples/demo.hmoca"));
  ok("examples/demo.hmoca 加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
