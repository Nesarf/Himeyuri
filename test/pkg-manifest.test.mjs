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

console.log("七、依赖：缺包与版本不够各有一个编号");
{
  // 依赖只写「最低版本」（design/PKGMAN.txt 第三节）：rev 的语义是向下兼容，
  // 所以「我要至少 M」可判，而一个区间要第二套版本语言。
  const 根 = path.join(临, "依赖根");
  const 造包 = (名, 版本, 依赖) => {
    const 目录 = path.join(根, 名);
    fs.mkdirSync(目录, { recursive: true });
    fs.writeFileSync(path.join(根, "hmyr.hmkit"), "[]", "utf8");
    fs.writeFileSync(path.join(目录, "index.hmoca"), "pub fn " + 名 + "() -> Int {\n  return " + 版本 + "\n}\n", "utf8");
    const 清单 = { 名字: 名, 版本, 许可: "CZGD-PL-1.1", 哈希: 好哈希 };
    if (依赖) 清单.依赖 = 依赖;
    fs.writeFileSync(path.join(目录, "hmyr.hmkit"), JSON.stringify(清单), "utf8");
  };
  const 入口 = (名) => {
    const p = path.join(根, "用" + 名 + ".hmoca");
    fs.writeFileSync(p, 行们(["import \"" + 名 + "\"", "", "fn main() -> Int {", "  return 0", "}"]), "utf8");
    return p;
  };

  // 一、依赖满足：不报。
  造包("小库", 2, null);
  造包("用家", 1, { 小库: 2 });
  ok("依赖满足就不报", !loadUnit(入口("用家")).diagnostics.errors.some((e) => e.code === "HMYR-E0305" || e.code === "HMYR-E0306"),
    JSON.stringify(loadUnit(入口("用家")).diagnostics.errors.map((e) => e.code)));

  // 二、缺包：E0305。
  造包("缺家", 1, { 不存在的包: 1 });
  const 缺 = loadUnit(入口("缺家"));
  ok("缺包给 E0305", 缺.diagnostics.errors.some((e) => e.code === "HMYR-E0305"),
    JSON.stringify(缺.diagnostics.errors.map((e) => e.code)));

  // 三、版本不够：E0306。
  造包("高家", 1, { 小库: 9 });
  const 高 = loadUnit(入口("高家"));
  ok("版本不够给 E0306", 高.diagnostics.errors.some((e) => e.code === "HMYR-E0306"),
    JSON.stringify(高.diagnostics.errors.map((e) => e.code)));

  // 四、只写依赖不写依赖哈希：一声提示，不是错（哈希链那一半归工具）。
  const 只依 = { 名字: "裸家", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 好哈希, 依赖: { 小库: 1 } };
  fs.mkdirSync(path.join(根, "裸家"), { recursive: true });
  fs.writeFileSync(path.join(根, "裸家", "index.hmoca"), "pub fn 裸家() -> Int {\n  return 1\n}\n", "utf8");
  fs.writeFileSync(path.join(根, "裸家", "hmyr.hmkit"), JSON.stringify(只依), "utf8");
  const 裸 = loadUnit(入口("裸家"));
  ok("写了依赖没写依赖哈希：提示 W0305", 裸.diagnostics.warnings.some((w) => w.code === "HMYR-W0305"),
    JSON.stringify(裸.diagnostics.warnings.map((w) => w.code)));
}

console.log("八、哈希链：被依赖的包有没有被换过");
{
  // 本包清单里记下被依赖包入口的 sha256（design/PKGMAN.txt 第二节）。
  // 它挡的是「换了一个包」，挡不住「换的人同时改了清单」—— 那要签名。
  const 根 = path.join(临, "链根");
  fs.mkdirSync(path.join(根, "小库"), { recursive: true });
  fs.writeFileSync(path.join(根, "hmyr.hmkit"), "[]", "utf8");
  const 小库入口 = path.join(根, "小库", "index.hmoca");
  fs.writeFileSync(小库入口, "pub fn 小库() -> Int {\n  return 2\n}\n", "utf8");
  const 算 = (路) => "sha256:" + createHash("sha256").update(fs.readFileSync(路)).digest("hex");
  fs.writeFileSync(path.join(根, "小库", "hmyr.hmkit"),
    JSON.stringify({ 名字: "小库", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 算(小库入口) }), "utf8");

  const 小库哈希 = () => 算(小库入口);
  fs.mkdirSync(path.join(根, "用家"), { recursive: true });
  const 用家入口 = path.join(根, "用家", "index.hmoca");
  fs.writeFileSync(用家入口, "pub fn 用家() -> Int {\n  return 1\n}\n", "utf8");
  const 用家清单 = (哈希) => ({ 名字: "用家", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 算(用家入口), 依赖: { 小库: 1 }, 依赖哈希: { 小库: 哈希 } });
  fs.writeFileSync(path.join(根, "用家", "hmyr.hmkit"), JSON.stringify(用家清单(小库哈希())), "utf8");

  const 工具 = path.join(ROOT, "tools", "hmkit-check.mjs");
  const 对 = spawnSync(process.execPath, [工具, "--all", 根], { encoding: "utf8" });
  ok("链对得上：工具通过", 对.status === 0, String(对.stdout || "").slice(0, 160));

  // 换掉被依赖的那个包 —— 而用家的清单还记着旧的哈希。
  fs.writeFileSync(小库入口, "pub fn 小库() -> Int {\n  return 999\n}\n", "utf8");
  const 换 = spawnSync(process.execPath, [工具, "--all", 根], { encoding: "utf8" });
  ok("被依赖的包被换过：工具报错", 换.status !== 0 && String(换.stdout || "").includes("它被换过"),
    JSON.stringify({ status: 换.status, out: String(换.stdout || "").slice(0, 200) }));
}

console.log("九、签名：谁担保它是");
{
  // 哈希链挡「换了一个包」，签名挡「换的人同时改了清单」。
  // 签的是「去掉签名字段之后的规范化字节」—— 那四条规则写在 design/PKGMAN.txt 第五节。
  const { generateKeyPairSync, sign, createPublicKey, createHash: 算2 } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const 公钥hex = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("hex");

  const 根 = path.join(临, "签根");
  fs.mkdirSync(path.join(根, "签包"), { recursive: true });
  fs.writeFileSync(path.join(根, "hmyr.hmkit"), "[]", "utf8");
  fs.writeFileSync(path.join(根, "hmyr.hmtrust"), JSON.stringify({ 签包: 公钥hex }), "utf8");
  const 入口路 = path.join(根, "签包", "index.hmoca");
  fs.writeFileSync(入口路, "pub fn 签包() -> Int {\n  return 1\n}\n", "utf8");
  const 入口哈希 = "sha256:" + 算2("sha256").update(fs.readFileSync(入口路)).digest("hex");
  // 装载层的判据要一个真的入口去 import 那个包 —— 工具那两条不需要它。
  const 用签 = path.join(根, "用签.hmoca");
  fs.writeFileSync(用签, 行们(["import \"签包\"", "", "fn main() -> Int {", "  return 0", "}"]), "utf8");

  // 与工具里那条规范化同一套规则（四条：去签名、键排序、无空格、UTF-8）。
  const 规范化 = (清单) => {
    const 去 = { ...清单 };
    delete 去.签名;
    const 排 = (v) => {
      if (Array.isArray(v)) return v.map(排);
      if (v && typeof v === "object") {
        const 出 = {};
        for (const k of Object.keys(v).sort()) 出[k] = 排(v[k]);
        return 出;
      }
      return v;
    };
    return Buffer.from(JSON.stringify(排(去)), "utf8");
  };
  const 造清单 = (改) => {
    const 清单 = { 名字: "签包", 版本: 1, 许可: "CZGD-PL-1.1", 哈希: 入口哈希 };
    if (改) 改(清单);
    return 清单;
  };

  const 工具 = path.join(ROOT, "tools", "hmkit-check.mjs");
  const 清单路 = path.join(根, "签包", "hmyr.hmkit");

  // 一、签对了：工具通过。
  {
    const 清单 = 造清单();
    const 值 = sign(null, 规范化(清单), privateKey).toString("hex");
    清单.签名 = { 包: "签包", 算法: "ed25519", 值 };
    fs.writeFileSync(清单路, JSON.stringify(清单), "utf8");
    const 单 = loadUnit(path.join(根, "用签.hmoca"));
    const 形 = spawnSync(process.execPath, [工具, "--all", 根], { encoding: "utf8" });
    ok("清单形状过", !单.diagnostics.errors.some((e) => e.code === "HMYR-E0304" || e.code === "HMYR-E0307"),
      JSON.stringify(单.diagnostics.errors.map((e) => e.code)));
    ok("签名验过", 形.status === 0, String(形.stdout || "").slice(0, 200));
  }

  // 二、清单被改过：签名对不上。
  {
    const 清单 = 造清单();
    const 值 = sign(null, 规范化(清单), privateKey).toString("hex");
    清单.签名 = { 包: "签包", 算法: "ed25519", 值 };
    清单.许可 = "改过的许可";
    fs.writeFileSync(清单路, JSON.stringify(清单), "utf8");
    const 形 = spawnSync(process.execPath, [工具, "--all", 根], { encoding: "utf8" });
    ok("清单被改过：签名报错", 形.status !== 0 && String(形.stdout || "").includes("签名对不上"),
      String(形.stdout || "").slice(0, 200));
  }

  // 三、可信表里没有这个包的公钥：E0307。
  {
    fs.writeFileSync(path.join(根, "hmyr.hmtrust"), JSON.stringify({ 别的包: 公钥hex }), "utf8");
    const 清单 = 造清单();
    const 值 = sign(null, 规范化(清单), privateKey).toString("hex");
    清单.签名 = { 包: "签包", 算法: "ed25519", 值 };
    fs.writeFileSync(清单路, JSON.stringify(清单), "utf8");
    const 单 = loadUnit(path.join(根, "用签.hmoca"));
    ok("公钥不在可信表：E0307", 单.diagnostics.errors.some((e) => e.code === "HMYR-E0307"),
      JSON.stringify(单.diagnostics.errors.map((e) => e.code)));
  }
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
