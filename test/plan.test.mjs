// 规划是数据，数据要能被核对。
//
// design/PLAN.json 记的是这个工程要去哪儿：每条目标带状态、出处、父目标、先后、动哪些文件、
// 哪些套件验它。它是 2026-11-08 第一次写下来的，而写下来的东西没有判据就会漂 ——
// design/BOOTSTRAP.txt 那一行合计漂了近一千行才被人看见，这个教训刚记过。
//
// 所以这一套只做一件事：把那份文件按它自己的形状核一遍。指向不存在的测试、目录或父目标，
// 在这里红，而不是等到有人照着它排计划的时候才发现。
//
// 它不去验证那条目标「对不对」—— 那是人的判断。它验证的是「这条记录自洽吗」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 路 = path.join(ROOT, "design/PLAN.json");
const 允许scope = new Set(["project", "principle", "stage", "task"]);
const 允许status = new Set(["done", "active", "open", "blocked", "dropped"]);

// 同一套检查跑两遍：一次对着真文件，一次对着改坏的文本。抽成函数是为了让反向那一节
// 验的确实是这一段逻辑，而不是另写一段差不多的东西。
const 核 = (表) => {
  const 目标们 = Array.isArray(表 && 表.goals) ? 表.goals : [];
  const ids = 目标们.map((g) => String(g.id || ""));
  const 缺形状 = 目标们.filter((g) => !g.id || !g.title || !允许scope.has(String(g.scope)) || !允许status.has(String(g.status)));
  const 悬空父 = 目标们.filter((g) => g.parent && !ids.includes(String(g.parent))).map((g) => g.id + " -> " + g.parent);
  const 悬空先后 = [];
  for (const g of 目标们) for (const a of (g.after || [])) if (!ids.includes(String(a))) 悬空先后.push(g.id + " -> " + a);
  const 缺测 = [];
  for (const g of 目标们) for (const t of (g.verifiedBy || [])) if (!fs.existsSync(path.join(ROOT, t))) 缺测.push(g.id + " -> " + t);
  const 缺路 = [];
  for (const g of 目标们) for (const p of (g.touches || [])) if (!fs.existsSync(path.join(ROOT, p))) 缺路.push(g.id + " -> " + p);
  return { 目标们, ids, 缺形状, 悬空父, 悬空先后, 缺测, 缺路 };
};

console.log("一、文件在，而且是能读的数据");
{
  ok("design/PLAN.json 在", fs.existsSync(路), 路);
  let 表 = null;
  let 错 = "";
  try {
    表 = JSON.parse(fs.readFileSync(路, "utf8"));
  } catch (e) {
    错 = String((e && e.message) || e);
  }
  ok("能解析成 JSON", 表 !== null, 错);

  if (表 !== null) {
    console.log("二、每条记录都自洽");
    const r = 核(表);
    ok("goals 是非空数组", r.目标们.length > 0, String(r.目标们.length));
    ok("每条都有 id、title、合法 scope 与 status", r.缺形状.length === 0, r.缺形状.map((g) => String(g.id)).join(", "));
    ok("id 互不重复", new Set(r.ids).size === r.ids.length, r.ids.length + " 个 id，" + new Set(r.ids).size + " 个不同");
    ok("每个 parent 指向存在的目标", r.悬空父.length === 0, r.悬空父.join(", "));
    ok("每个 after 指向存在的目标", r.悬空先后.length === 0, r.悬空先后.join(", "));
    ok("每个 verifiedBy 的文件都在", r.缺测.length === 0, r.缺测.join(", "));
    ok("每个 touches 的路径都在", r.缺路.length === 0, r.缺路.join(", "));

    // 没有判据的目标是允许的（OS 还不存在，就没有东西能验它），但要说清为什么 ——
    // 否则一条空着 verifiedBy 的记录读起来像是忘了填。
    const 空 = r.目标们.filter((g) => (g.verifiedBy || []).length === 0);
    ok("没有判据的那些，都在 notes 里说明了原因",
     空.every((g) => typeof g.notes === "string" && g.notes.trim().length > 0),
     空.map((g) => String(g.id)).join(", "));

    // 一条目标至少要说它动哪儿，不然它在网络上就是一个孤点。
    const 孤点 = r.目标们.filter((g) => (g.touches || []).length === 0).map((g) => String(g.id));
    ok("每条目标都至少连着一个路径", 孤点.length === 0, 孤点.join(", "));

    const 有状态 = Object.fromEntries([...允许status].map((s) => [s, r.目标们.filter((g) => g.status === s).length]));
    console.log("    （" + r.目标们.length + " 条目标：" + Object.entries(有状态).filter(([, n]) => n > 0).map(([s, n]) => s + " " + n).join(" · ") + "）");
  }
}

console.log("三、反向：把一条 verifiedBy 改成不存在的文件，第二、三节必须不成立");
{
  const 原 = fs.readFileSync(路, "utf8");
  const 坏 = 原.replace('"test/independence.test.mjs"', '"test/no-such-suite.test.mjs"');
  if (坏 === 原) {
    ok("反向改动落到了位置（否则这一节什么都没验）", false, "没找到可替换的 verifiedBy");
  } else {
    let 新表 = null;
    try {
      新表 = JSON.parse(坏);
    } catch {
      新表 = null;
    }
    const r = 新表 ? 核(新表) : { 缺测: [] };
    ok("改坏之后「verifiedBy 的文件都在」会被抓出来", r.缺测.length > 0, r.缺测.join(", "));
    ok("而且抓的就是被改坏的那一条", r.缺测.some((x) => x.includes("no-such-suite")), r.缺测.join(", "));
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
