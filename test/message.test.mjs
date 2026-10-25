// 邮箱的验收：有界、先进先出、满则拒绝、空则说空。
//
// 这四条是 design/CONCURRENCY.txt 里「通信靠消息」那一句的具体形状。
// 现在它是纯数据，将来换成真的通道时，这四条行为不该变——所以它们值得被钉住。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "message.hmoca"));
ok("邮箱那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("新建：空、不满");
{
  const 箱 = call("新邮箱", ["inbox", 2]);
  ok("名字对得上", call("名字", [箱]) === "inbox");
  ok("一开始是空的", call("长度", [箱]) === 0);
  ok("一开始不满", call("满", [箱]) === false);
  ok("容量零时一开始就满（有界的意思就是一条也放不进去）", call("满", [call("新邮箱", ["z", 0])]) === true);
}

console.log("发送：先进先出，满则拒绝");
{
  let 箱 = call("新邮箱", ["inbox", 2]);
  const 一 = call("发送", [箱, 10]);
  ok("第一个进去", 一.ok === true);
  箱 = 一.box;
  const 二 = call("发送", [箱, 20]);
  ok("第二个也进去", 二.ok === true);
  箱 = 二.box;
  ok("现在长度是二", call("长度", [箱]) === 2);
  const 三 = call("发送", [箱, 30]);
  ok("第三个被拒绝（有界）", 三.ok === false);
  ok("拒绝之后邮箱原样交回", call("长度", [三.box]) === 2, String(call("长度", [三.box])));
  ok("而且最旧的没被丢掉（不是覆盖式）", call("收取", [三.box]).value === 10, String(call("收取", [三.box]).value));
}

console.log("收取：先进先出，空则说空");
{
  let 箱 = call("新邮箱", ["inbox", 3]);
  箱 = call("发送", [箱, 1]).box;
  箱 = call("发送", [箱, 2]).box;
  const 甲 = call("收取", [箱]);
  ok("先取到的是最早进去的那个", 甲.got === true && 甲.value === 1, JSON.stringify(甲.value));
  const 乙 = call("收取", [甲.box]);
  ok("然后是第二个", 乙.value === 2, String(乙.value));
  const 丙 = call("收取", [乙.box]);
  ok("取空了就说空（不报错）", 丙.got === false);
  ok("空的时候长度是零", call("长度", [丙.box]) === 0);
  ok("空的时候再取还是空", call("收取", [丙.box]).got === false);
}

console.log("隔离：两个邮箱互不指涉");
{
  let 甲 = call("新邮箱", ["a", 2]);
  let 乙 = call("新邮箱", ["b", 2]);
  甲 = call("发送", [甲, 1]).box;
  乙 = call("发送", [乙, 9]).box;
  ok("各自只收到自己的那个", call("收取", [甲]).value === 1 && call("收取", [乙]).value === 9);
  ok("名字也没串", call("名字", [甲]) === "a" && call("名字", [乙]) === "b");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
