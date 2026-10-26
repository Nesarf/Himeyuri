// 容器：.hm-ittgn-krgn-m 的最小形状，验三件事。
//
// 这一套是 design/FILETYPE.txt 第三节那三条规矩的落地：
//
//   一、字节原样进出。容器不压、不改行尾、不猜编码 —— 所以用二进制样本，
//      含 0 与 255，一次装进去再取回来，逐字节比。
//   二、深度各自算。层数 = 成员名里斜杠的个数加一，上限 12，只看这一次的成员，
//      不从外面累加。所以这里装两个各自 12 层的包（互不影响），再装一个 13 层的（要拒）。
//   三、容器里不出现 hmsnp 与 hmhsr。那两个是容器自己的逻辑，写成成员的话
//      转换一次多一份副本，往返两次就是四份。
//
// 跑的是 bin/hmyr.mjs（最小求值器那一路）。字节码那一路由别的套件覆盖它们的
// write_bytes / read_bytes，这一套只管格式。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 写容器 } from "../src/ittgn.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 具 = path.join(ROOT, "bin", "hmyr.mjs");
const 源码 = path.join(ROOT, "self", "ittgn.hmoca");
const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ittgn-"));

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (参, cwd = 临) => spawnSync(process.execPath, [具, 源码, ...参], { encoding: "utf8", cwd, timeout: 120000 });
// 跑文件：不带子命令，直接给 hmyr 一个目标 —— 那正是「容器能跑」要验的那条路。
const 跑文件 = (参, cwd = 临) => spawnSync(process.execPath, [具, ...参], { encoding: "utf8", cwd, timeout: 120000 });

const 造 = (相对, 字节) => {
  const 全 = path.join(临, 相对);
  fs.mkdirSync(path.dirname(全), { recursive: true });
  fs.writeFileSync(全, Buffer.from(字节));
  return 相对;
};

console.log("一、字节原样进出（含 0 与 255 的样本）");
{
  const 样 = [0, 255, 1, 128, 65, 10, 13, 0];
  造("bin.dat", 样);
  造("text.txt", [...Buffer.from("hello, 世界", "utf8")]);
  const 包 = "one.hm-ittgn-krgn-m";
  const r = 跑(["--装", 包, "bin.dat", "text.txt"]);
  ok("装得成", r.status === 0, (r.stdout || "").slice(0, 120) + (r.stderr || "").slice(0, 120));
  const 列 = 跑(["--列", 包]);
  ok("列得出两个成员", (列.stdout || "").includes("bin.dat") && (列.stdout || "").includes("text.txt"), (列.stdout || "").slice(0, 200));

  const 取1 = 跑(["--取", 包, "bin.dat", "回1.bin"]);
  ok("取得回第一个", 取1.status === 0, (取1.stdout || "").slice(0, 120));
  const 回1 = fs.readFileSync(path.join(临, "回1.bin"));
  ok("字节一致（二进制）", Buffer.compare(回1, Buffer.from(样)) === 0, Array.from(回1).join(","));

  const 取2 = 跑(["--取", 包, "text.txt", "回2.txt"]);
  ok("取得回第二个", 取2.status === 0, (取2.stdout || "").slice(0, 120));
  const 回2 = fs.readFileSync(path.join(临, "回2.txt"));
  ok("字节一致（带中文）", Buffer.compare(回2, fs.readFileSync(path.join(临, "text.txt"))) === 0, String(回2).slice(0, 40));

  const 无 = 跑(["--取", 包, "没有这个", "回3.bin"]);
  ok("取一个不存在的成员要报错", (无.stdout || "").includes("E0414"), (无.stdout || "").slice(0, 80));
}

console.log("二、深度各自算，上限 12");
{
  // 造两个各自 12 层的路径：11 个斜杠。
  const 深12 = (i) => {
    const 段们 = [];
    for (let k = 1; k <= 11; k++) 段们.push("d" + i + "_" + k);
    return 段们.join("/") + "/x" + i + ".txt";
  };
  const 名甲 = 造(深12(1), [1, 2, 3]);
  const 名乙 = 造(深12(2), [4, 5, 6]);
  ok("12 层的路径斜杠数对", (名甲.match(/\//g) || []).length === 11, String((名甲.match(/\//g) || []).length));

  const 甲 = 跑(["--装", "深甲.hm-ittgn-krgn-m", 名甲]);
  ok("第一个 12 层装得进", 甲.status === 0, (甲.stdout || "").slice(0, 120) + (甲.stderr || "").slice(0, 120));
  const 乙 = 跑(["--装", "深乙.hm-ittgn-krgn-m", 名乙]);
  ok("第二个 12 层也装得进（不累加）", 乙.status === 0, (乙.stdout || "").slice(0, 120) + (乙.stderr || "").slice(0, 120));

  // 13 层：12 个斜杠。
  const 段们 = [];
  for (let k = 1; k <= 12; k++) 段们.push("e" + k);
  const 名丙 = 造(段们.concat(["y.txt"]).join("/"), [7, 8, 9]);
  ok("13 层的路径斜杠数对", (名丙.match(/\//g) || []).length === 12, String((名丙.match(/\//g) || []).length));
  const 丙 = 跑(["--装", "太深.hm-ittgn-krgn-m", 名丙]);
  ok("13 层要拒", (丙.stdout || "").includes("上限 12"), (丙.stdout || "").slice(0, 100));
  ok("拒的时候不留包", !fs.existsSync(path.join(临, "太深.hm-ittgn-krgn-m")));
}

console.log("三、容器里不出现 hmsnp 与 hmhsr");
{
  造("普通.hmoca", [1, 1, 1]);
  const 普通 = 跑(["--装", "带源.hm-ittgn-krgn-m", "普通.hmoca"]);
  ok("hmoca 成员可以进", 普通.status === 0, (普通.stdout || "").slice(0, 120));

  造("entry.hmsnp", [2, 2, 2]);
  const 甲 = 跑(["--装", "坏1.hm-ittgn-krgn-m", "entry.hmsnp"]);
  ok("hmsnp 要被拒", (甲.stdout || "").includes("逻辑"), (甲.stdout || "").slice(0, 100));

  造("entry.hmhsr", [3, 3, 3]);
  const 乙 = 跑(["--装", "坏2.hm-ittgn-krgn-m", "entry.hmhsr"]);
  ok("hmhsr 要被拒", (乙.stdout || "").includes("逻辑"), (乙.stdout || "").slice(0, 100));
}

console.log("四、不是容器的东西要认出来");
{
  fs.writeFileSync(path.join(临, "假的.hm-ittgn-krgn-m"), Buffer.from("not a container at all"));
  const r = 跑(["--列", "假的.hm-ittgn-krgn-m"]);
  ok("魔术不对要报错", (r.stdout || "").includes("不是容器"), (r.stdout || "").slice(0, 80));
}

console.log("五、路径里的中文（UTF-8 那一层）");
{
  // 容器里存的是字节，而 write_bytes 只走 0 到 255 —— 直接按码点写会把中文截断成问号。
  // 所以路径过一次 UTF-8：这里是那一层的验收，比的是「取回来的名字与原来一样」。
  const 样 = [9, 8, 7, 6];
  造("数据/名字.txt", 样);
  const 包 = "中.hm-ittgn-krgn-m";
  const r = 跑(["--装", 包, "数据/名字.txt"]);
  ok("中文路径装得进", r.status === 0 || (r.stdout || "").includes("装了"), (r.stdout || "").slice(0, 120));
  const 列 = 跑(["--列", 包]);
  ok("列出来的名字与原来一样", (列.stdout || "").includes("数据/名字.txt"), (列.stdout || "").slice(0, 160));
  const 取 = 跑(["--取", 包, "数据/名字.txt", "回中.bin"]);
  ok("按中文名取得回", (取.stdout || "").includes("取了"), (取.stdout || "").slice(0, 120));
  const 回 = fs.readFileSync(path.join(临, "回中.bin"));
  ok("字节一致（中文路径）", Buffer.compare(回, Buffer.from(样)) === 0, Array.from(回).join(","));
}

console.log("六、容器能直接跑");
{
  const 源 = "fn main() -> Int {\n  print(\"从容器里跑出来了\" + chr(10))\n  return 0\n}\n";
  造("跑/main.hmoca", [...Buffer.from(源, "utf8")]);
  const 直 = 跑文件(["跑/main.hmoca"]);
  ok("直接跑那份源码有输出", (直.stdout || "").includes("从容器里跑出来了"), JSON.stringify((直.stdout || "").slice(0, 60)));
  const 装 = 跑(["--装", "跑.hm-ittgn-krgn-m", "跑/main.hmoca"]);
  ok("装得成（为了跑）", (装.stdout || "").includes("装了"), (装.stdout || "").slice(0, 100));
  const 通 = 跑文件(["跑.hm-ittgn-krgn-m"]);
  ok("跑容器与跑源码输出一样", (通.stdout || "") === (直.stdout || ""), JSON.stringify([直.stdout, 通.stdout]));
  ok("而且真的跑出了那句话", (通.stdout || "").includes("从容器里跑出来了"), JSON.stringify((通.stdout || "").slice(0, 80)));
}

console.log("七、HMYR 写的与 JS 写的，字节相同");
{
  // 同一批成员，一边用 self/ittgn.hmoca 的「装」，一边用 src/ittgn.mjs 的「写容器」。
  // 两份落在同一个格式上，字节能比就是一个硬判据 —— 比「两边都跑得通」硬得多。
  造("比/a.txt", [1, 2, 3]);
  造("比/b.txt", [4, 5]);
  const 甲 = "比甲.hm-ittgn-krgn-m";
  跑(["--装", 甲, "比/a.txt", "比/b.txt"]);
  写容器(path.join(临, "比乙.hm-ittgn-krgn-m"), [
    { 名: "比/a.txt", 数据: Buffer.from([1, 2, 3]) },
    { 名: "比/b.txt", 数据: Buffer.from([4, 5]) },
  ]);
  const 甲字节 = fs.readFileSync(path.join(临, 甲));
  const 乙字节 = fs.readFileSync(path.join(临, "比乙.hm-ittgn-krgn-m"));
  ok("两份字节相同", Buffer.compare(甲字节, 乙字节) === 0, 甲字节.length + " 对 " + 乙字节.length);
}

console.log("八、转换到 zip：入口释放出来，内容只摊一份");
{
  // design/FILETYPE.txt 第四节那一条：容器 → 压缩包时，运行逻辑释放成 hmsnp 与 hmhsr，
  // 放在根目录，两者共用同一份内容。所以这里数的不是「能不能解开」，而是
  // 「成员只摊了几份」「两个入口在不在根」「拿其中一个跑不跑得出同样的输出」。
  const 源 = "fn main() -> Int {\n  print(\"从 zip 里跑出来了\" + chr(10))\n  return 0\n}\n";
  造("转/main.hmoca", [...Buffer.from(源, "utf8")]);
  const 装 = 跑(["--装", "转.hm-ittgn-krgn-m", "转/main.hmoca"]);
  ok("先装成容器", (装.stdout || "").includes("装了"), (装.stdout || "").slice(0, 100));

  const 转 = spawnSync(process.execPath, [path.join(ROOT, "tools", "ittgn-to-zip.mjs"),
    path.join(临, "转.hm-ittgn-krgn-m"), path.join(临, "转.zip")], { encoding: "utf8", cwd: 临 });
  ok("转得出 zip", 转.status === 0, (转.stderr || "").slice(0, 160));
  ok("说了入口取自哪儿", (转.stdout || "").includes("入口取自"), (转.stdout || "").slice(0, 120));

  const 解 = path.join(临, "解开的");
  fs.mkdirSync(解, { recursive: true });
  const 开 = spawnSync("powershell", ["-NoProfile", "-Command",
    "Expand-Archive -Path '" + path.join(临, "转.zip") + "' -DestinationPath '" + 解 + "' -Force"],
  { encoding: "utf8" });
  ok("解得出", fs.existsSync(解), String(开.status));
  ok("成员在里面", fs.existsSync(path.join(解, "转", "main.hmoca")));
  ok("hmsnp 在根目录", fs.existsSync(path.join(解, "转.hmsnp")));
  ok("hmhsr 在根目录", fs.existsSync(path.join(解, "转.hmhsr")));

  // 零份副本：成员不因为有两个入口就摊两份。
  const 数 = (d) => fs.readdirSync(d, { withFileTypes: true })
    .reduce((s, e) => s + (e.isDirectory() ? 数(path.join(d, e.name)) : 1), 0);
  // 四个：内容一份、两个入口、外加一张成员表（反方向靠它还原成员名与顺序）。
  ok("摊开的文件一共四个（内容一份 + 两个入口 + 成员表）", 数(解) === 4, String(数(解)));

  const 跑入口 = (名) => spawnSync(process.execPath, [具, path.join(解, 名)], { encoding: "utf8", cwd: 解, timeout: 120000 });
  const 甲 = 跑入口("转.hmsnp");
  const 乙 = 跑入口("转.hmhsr");
  ok("hmsnp 跑出那句话", (甲.stdout || "").includes("从 zip 里跑出来了"), JSON.stringify((甲.stdout || "").slice(0, 80)));
  ok("hmhsr 跑出同样的话", (乙.stdout || "") === (甲.stdout || ""), JSON.stringify([甲.stdout, 乙.stdout]));
}

console.log("九、往返：容器 → zip → 容器，字节相同");
{
  // 反方向是靠转换时留下的成员表走回来的。判据只有一条，而且很硬：逐字节比。
  // 「解得出、跑得动」都太松 —— 一个往返把成员名或顺序改掉，那些全都会绿。
  造("往/main.hmoca", [...Buffer.from("fn main() -> Int {\n  print(\"往返\" + chr(10))\n  return 0\n}\n", "utf8")]);
  造("往/notes.txt", [0, 255, 42]);
  const 原 = "往.hm-ittgn-krgn-m";
  const 装 = 跑(["--装", 原, "往/main.hmoca", "往/notes.txt"]);
  ok("先装成容器", (装.stdout || "").includes("装了 2"), (装.stdout || "").slice(0, 100));

  const 转 = spawnSync(process.execPath, [path.join(ROOT, "tools", "ittgn-to-zip.mjs"),
    path.join(临, 原), path.join(临, "往.zip")], { encoding: "utf8", cwd: 临 });
  ok("转成 zip", 转.status === 0, (转.stderr || "").slice(0, 160));

  const 回 = spawnSync(process.execPath, [path.join(ROOT, "tools", "ittgn-from-zip.mjs"),
    path.join(临, "往.zip"), path.join(临, "回.hm-ittgn-krgn-m")], { encoding: "utf8", cwd: 临 });
  ok("收回容器", 回.status === 0, (回.stderr || "").slice(0, 160));

  const 甲 = fs.readFileSync(path.join(临, 原));
  const 乙 = fs.readFileSync(path.join(临, "回.hm-ittgn-krgn-m"));
  ok("往返之后逐字节相同", Buffer.compare(甲, 乙) === 0, 甲.length + " 对 " + 乙.length);
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
