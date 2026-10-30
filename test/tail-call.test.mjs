// 尾调用的验收：尾递归不再吃宿主栈，而别的性质一样都不能变。
//
// 这一套钉五件事：
//   一、尾递归能跑到十万层，而算出来的数对
//   二、非尾递归的深度没有变（它本来就不该被优化）
//   三、普通调用照旧
//   四、尾调用不能绕过效果检查
//   五、参数个数不对仍然报错
import { run } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (源) => {
  const r = run(源, { maxDepth: 1000000000 });
  const 坏 = r.diagnostics.items.filter((x) => (x.severity || "") === "error");
  return 坏.length ? { err: 坏[0].code } : { value: r.value };
};
const 尾 = (n) => "fn f(n: Int, acc: Int) -> Int {\n  if n == 0 {\n    return acc\n  }\n  return f(n - 1, acc + n)\n}\nfn main() -> Int {\n  return f(" + n + ", 0)\n}\n";
const 非尾 = (n) => "fn d(n: Int) -> Int {\n  if n == 0 {\n    return 0\n  }\n  return 1 + d(n - 1)\n}\nfn main() -> Int {\n  return d(" + n + ")\n}\n";

console.log("一、尾递归：深度不再吃宿主栈");
{
  ok("尾递归一千层给 500500", 跑(尾(1000)).value === 500500, JSON.stringify(跑(尾(1000))));
  ok("尾递归十万层给 5000050000", 跑(尾(100000)).value === 5000050000, JSON.stringify(跑(尾(100000))));
  // 五十万层撞的该是「步数」而不是「深度」——那说明栈那一层真的不再随深度增长了。
  // 默认五百万步下跑不完五十万层，那是步数的账，不是栈的账。
  const 深 = 跑(尾(500000));
  ok("尾递归五十万层撞的是步数而不是深度", 深.err === "HMYR-行-003", JSON.stringify(深));
}

console.log("二、非尾递归：深度限制没有变");
{
  ok("非尾递归一百层仍对（100）", 跑(非尾(100)).value === 100, JSON.stringify(跑(非尾(100))));
  // 五千层在旧版与新版都该撞深度——尾调用优化只对尾位置成立，而这里不是。
  const 深 = 跑(非尾(5000));
  ok("非尾递归五千层仍撞深度", 深.err === "HMYR-行-009", JSON.stringify(深));
}

console.log("三、普通调用与参数检查照旧");
{
  const 加 = "fn add(a: Int, b: Int) -> Int {\n  return a + b\n}\nfn main() -> Int {\n  return add(20, 22)\n}\n";
  ok("两个参数的调用给 42", 跑(加).value === 42, JSON.stringify(跑(加)));
  const 少 = "fn f(a: Int, b: Int) -> Int {\n  return a\n}\nfn main() -> Int {\n  return f(1)\n}\n";
  ok("参数少了仍报 HMYR-行-002", 跑(少).err === "HMYR-行-002", JSON.stringify(跑(少)));
}

console.log("四、尾调用不能绕过效果检查");
{
  // print 要 process 效果。这一条是尾位置上的调用，而它必须仍然被检查。
  const 尾要效果 = "fn shout() -> Int effects(process) {\n  print(\"hi\")\n  return 0\n}\nfn main() -> Int {\n  return shout()\n}\n";
  const r = 跑(尾要效果);
  ok("没声明效果时仍然拒绝（HMYR-內-001）", r.err === "HMYR-內-001", JSON.stringify(r));
  const 声明了 = "fn shout() -> Int effects(process) {\n  print(\"hi\")\n  return 0\n}\nfn main() -> Int effects(process) {\n  return shout()\n}\n";
  ok("声明了效果时跑得动", typeof 跑(声明了).value === "number", JSON.stringify(跑(声明了)));
}

console.log("五、尾调用的结果是真的结果（不是标记漏出来）");
{
  // 若 TailCall 漏到外面，值会变成一个对象而不是数。
  const r = 跑(尾(10));
  ok("值是数而不是对象", typeof r.value === "number", JSON.stringify(r.value));
  ok("而它的值是对的（55）", r.value === 55, String(r.value));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
