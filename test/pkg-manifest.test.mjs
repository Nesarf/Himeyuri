// 包清单的形状（design/PKGMAN.txt）：装载器只验「能不能读、四项齐不齐、说不说得通」，
// 哈希的计算归 tools/hmkit-check.mjs —— 那要一个密码学库，而装载器至今只借文件与路径。
//
// 这一套验五件：
//   一、四项齐的清单：装得进去
//   二、没有清单：E0304
//   三、名字与目录不一致：E0304（而那句话说明为什么不能各说一套）
//   四、版本不是整数：E0304
//   五、清单的版本与入口的 rev 不一致：E0304
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-pkg-"));
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 行们 = (v) => v.join("\n") + "\n";
const 好哈希 = "sha256:" + "0".repeat(64);

// 造一个包根：根上有 hmyr.hmkit（那是「这里是一个包」的记号），
// 下面每个包一份自己的清单与入口。
const 造 = (名, 入口, 清单) => {
  const 根 = path.join(临, "根-" + 名);
  fs.mkdirSync(path.join(根, 名), { recursive: true });
  fs.writeFileSync(path.join(根, "hmyr.hmkit"), "[]", "utf8");
  fs.writeFileSync(path.join(根, 名, "index.hmoca"), 入口, "utf8");
  if (清单 !== null) fs.writeFileSync(path.join(根, 名, "hmyr.hmkit"), typeof 清单 === "string" ? 清单 : JSON.stringify(清单), "utf8");
  const 入口路 = path.join(根, "main.hmoca");
  fs.writeFileSync(入口路, 行们([
    "import \"" + 名 + "\"",
    "",
    "fn main() -> Int {",
    "  return 0",
    "}",
  ]), "utf8");
  return 入口路;
};

console.log("一、四项齐的清单：装得进去");
{
  const 入口 = 造("甲包", 行们(["fn 甲() -> Int {", "  return 1", "}"]),
    { 名字: "甲包", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 好哈希 });
  const 单 = loadUnit(入口);
  ok("没有 E0304", !单.diagnostics.errors.some((e) => e.code === "HMYR-E0304"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code)));
  ok("装得进去", 单.ok === true, JSON.stringify(单.ok));
}

console.log("二、没有清单");
{
  const 入口 = 造("乙包", 行们(["fn 乙() -> Int {", "  return 2", "}"]), null);
  const 单 = loadUnit(入口);
  ok("缺清单给 E0304", 单.diagnostics.errors.some((e) => e.code === "HMYR-E0304"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code)));
}

console.log("三、名字与目录不一致");
{
  const 入口 = 造("丙包", 行们(["fn 丙() -> Int {", "  return 3", "}"]),
    { 名字: "不是丙包", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 好哈希 });
  const 单 = loadUnit(入口);
  const 那句 = 单.diagnostics.errors.find((e) => e.code === "HMYR-E0304");
  ok("名字不一致给 E0304", !!那句, JSON.stringify(单.diagnostics.errors.map((e) => e.code)));
}

console.log("四、版本不是整数");
{
  const 入口 = 造("丁包", 行们(["fn 丁() -> Int {", "  return 4", "}"]),
    { 名字: "丁包", 版本: "一", 许可: "CZGD-PL-1.1", 哈希: 好哈希 });
  const 单 = loadUnit(入口);
  ok("版本不是整数给 E0304", 单.diagnostics.errors.some((e) => e.code === "HMYR-E0304"),
    JSON.stringify(单.diagnostics.errors.map((e) => e.code)));
}

console.log("五、清单的版本与入口的 rev 不一致");
{
  // 两处写同一件事看着冗余，但读者不同：清单给包管理看，rev 给装载器看。
  const 入口 = 造("戊包", 行们(["rev 2", "", "fn 戊() -> Int {", "  return 5", "}"]),
    { 名字: "戊包", 版本: 3, 许可: "CZGD-PL-1.1", 哈希: 好哈希 });
  const 单 = loadUnit(入口);
  const 那句 = 单.diagnostics.errors.find((e) => e.code === "HMYR-E0304" && /rev/.test(e.message));
  ok("两处不一致给 E0304", !!那句, JSON.stringify(单.diagnostics.errors.map((e) => e.message.slice(0, 50))));

  // 一致的：不该报。
  const 平 = 造("己包", 行们(["rev 3", "", "fn 己() -> Int {", "  return 6", "}"]),
    { 名字: "己包", 版本: 3, 许可: "CZGD-PL-1.1", 哈希: 好哈希 });
  const 单平 = loadUnit(平);
  ok("一致就不报", !单平.diagnostics.errors.some((e) => e.code === "HMYR-E0304"),
    JSON.stringify(单平.diagnostics.errors.map((e) => e.code)));
}

console.log("六、哈希那一半由工具算");
{
  // 装载器只验形状，哈希的计算归 tools/hmkit-check.mjs —— 那要一个密码学库，
  // 而装载器至今只借文件与路径两样能力。这一节验那个工具真的在算。
  const 根 = path.join(临, "哈希根");
  fs.mkdirSync(path.join(根, "庚包"), { recursive: true });
  fs.writeFileSync(path.join(根, "hmyr.hmkit"), "[]", "utf8");
  const 入口路 = path.join(根, "庚包", "index.hmoca");
  fs.writeFileSync(入口路, 行们(["fn 庚() -> Int {", "  return 7", "}"]), "utf8");
  const 真 = "sha256:" + createHash("sha256").update(fs.readFileSync(入口路)).digest("hex");
  const 工具 = path.join(ROOT, "tools", "hmkit-check.mjs");
  const 清单路 = path.join(根, "庚包", "hmyr.hmkit");

  fs.writeFileSync(清单路, JSON.stringify({ 名字: "庚包", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 真 }), "utf8");
  const 对 = spawnSync(process.execPath, [工具, "--all", 根], { encoding: "utf8" });
  ok("清单写对了工具通过", 对.status === 0, String(对.stdout || "").slice(0, 120));

  fs.writeFileSync(清单路, JSON.stringify({ 名字: "庚包", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: "sha256:" + "0".repeat(64) }), "utf8");
  const 错 = spawnSync(process.execPath, [工具, "--all", 根], { encoding: "utf8" });
  ok("清单对不上工具报错", 错.status !== 0 && String(错.stdout || "").includes("不通过"),
    JSON.stringify({ status: 错.status, out: String(错.stdout || "").slice(0, 120) }));
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
