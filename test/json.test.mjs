// JSON 解析器的验收：报告的结构化判定从此能在语言里做。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "json.hmyr")));
const 解析 = (s) => rt.callFunction(rt.functions.get("解析"), [s], null);
const probe = (s) => { const r = 解析(s); return { value: r[0], next: r[1] }; };

console.log("基本值：每种都带自己的 kind，不必猜");
ok("整数", probe("42").value.kind === "n" && probe("42").value.value === 42);
ok("负整数", probe("-7").value.value === -7, JSON.stringify(probe("-7").value));
ok("字符串", probe(String.fromCharCode(34) + "hello" + String.fromCharCode(34)).value.value === "hello");
ok("布尔真", probe("true").value.value === true);
ok("布尔假", probe("false").value.value === false);
ok("null 也是记录（不是带逗号的一元元组）", probe("null").value.kind === "null" && probe("null").value.value === undefined, JSON.stringify(probe("null").value));

console.log("复合值：数组是元组，对象是键值对的元组");
{
  const a = probe("[1, 2, 3]").value;
  ok("数组三项", a.kind === "a" && a.value.length === 3 && a.value[1].value === 2, JSON.stringify(a).slice(0, 60));
  const o = probe("{" + String.fromCharCode(34) + "a" + String.fromCharCode(34) + ": 1}").value;
  ok("对象一项，键是字符串", o.kind === "o" && o.value.length === 1 && o.value[0][0] === "a" && o.value[0][1].value === 1, JSON.stringify(o));
  const n = probe("{" + String.fromCharCode(34) + "x" + String.fromCharCode(34) + ": [{" + String.fromCharCode(34) + "y" + String.fromCharCode(34) + ": 2}]}").value;
  ok("嵌套：对象里是数组，数组里是对象", n.value[0][1].value[0].kind === "o" && n.value[0][1].value[0].value[0][1].value === 2, JSON.stringify(n).slice(0, 80));
}
console.log("空白与错处");
{
  ok("前后空白不影响结果", probe("  { " + String.fromCharCode(34) + "k" + String.fromCharCode(34) + " : " + String.fromCharCode(34) + "v" + String.fromCharCode(34) + " }  ").value.kind === "o");
  ok("写坏的文档给 err，不猜", probe("{").value.kind === "err", JSON.stringify(probe("{").value));
  ok("不认识的字符给 err", probe("@").value.kind === "err");
  ok("数组没有闭合给 err", probe("[1, 2").value.kind === "err");
}
console.log("拿一份真报告来读：颜色桥写过的那种形状");
{
  const 报告 = "{" + String.fromCharCode(34) + "engine" + String.fromCharCode(34) + ": {" + String.fromCharCode(34) + "pillow" + String.fromCharCode(34) + ": " + String.fromCharCode(34) + "12.3.0" + String.fromCharCode(34) + "}, " + String.fromCharCode(34) + "changed_fraction" + String.fromCharCode(34) + ": 0}";
  const v = probe(报告).value;
  ok("读出了两个顶层字段", v.kind === "o" && v.value.length === 2, JSON.stringify(v).slice(0, 80));
  ok("第一个字段里还嵌着一层对象", v.value[0][1].kind === "o" && v.value[0][1].value[0][1].value === "12.3.0");
}


console.log("生成：与 node 的 JSON.stringify 逐字节一致");
{
  const 取 = (名) => rt.functions.get(名);
  const 造 = (s) => rt.callFunction(取("解析"), [s], null)[0];
  const 紧凑 = (v) => rt.callFunction(取("生成"), [v], null);
  const 缩进 = (v) => rt.callFunction(取("生成二"), [v], null);
  const 样本 = [
    "42",
    String.fromCharCode(34) + "hi" + String.fromCharCode(34),
    "true",
    "null",
    "[]",
    "{}",
    "[1, 2, 3]",
    "{\"a\": 1}",
    "{\"a\": [true, false, null], \"b\": {\"c\": \"x\"}}",
  ];
  for (const 文 of 样本) {
    const v = 造(文);
    const 应 = JSON.stringify(JSON.parse(文));
    ok("紧凑 " + 文.slice(0, 24) + " 一致", 紧凑(v) === 应, JSON.stringify(紧凑(v)) + " 对 " + JSON.stringify(应));
    const 应二 = JSON.stringify(JSON.parse(文), null, 2);
    ok("缩进 " + 文.slice(0, 24) + " 一致", 缩进(v) === 应二, JSON.stringify(缩进(v).slice(0, 60)));
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
