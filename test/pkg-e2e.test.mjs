// 端到端：装一个包，然后用 引入 把它装进来跑通；卸掉之后，装载器要报它不在了。
//
// 为什么要有这一份：装（tools/hmget.mjs）与解析包名（src/loader.mjs 的 找包根、
// 读包清单、resolveImport）各有自己的判据，但**没有一条把两层接起来** ——
// test/hmget.test.mjs 里一次都没有跑过 node bin/hmyr.mjs。
// 于是「包装到位」与「程序能用它」之间那条缝，谁也没看过。
//
// 这一份就是那条缝：一件包从磁盘上的一个目录，走到一份源码能 import 它、跑出结果，
// 再走到卸载之后装载器说它没了。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-pkge2e-"));
const 源 = path.join(临, "源");
const 根 = path.join(临, "根");
const 工具 = path.join(ROOT, "tools", "hmget.mjs");
const 算 = (路) => "sha256:" + createHash("sha256").update(fs.readFileSync(路)).digest("hex");
const 名字 = "丙包";

// 造一个来源里的包：一份 index.hmoca 加一份清单（哈希按真文件算）。
{
  const 目录 = path.join(源, 名字);
  fs.mkdirSync(目录, { recursive: true });
  fs.writeFileSync(path.join(源, "hmyr.hmkit"), "[]", "utf8");
  const 入口 = path.join(目录, "index.hmoca");
  fs.writeFileSync(入口, "公开 函数 丙加(x: Int) -> Int {\n  返回 x + 1\n}\n", "utf8");
  fs.writeFileSync(path.join(目录, "hmyr.hmkit"),
    JSON.stringify({ 名字, 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 算(入口) }), "utf8");
}

const 取 = (参) => spawnSync(process.execPath, [工具, ...参], { encoding: "utf8", timeout: 120000 });
const 跑源码 = (路) => spawnSync(process.execPath, [path.join(ROOT, "bin", "hmyr.mjs"), 路],
  { encoding: "utf8", timeout: 300000, cwd: ROOT });

console.log("一、装进来");
{
  const r = 取(["--from", 源, "--into", 根, 名字]);
  ok("hmget 退出码 0", r.status === 0, String(r.stderr || "").slice(0, 160));
  ok("包落在包根里", fs.existsSync(path.join(根, 名字, "index.hmoca")), "");
  ok("包根有了记号", fs.existsSync(path.join(根, "hmyr.hmkit")), "");
}

// 用包的源码放在包根里 —— 装载器是从源文件往上找「最外层含 hmyr.hmkit 的目录」，
// 所以它必须在这个根之下，而不是在临时目录的别处。
const 用包 = path.join(根, "用包.hmoca");
fs.writeFileSync(用包, '引入 "' + 名字 + '"\n\n函数 main() -> Int {\n  print(str(丙加(41)) + chr(10))\n  返回 0\n}\n', "utf8");

console.log("二、装载器找得到它，而且它能跑");
{
  const r = 跑源码(用包);
  ok("跑得动", r.status === 0, String(r.stderr || "").slice(0, 200));
  // 默认路径（自举层解释）会把 main 的返回值也打出来，所以 stdout 是两行：
  // 第一行是程序打的 42，第二行是那个 0。判据看第一行。
  const 首行 = (String(r.stdout || "").split("\n")[0] || "").trim();
  ok("打出 42（包里的函数真的被调到了）", 首行 === "42", JSON.stringify(首行));
}

console.log("三、卸掉之后，装载器要说它不在了");
{
  const r = 取(["--remove", "--into", 根, 名字]);
  ok("hmget --remove 退出码 0", r.status === 0, String(r.stderr || "").slice(0, 160));
  ok("目录没了", !fs.existsSync(path.join(根, 名字)), "");
  const r2 = 跑源码(用包);
  ok("再跑就失败", r2.status !== 0, String(r2.status));
  // 报哪个码不重要 —— 重要的是「包不见了」这件事被说出来，而不是静默跑出别的东西。
  const 话 = String(r2.stderr || "") + String(r2.stdout || "");
  ok("并且说得出缺的是哪个包", 话.includes("丙包"), 话.slice(0, 200));
}

fs.rmSync(临, { recursive: true, force: true });

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
