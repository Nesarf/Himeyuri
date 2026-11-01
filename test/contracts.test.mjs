// 契约的强档：requires 与 ensures 在运行时查（design/CONTRACTS.txt）。
//
// 两条一起才说明 SPEC §2.4 那条硬条款是真的：三只旋钮只改检查强度、不改语义。
//   一、契约都成立的程序，开关两边跑出同样的输出。
//   二、契约不成立的程序，关档跑得过去（那是今天的样子），开档在第一条上停住。
// 只有前一条，说明检查没生效；只有后一条，说明检查会改变正常程序的行为。
import { run } from "../src/eval.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label + (detail ? "  " + detail : "")); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 码 = (r) => r.diagnostics.errors.map((e) => e.code);
const 话 = (r) => r.diagnostics.errors.map((e) => e.message);
const 跑 = (源, 开) => run(源, 开 ? { contracts: true } : {});

console.log("一、关档：写了契约也等于没写（今天的样子）");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 { return n }\nfn main() { print(str(取(0 - 5))) }\n";
  const r = 跑(源, false);
  ok("契约不成立也照样跑完", r.diagnostics.errors.length === 0, JSON.stringify(码(r)));
  ok("输出的就是那个坏值", r.output.join("") === "-5", JSON.stringify(r.output));
}

console.log("二、开档：requires 不成立");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 { return n }\nfn main() { print(str(取(0 - 5))) }\n";
  const r = 跑(源, true);
  ok("码是 HMYR-契-001", 码(r).includes("HMYR-契-001"), JSON.stringify(码(r)));
  ok("消息里有函数名与第几条", 话(r).some((m) => m.includes("取") && m.includes("第 1 条") && m.includes("requires")), JSON.stringify(话(r)));
  ok("没有跑出输出", r.output.length === 0, JSON.stringify(r.output));
}

console.log("三、开档：ensures 不成立");
{
  const 源 = "fn 取(n: Int) -> Int ensures 返回值 > 0 { return 0 - n }\nfn main() { print(str(取(1))) }\n";
  const r = 跑(源, true);
  ok("码是 HMYR-契-002", 码(r).includes("HMYR-契-002"), JSON.stringify(码(r)));
  ok("消息里带函数名与 ensures", 话(r).some((m) => m.includes("取") && m.includes("ensures")), JSON.stringify(话(r)));
}

console.log("四、硬条款：契约都成立时，开关两边同样");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 ensures 返回值 > 0 { return n * 2 }\nfn main() { print(str(取(3))) }\n";
  const 关 = 跑(源, false), 开 = 跑(源, true);
  ok("关档没有错", 关.diagnostics.errors.length === 0, JSON.stringify(码(关)));
  ok("开档也没有错", 开.diagnostics.errors.length === 0, JSON.stringify(码(开)));
  ok("两边输出一样", 关.output.join("") === 开.output.join(""), JSON.stringify([关.output, 开.output]));
  ok("输出是 6", 关.output.join("") === "6", JSON.stringify(关.output));
}

console.log("五、多条契约：报的是第一条不成立的");
{
  const 源 = "fn 取(n: Int) -> Int requires n > 0 requires n < 10 { return n }\nfn main() { print(str(取(50))) }\n";
  const r = 跑(源, true);
  ok("说的是第 2 条", 话(r).some((m) => m.includes("第 2 条")), JSON.stringify(话(r)));
}

console.log("六、ensures 同时看得见参数与返回值");
{
  const 源 = "fn 加(a: Int, b: Int) -> Int ensures 返回值 == a + b { return a + b }\nfn main() { print(str(加(2, 3))) }\n";
  const r = 跑(源, true);
  ok("两个名字都在、条件成立", r.diagnostics.errors.length === 0, JSON.stringify(码(r)));
  ok("输出是 5", r.output.join("") === "5", JSON.stringify(r.output));
}

console.log("七、契约条件自己出错：报的是那个错，不是契约错");
{
  const 源 = "fn 取(n: Int) -> Int requires 没有这个名字 > 0 { return n }\nfn main() { print(str(取(1))) }\n";
  const r = 跑(源, true);
  ok("报的是 HMYR-行-005", 码(r).includes("HMYR-行-005"), JSON.stringify(码(r)));
  ok("没有报成契约错", !码(r).some((c) => c.startsWith("HMYR-契")), JSON.stringify(码(r)));
}

console.log("八、没有契约的函数不受开关影响");
{
  const 源 = "fn 加(a: Int, b: Int) -> Int { return a + b }\nfn main() { print(str(加(2, 3))) }\n";
  const 关 = 跑(源, false), 开 = 跑(源, true);
  ok("两边都没有错", 关.diagnostics.errors.length === 0 && 开.diagnostics.errors.length === 0, JSON.stringify([码(关), 码(开)]));
  ok("两边输出一样且是 5", 关.output.join("") === 开.output.join("") && 关.output.join("") === "5", JSON.stringify([关.output, 开.output]));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
