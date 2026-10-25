// 命令行入口的验收：答案走一路，用法与失败走另一路。
//
// 这一套钉的不是「能不能跑」——那个 launcher 那套已经在钉了。
// 它钉的是这一步新引入的一条规矩：**两条通道不许混**。
//
// 理由是可验证的：把答案重定向出去（> out.txt）不该顺手把用法也塞进那个文件。
// 于是 stdout 里只该有答案，stderr 里只该有用法与诊断。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-cmd-"));
const 启动 = (args) => spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), ...args], { encoding: "utf8" });

const 写 = (名, 内容) => { const p = path.join(临, 名); fs.writeFileSync(p, 内容, "utf8"); return p; };

const 好程序 = 写("好.hmoca", "fn main() -> Int {\n  return 7 * 6\n}\n");

console.log("一、成功时：答案在 stdout，stderr 是空的");
{
  const r = 启动([好程序]);
  ok("退出码 0", r.status === 0, String(r.status));
  ok("stdout 就是答案", String(r.stdout).trim() === "42", JSON.stringify(String(r.stdout).trim()));
  ok("stderr 干干净净", String(r.stderr) === "", JSON.stringify(String(r.stderr).slice(0, 60)));
}

console.log("二、不带参数时：用法在 stderr，stdout 是空的");
{
  const r = 启动([]);
  ok("退出码 2", r.status === 2, String(r.status));
  ok("用法在 stderr", String(r.stderr).includes("用法"), JSON.stringify(String(r.stderr).slice(0, 40)));
  ok("stdout 干干净净", String(r.stdout) === "", JSON.stringify(String(r.stdout).slice(0, 40)));
}

console.log("三、目标不存在时：编号在 stderr，stdout 是空的");
{
  const r = 启动([path.join(临, "不存在.hmoca")]);
  ok("退出码 1", r.status === 1, String(r.status));
  ok("编号在 stderr", String(r.stderr).includes("HMYR-R0211"), JSON.stringify(String(r.stderr).slice(0, 60)));
  ok("stdout 干干净净", String(r.stdout) === "", JSON.stringify(String(r.stdout).slice(0, 40)));
}

console.log("四、两条通道真的分开（重定向时不会串味）");
{
  // 把 stdout 拿到文件里，stderr 单独接住——于是「串了没有」是能看见的。
  const 出 = path.join(临, "out.txt");
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), 好程序], { encoding: "utf8" });
  fs.writeFileSync(出, String(r.stdout), "utf8");
  const 内容 = fs.readFileSync(出, "utf8");
  ok("重定向出去的文件里只有答案", 内容.trim() === "42", JSON.stringify(内容.trim()));
  ok("里面没有「用法」", !内容.includes("用法"), JSON.stringify(内容.slice(0, 40)));
  ok("里面也没有编号", !内容.includes("HMYR-"), JSON.stringify(内容.slice(0, 40)));
}

console.log("五、import 进来的也照旧");
{
  const 库 = 写("库.hmoca", "fn triple(x: Int) -> Int {\n  return x * 3\n}\n");
  const 主 = 写("主.hmoca", 'import "./库.hmoca"\n\nfn main() -> Int {\n  return triple(14)\n}\n');
  const r = 启动([主]);
  ok("算得出 42", String(r.stdout).trim() === "42", JSON.stringify(String(r.stdout).trim()));
  ok("而 stderr 仍然干净", String(r.stderr) === "", JSON.stringify(String(r.stderr).slice(0, 40)));
}

console.log("六、参数位与解释器名（argv 的第 0 位是名字）");
{
  // 语言侧取 argv[1] 当目标，于是「目标」与「名字」在同一个元组里而不必换算。
  // 这一条只要它不把第 0 位当目标就够——真的当错了，上面每一条都会红。
  const r = 启动([好程序, "多出来的参数"]);
  ok("多一个参数也照样跑", String(r.stdout).trim() === "42", JSON.stringify(String(r.stdout).trim()));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
