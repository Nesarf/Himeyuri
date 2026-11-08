// 在真的 Windows 10 上重验一次 C 机器：把 2026-11-08 那晚手工走过的步骤收成一条命令。
//
// 为什么要有它：那次验证的每一步都只活在 design/CHECKING.txt 的散文里 —— 起虚拟机、
// guestcontrol 拷文件、cmd /v:on 取退出码、与 node 那面比。散文读得懂，但复现不了，
// 而「每一个论断都可被检验」这句要的是后者。记得住步骤不算判据，跑得起来才算。
//
// 它不替你下结论，只把三样摆出来：客户机上的退出码、主机上的答案、两者的差。
//
// 退出码：0 两处一致；1 不一致；2 这一台做不了（没有 VirtualBox、没有那台机器、没有密码）。
//        「做不了」与「不一致」必须分开 —— 前者什么都没验，后者验了并且失败。
//
// 用法：
//   node tools/guest-recheck.mjs
//   node tools/guest-recheck.mjs --vm W10Test --user hmyr --password hmyr
//   node tools/guest-recheck.mjs --exe D:\some\hmyr.exe     # 换一份现成的静态 exe
//   node tools/guest-recheck.mjs --keep                      # 跑完不停机
//
// 需要的东西：VirtualBox（VBoxManage 在注册表或 PATH 里）、一台装着 Windows 10 且装了
// Guest Additions 的虚拟机、能登录的账户。都没有就报「做不了」，不报失败。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 编C机器 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 参 = process.argv.slice(2);
const 取值 = (旗, 缺省) => {
  const i = 参.indexOf(旗);
  return i >= 0 && i + 1 < 参.length ? 参[i + 1] : 缺省;
};
const 有旗 = (旗) => 参.includes(旗);

const 机名 = 取值("--vm", "W10Test");
const 用户 = 取值("--user", "hmyr");
const 密码 = 取值("--password", process.env.HMYR_VM_PASSWORD || "");
const 留机 = 有旗("--keep");

const 报 = (名, 值) => console.log("  " + 名.padEnd(10) + 值);
const 做不了 = (为什么) => {
  console.log("这一台做不了：" + 为什么);
  process.exit(2);
};

// ---- 一、找 VBoxManage ----
// 先看环境变量，再看注册表，最后看 PATH。硬编码本机路径会把这条命令变成只在一台机器上
// 成立的东西，而它存在的理由恰恰是可复现。
const 找VBox = () => {
  if (process.env.VBOX_MANAGE && fs.existsSync(process.env.VBOX_MANAGE)) return process.env.VBOX_MANAGE;
  if (process.platform === "win32") {
    const r = spawnSync("reg", ["query", "HKLM\\SOFTWARE\\Oracle\\VirtualBox", "/v", "InstallDir"], { encoding: "utf8" });
    const m = /InstallDir\s+REG_SZ\s+(.+)/.exec(String(r.stdout || ""));
    if (m) {
      const 猜 = path.join(m[1].trim(), "VBoxManage.exe");
      if (fs.existsSync(猜)) return 猜;
    }
  }
  const 哪 = spawnSync("VBoxManage", ["--version"], { encoding: "utf8" });
  return 哪.status === 0 ? "VBoxManage" : null;
};

const VBox = 找VBox();
if (!VBox) 做不了("没有 VirtualBox（VBoxManage 不在注册表、也不在 PATH）");
const vbox = (参数) => spawnSync(VBox, 参数, { encoding: "utf8", timeout: 120000 });

// ---- 二、那台机器在吗，现在是什么状态 ----
const 册 = vbox(["list", "vms"]);
if (册.status !== 0) 做不了("VBoxManage list vms 跑不动：" + String(册.stderr || "").slice(0, 120));
if (!String(册.stdout || "").includes('"' + 机名 + '"')) 做不了("没有叫 " + 机名 + " 的虚拟机");

const 机读 = () => {
  const r = vbox(["showvminfo", 机名, "--machinereadable"]);
  const 出 = String(r.stdout || "");
  const 取 = (键) => {
    const m = new RegExp("^" + 键 + '="(.*)"$', "m").exec(出);
    return m ? m[1] : "";
  };
  return { state: 取("VMState"), os: 取("ostype"), description: 取("description"), ga: 取("GuestAdditionsRunLevel") };
};

let 态 = 机读();
const 本来在跑 = 态.state === "running";
// poweroff 与 aborted 都是「停着」，都能直接 startvm。aborted 是上一次异常中止留下的
// 状态 —— 2026-11-08 那台就停在 aborted 上，把它当成「做不了」会让这条命令第一次用就哑。
const 可以起 = 态.state === "poweroff" || 态.state === "aborted";

if (!本来在跑 && !可以起) 做不了("机器状态是 " + 态.state + "，只有 running、poweroff 与 aborted 能走这条路");
if (!本来在跑) {
  console.log("起机器（headless）…");
  const 起 = vbox(["startvm", 机名, "--type", "headless"]);
  if (起.status !== 0) 做不了("起不来：" + String(起.stderr || "").slice(0, 160));
}

// ---- 三、等 guestcontrol 通 ----
// Guest Additions 的服务起来要时间，而「还没起来」与「密码不对」是两件事，分开报 ——
// 前者再等等就好，后者等多久都没用。
const 睡 = (毫秒) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 毫秒);
const 试着跑 = (命令) =>
  vbox(["guestcontrol", 机名, "run", "--exe", "C:\\Windows\\System32\\cmd.exe",
    "--username", 用户, "--password", 密码, "--", "cmd", "/c", 命令]);

if (!密码) 做不了("没有密码（用 --password 或环境变量 HMYR_VM_PASSWORD）");
console.log("等客户机应答（最多四分钟）…");
// 四分钟不是拍的：从 aborted 冷启动，Win10 在机械盘上光到桌面就要两三分钟，而
// guestcontrol 要等 Guest Additions 的服务起来 —— 运行级别 2 才代表它在跑。
// 超时时把这个级别报出来，好区分「还在启动」与「GA 装了但服务没起」。
let 通 = false;
let 级 = "";
const 起等 = Date.now();
while (Date.now() - 起等 < 240000) {
  const r = 试着跑("echo up");
  if (r.status === 0 && String(r.stdout || "").includes("up")) {
    通 = true;
    break;
  }
  if (/was not able to logon/i.test(String(r.stderr || ""))) 做不了("密码登不进去（" + 用户 + "）");
  级 = 机读().ga || 级;
  睡(4000);
}
if (!通) 做不了("四分钟内 guestcontrol 没通（Guest Additions 运行级别 " + (级 || "?") + "，2 才代表服务在跑）");

// ---- 四、编一份静态 exe，或者用给的那一份 ----
let 本地exe = 取值("--exe", "");
if (!本地exe) {
  const 出 = path.join(os.tmpdir(), "hmyr-guest-recheck", "hmyr-static.exe");
  fs.mkdirSync(path.dirname(出), { recursive: true });
  console.log("编静态 exe…");
  const 编 = 编C机器(出, ["-static"]);
  if (编.status !== 0) 做不了("编不出来：" + String(编.stderr || "").slice(0, 200));
  本地exe = 出;
}
if (!fs.existsSync(本地exe)) 做不了("那份 exe 不在：" + 本地exe);

// ---- 五、送进去、跑、取退出码 ----
const 客目录 = "C:\\Users\\" + 用户;
const 客exe = 客目录 + "\\hmyr-recheck.exe";
const 客源 = 客目录 + "\\hello.hmoca";
const 源 = path.join(ROOT, "examples/hello.hmoca");

for (const [本地, 远端] of [[本地exe, 客exe], [源, 客源]]) {
  const r = vbox(["guestcontrol", 机名, "copyto", 本地, 远端, "--username", 用户, "--password", 密码]);
  if (r.status !== 0) 做不了("拷不进去（" + path.basename(本地) + "）：" + String(r.stderr || "").slice(0, 160));
}

console.log("在客户机上跑…");
// %errorlevel% 在 cmd 的 & 链里是解析期展开的，取不到真值；/v:on 加 !errorlevel! 才能取。
const 跑 = vbox(["guestcontrol", 机名, "run", "--exe", "C:\\Windows\\System32\\cmd.exe",
  "--username", 用户, "--password", 密码, "--",
  "cmd", "/v:on", "/c", 客exe + " " + 客源 + " & echo HMYR_EXIT=!errorlevel!"]);
const 跑出 = String(跑.stdout || "");
const m = /HMYR_EXIT=(\d+)/.exec(跑出);
if (!m) 做不了("客户机上没跑出退出码：" + (跑出 || String(跑.stderr || "")).slice(0, 200));
const 客退出 = Number(m[1]);

// ---- 六、主机这一面的答案 ----
const 主 = spawnSync("node", [path.join(ROOT, "bin/hmyr.mjs"), 源], { encoding: "utf8", cwd: ROOT });
const 主答 = String(主.stdout || "").trim();
const 主退出 = 主.status;

// ---- 七、报 ----
const 机信息 = 机读();
console.log("");
console.log("客机      " + 机名 + "（" + (机信息.os || "?") + "）" + (机信息.description ? "：" + 机信息.description.slice(0, 60) : ""));
报("客机退出码", String(客退出));
报("主机答案", 主答 + "（退出码 " + 主退出 + "）");
报("静态 exe", path.basename(本地exe) + " " + fs.statSync(本地exe).size + " 字节");

// C 机器把返回值交给进程当退出码，node 那面打印它并以 0 退出 —— 比的是那个数，不是两个退出码。
const 一致 = String(客退出) === 主答;
console.log("");
console.log(一致
  ? "两处一致：同一个程序算出 " + 客退出 + "。"
  : "两处不一致：客户机 " + 客退出 + " 对主机 " + 主答 + "。");

if (!本来在跑 && !留机) {
  vbox(["controlvm", 机名, "poweroff"]);
  console.log("机器已关（--keep 可以留着它）。");
}
process.exit(一致 ? 0 : 1);
