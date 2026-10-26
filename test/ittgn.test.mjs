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

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
