// 把一张映像烧进板子。板子到货之后，「上电跑」剩下的三步是：插线、烧写、听串口。
// 这一份管第二步，第三步的提示放在最后一行。
//
// 映像从哪来：tools/arm-size.mjs 会链一张板子侧的映像，但它跑完就清掉临时目录。
// 要留一份，给它一个目标路径：
//
//   $env:HMYR_ARM_ELF = "dist/hmyr-board.elf"
//   node tools/arm-size.mjs
//   node tools/arm-flash.mjs
//
// 用法：
//   node tools/arm-flash.mjs [映像.elf]
//
// 目标芯片用环境变量 HMYR_BOARD_TARGET 覆盖，默认 stm32f411re。
//
// 三条前提，都是「到货那天会撞上」的：
//
//   一、target 要先装。pyocd 内置的那二百来个 target 里没有 F411，
//       它来自 CMSIS pack：pyocd pack install stm32f411re。
//       pack 是一百四十兆上下，默认落在用户目录（cmsis-pack-manager 那边）。
//       pyocd 没有「把缓存挪走」的选项：CMSIS_PACK_ROOT 只改读取位置，
//       写入照旧 —— 实测设了它之后 pack install 仍然写回原处。要真搬，
//       给那个目录做一个到别处的 junction 才是办法。
//
//   二、探针要认得。板子自带的 ST-Link/V2-1 在 Windows 上要 ST 的驱动；
//       若 pyocd list 说 No available debug probes，先装 STM32CubeProgrammer
//       （它带驱动），或者用 Zadig 把那个接口换成 WinUSB。
//
//   三、烧写会占用调试口，串口是另一条线。板子上那个虚拟串口在烧完之后
//      才腾得出来，所以听输出要在烧完之后开始。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 目标芯片 = process.env.HMYR_BOARD_TARGET || "stm32f411re";
const 映像 = path.resolve(process.argv[2] || path.join(ROOT, "dist/hmyr-board.elf"));

if (!fs.existsSync(映像)) {
  console.error("没有这张映像：" + 映像);
  console.error("先把它链出来（下面这一趟会把映像留一份在 dist/）：");
  console.error("  $env:HMYR_ARM_ELF = \"dist/hmyr-board.elf\"");
  console.error("  node tools/arm-size.mjs");
  process.exit(2);
}

const pyocd = (() => {
  const 候选 = [
    process.env.PYOCD,
    "pyocd",
    path.join(process.env.LOCALAPPDATA || "", "Programs/Python"),
  ].filter(Boolean);
  for (const p of 候选) {
    try { if (spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0) return p; } catch { /* 下一个 */ }
  }
  return null;
})();

if (!pyocd) {
  console.error("找不到 pyocd。装它：pip install pyocd");
  process.exit(2);
}

// 先问一句「有没有探针」。直接 flash 也能报同样的错，但那句话夹在一大段
// 进度输出里，容易被当成「烧失败」而不是「线没插好」。
{
  const r = spawnSync(pyocd, ["list"], { encoding: "utf8", timeout: 60000 });
  const 文 = String(r.stdout || "") + String(r.stderr || "");
  if (/No available debug probes/i.test(文)) {
    console.error("没有找到调试探针。要查的三处：");
    console.error("  一、USB 线是不是插在板子的 ST-Link 那一侧（Nucleo-64 上标着 CN1）");
    console.error("  二、设备管理器里有没有 STM32 STLink 或一个未知的 USB 设备");
    console.error("  三、驱动：装 STM32CubeProgrammer，或用 Zadig 把这个接口换成 WinUSB");
    process.exit(3);
  }
}

// target 在不在，也在烧之前问清楚 —— 缺了它，pyocd 会去下载 pack，
// 那一步看起来像卡住。
{
  const r = spawnSync(pyocd, ["list", "--targets"], { encoding: "utf8", timeout: 120000 });
  if (!String(r.stdout || "").includes(目标芯片)) {
    console.error("pyocd 里没有 target " + 目标芯片 + "。先装它：");
    console.error("  pyocd pack install stm32f411re");
    process.exit(3);
  }
}

console.log("烧写：" + 映像);
console.log("目标芯片：" + 目标芯片);
const r = spawnSync(pyocd, ["flash", "-t", 目标芯片, 映像], { encoding: "utf8", timeout: 300000 });
process.stdout.write(String(r.stdout || ""));
process.stderr.write(String(r.stderr || ""));
if (r.status !== 0) {
  console.error("烧写没过（退出码 " + r.status + "）。常见成因：调试口被占、板子没上电、驱动不对。");
  process.exit(1);
}

console.log("");
console.log("烧完了。听串口：");
console.log("  python -m serial.tools.miniterm COM<N> 115200");
console.log("板子的虚拟串口在设备管理器里叫「STMicroelectronics STLink Virtual COM Port」。");
