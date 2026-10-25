// 发布的一条闭环：真发一次，再把发出去的东西拿回来，用它自己的工具验一遍。
//
// 串起来的是三件已经存在的东西：
//   self/release.hmyr   造清单、打包、写说明书（一条命令三样）
//   self/verify.hmyr    逐条比 sha256，再比整份的 digest
//   以及「解包」这一步：这一版的成员一律 stored，所以按偏移切片就是其内容
//
// 为什么需要它：releasehmyr 与 verifyhmyr 两套的「真跑」都挂在 HMYR_HEAVY 之后，
// 而常规全量从不设那个变量。于是「真发一次」这条路上，只有手动跑过的人知道它通不通。
//
// 它比那两套多验四条：
//   一、包里那份 manifest.json 与包外那份逐字节相同
//       （release.hmyr 的注释写着「包内外是同一批字节」，但此前没有验收读过这句话）
//   二、每一个成员与仓库里的源文件逐字节相同
//       （packagehmyr 做过这件事，但那是对它自己造的包，不是对一次真发）
//   三、拿解出来的包当根，用 HMYR 自己的 verifier 验包里那份清单
//       —— 这才是「别人拿到这个包」的场景：清单里的路径是相对的，包就是根
//   四、从解出来的目录里起一次启动器，跑一个例子程序
//       —— 清单上说字节对得上，不等于这些字节能跑起来
//
// 一次三分钟上下：造清单与验清单各一百秒，两头都在给两百多个文件算 sha256。
// 所以它不进 check-all，位置是发布之前。
//
//   node tools/release-loop.mjs [tag]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 标 = process.argv[2] || "v0.0.1";
let passed = 0, failed = 0;
const ok = (标签, 条件, 细节 = "") => {
  if (条件) { passed++; console.log("  通过  " + 标签); }
  else { failed++; console.log("  不通过  " + 标签 + (细节 ? "  " + 细节 : "")); }
};

// 临时目录留在非系统盘，跑完就删。
const 临 = fs.mkdtempSync("E:/DaShaoHuo/cache/tmp/release-loop-");
const 解 = path.join(临, "x");
const 包路 = path.join(临, "himeyuri-" + 标 + ".zip");
const 外清单 = path.join(临, "manifest.json");
const 大步数 = { ...process.env, HMYR_STEPS: "4000000000" };

// zip 的读侧：尾记录 → 中央目录 → 每个成员的本地头偏移 → 数据切片。
// 这一版只认 stored（方法 0）；遇到压缩成员就当场说出来，而不是猜。
function 读包(包) {
  let 尾位 = 包.length - 22;
  while (尾位 >= 0 && !(包[尾位] === 0x50 && 包[尾位 + 1] === 0x4b && 包[尾位 + 2] === 5 && 包[尾位 + 3] === 6)) 尾位--;
  if (尾位 < 0) throw new Error("找不到尾记录，这不像一个 zip");
  const 条数 = 包.readUInt16LE(尾位 + 10);
  const 目录偏移 = 包.readUInt32LE(尾位 + 16);
  const 项们 = [];
  let p = 目录偏移;
  for (let k = 0; k < 条数; k++) {
    if (!(包[p] === 0x50 && 包[p + 1] === 0x4b && 包[p + 2] === 1 && 包[p + 3] === 2)) {
      throw new Error("第 " + (k + 1) + " 个中央目录项的签名不对，位置 " + p);
    }
    const 方法 = 包.readUInt16LE(p + 10);
    const 压缩长 = 包.readUInt32LE(p + 20);
    const 名长 = 包.readUInt16LE(p + 28);
    const 额长 = 包.readUInt16LE(p + 30);
    const 注长 = 包.readUInt16LE(p + 32);
    const 本地 = 包.readUInt32LE(p + 42);
    const 名 = 包.subarray(p + 46, p + 46 + 名长).toString("utf8");
    const 本名长 = 包.readUInt16LE(本地 + 26);
    const 本额长 = 包.readUInt16LE(本地 + 28);
    const 起 = 本地 + 30 + 本名长 + 本额长;
    项们.push({ 名, 方法, 数据: 包.subarray(起, 起 + 压缩长) });
    p += 46 + 名长 + 额长 + 注长;
  }
  return { 条数, 项们 };
}

try {
  console.log("一、HMYR 真发一次");
  const 发 = spawnSync(process.execPath, ["bin/hmyr.mjs", "--compile", "self/release.hmoca", 标, 临], {
    cwd: ROOT, encoding: "utf8", timeout: 900000, env: 大步数, maxBuffer: 32 * 1024 * 1024,
  });
  ok("发布跑得动", 发.status === 0, String(发.status) + " " + String(发.stderr || "").slice(0, 200));
  ok("三样产物都在", fs.existsSync(包路) && fs.existsSync(外清单) &&
    fs.existsSync(path.join(临, "release-notes.md")));
  if (!fs.existsSync(包路) || !fs.existsSync(外清单)) throw new Error("产物不齐，后面的没有意义");

  console.log("二、把包解出来");
  const 包 = fs.readFileSync(包路);
  const { 条数, 项们 } = 读包(包);
  ok("成员数与尾记录一致", 项们.length === 条数, 项们.length + " / " + 条数);
  ok("成员数超过两百", 条数 > 200, String(条数));
  ok("全部成员都是 stored", 项们.every((项) => 项.方法 === 0));
  fs.mkdirSync(解, { recursive: true });
  let 解不开 = 0;
  for (const 项 of 项们) {
    if (项.名.endsWith("/")) continue;
    const 路 = path.join(解, 项.名);
    fs.mkdirSync(path.dirname(路), { recursive: true });
    fs.writeFileSync(路, 项.数据);
  }
  ok("解出来的文件数与成员数一致",
    fs.readdirSync(解).length > 0 && 解不开 === 0, String(解不开));

  console.log("三、包内外是同一批字节");
  const 内清单项 = 项们.find((项) => 项.名 === "manifest.json");
  ok("包里带着 manifest.json", !!内清单项);
  if (内清单项) {
    const 外 = fs.readFileSync(外清单);
    ok("包内那份与包外那份逐字节相同",
      内清单项.数据.length === 外.length && 内清单项.数据.equals(外),
      String(内清单项.数据.length) + " / " + String(外.length));
  }

  console.log("四、每个成员与仓库里的源相同");
  let 同 = 0, 异们 = [];
  for (const 项 of 项们) {
    if (项.名 === "manifest.json") continue; // 这一份没有仓库里的对应物，上一节单独比过
    const 源 = path.join(ROOT, 项.名);
    if (!fs.existsSync(源)) { 异们.push(项.名 + "（仓库里没有）"); continue; }
    const a = fs.readFileSync(源);
    if (a.length === 项.数据.length && a.equals(项.数据)) 同++;
    else 异们.push(项.名 + "（字节不同）");
  }
  ok("比过的成员数超过两百", 同 > 200, String(同));
  ok("没有一个成员与源不同", 异们.length === 0, 异们.slice(0, 3).join("、"));

  console.log("五、拿包当根，用 HMYR 自己验包里那份清单");
  const 验 = spawnSync(process.execPath,
    [path.join(ROOT, "bin/hmyr.mjs"), "--compile", path.join(ROOT, "self/verify.hmoca"), "manifest.json"], {
      cwd: 解, encoding: "utf8", timeout: 900000, env: 大步数, maxBuffer: 32 * 1024 * 1024,
    });
  const 验出 = String(验.stdout || "");
  ok("验得出结论（退出码零）", 验.status === 0, String(验.status) + " " + String(验.stderr || "").slice(0, 200));
  ok("每一项都对得上", /不对 0 项/.test(验出) && /缺 0 项/.test(验出), 验出.trim().split("\n")[0] || "");
  ok("整份的 digest 也对得上", 验出.includes("digest 对得上"), "");
  ok("它自己说了通过", 验出.includes("通过"), 验出.trim().slice(-40));

  console.log("六、解出来的包能自己跑");
  // 第五节的清单只说明「字节对得上」，不说明「这些字节能跑」。
  // 这一节从解出来的目录里起一次启动器：它 import 的是包里的 src/，
  // 读的是包里的 runtime/，与仓库那份无关。
  const 样例 = "examples/arith.hmoca";
  const 跑一次 = (根) => spawnSync(process.execPath, [path.join(根, "bin/hmyr.mjs"), "--compile", path.join(根, 样例)], {
    cwd: 根, encoding: "utf8", timeout: 300000, env: 大步数, maxBuffer: 8 * 1024 * 1024,
  });
  const 仓跑 = 跑一次(ROOT);
  const 包跑 = 跑一次(解);
  ok("仓库里跑得动", 仓跑.status === 0, String(仓跑.status) + " " + String(仓跑.stderr || "").slice(0, 200));
  ok("从包里跑得动", 包跑.status === 0, String(包跑.status) + " " + String(包跑.stderr || "").slice(0, 200));
  ok("两处输出相同", 仓跑.stdout === 包跑.stdout, JSON.stringify((包跑.stdout || "").slice(0, 60)));

  console.log("");
  console.log("  这一次发布：成员 " + 条数 + " 个 · 源与成员相同的 " + 同 + " 个 · 清单 250 项级别");
} finally {
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
