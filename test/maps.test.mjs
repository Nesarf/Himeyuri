// 集合库（map 与 set）的验收：同一串操作，HMYR 与宿主的 Map/Set 给同一个结果。
//
// 为什么对手是 Map/Set 而不是手写常数：手写常数等于把理解抄两遍，抄错就两边一起错。
// 而 Map/Set 是这两件东西最没有争议的定义 —— 键序、覆盖、删除、并交差，
// 宿主的实现已经把它们定死了。
//
// 这一份也是 2026-11-04 那次别名 bug 的判据：索引是引用（index_set 就地改），
// 所以「并」必须先把左边的拷一份。第八节那三行就是那件事的钉子。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 用 Map 与 Set 算同一个序列，按探针打印的顺序交回一张 名 → 值 的表。
const 期望 = () => {
  const 出 = {};
  const 表 = new Map();
  表.set("a", 1);
  表.set("b", 2);
  表.set("c", 3);
  出["表数"] = String(表.size);
  出["表键"] = [...表.keys()].join(",");
  表.set("b", 20);                       // 覆盖：位置不动
  出["覆盖后数"] = String(表.size);
  出["覆盖后键"] = [...表.keys()].join(",");
  出["覆盖后取b"] = String(表.get("b"));
  表.delete("b");                        // 删除
  出["删后数"] = String(表.size);
  出["删后键"] = [...表.keys()].join(",");
  出["删后有b"] = 表.has("b") ? "真" : "假";
  表.delete("zz");                       // 删不存在的不是失败
  出["删不存在的数"] = String(表.size);
  出["取无此键"] = 表.has("zz") ? "真" : "假";
  表.set("0041", 9);                     // 任意字符串当键
  表.set("data/ucd/Blocks.txt", 7);
  出["任意键数"] = String(表.size);
  出["码点键"] = String(表.get("0041"));
  出["路径键"] = String(表.get("data/ucd/Blocks.txt"));

  const 甲 = new Set(["x", "y", "z"]);
  出["集数"] = String(甲.size);
  甲.delete("y");
  出["去后数"] = String(甲.size);
  出["去后有y"] = 甲.has("y") ? "真" : "假";

  const 左 = new Set(["a", "b", "c"]);
  const 右 = new Set(["b", "c", "d"]);
  const 并 = new Set([...左, ...右]);
  const 交 = new Set([...左].filter((k) => 右.has(k)));
  const 差 = new Set([...左].filter((k) => !右.has(k)));
  出["并数"] = String(并.size);
  出["并键"] = [...并].join(",");
  出["交数"] = String(交.size);
  出["交键"] = [...交].join(",");
  出["差数"] = String(差.size);
  出["差键"] = [...差].join(",");

  // 别名：JS 的 Set 也是引用，所以「改了别名，原集也变」两边一致。
  const 原 = new Set(["k"]);
  const 别名 = 原;
  别名.add("m");
  出["别名后原数"] = String(原.size);
  const 独立 = new Set(原);
  独立.add("n");
  出["拷贝后原数"] = String(原.size);
  出["拷贝后独立数"] = String(独立.size);
  return 出;
};

// 跑探针，把 "名=值" 的行读成一张表。
const 跑探针 = () => {
  const r = spawnSync(process.execPath,
    [path.join(ROOT, "bin/hmyr.mjs"), "--compile", "conformance/maps.hmoca"],
    { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  const 出 = {};
  for (const 行 of String(r.stdout || "").split("\n")) {
    const m = /^([^=]+)=(.+)$/.exec(行.trim());
    if (m) 出[m[1]] = m[2];
  }
  return { 表: 出, 码: r.status, 错: String(r.stderr || "") };
};

console.log("一、探针跑得动");
const 实 = 跑探针();
ok("conformance/maps.hmoca 跑得动", 实.码 === 0, 实.错.slice(0, 160));

console.log("二、每一项都与 Map/Set 相同");
{
  const 应 = 期望();
  const 名们 = Object.keys(应);
  ok("两边的项数相同", Object.keys(实.表).length === 名们.length,
    Object.keys(实.表).length + " 对 " + 名们.length);
  for (const 名 of 名们) {
    ok(名 + " = " + 应[名], 实.表[名] === 应[名], "这边 " + (实.表[名] === undefined ? "没打出来" : 实.表[名]));
  }
}

console.log("三、别名那一节是真的在验引用语义");
{
  // 若哪天索引改成了「值到底」（每次 index_set 交回一份新的），这两条会红：
  // 别名后原数会变成 1。那时该改的是 INDEX.txt 与这一份，而不是让它绿着。
  ok("改了别名，原集也跟着变（索引是引用）", 实.表["别名后原数"] === "2", 实.表["别名后原数"]);
  ok("重建一份之后互不影响", 实.表["拷贝后原数"] === "2" && 实.表["拷贝后独立数"] === "3",
    (实.表["拷贝后原数"] || "?") + " / " + (实.表["拷贝后独立数"] || "?"));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
