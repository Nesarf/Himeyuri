// 在桌面上跑一份 ARM 镜像，把串口上收到的内容交回来。
//
// 为什么要有它（2026-10-30）：板子那条线的实验一直需要板子实体，而板子不可能
// 一直插着。QEMU 的 mps2-an385 跑同一份镜像、串口走一个文件，于是「装载、执行、
// 输出」这三件事随时可验，不必等硬件。
//
// 它不能替代什么，这一条写在这里而不是藏在文档里：MPS2 是 Cortex-M3、四兆 RAM，
// 而那块板子是 Cortex-M4、一百二十八 KB。所以它验的是逻辑（同一份字节码、同一台
// 机器、同一个答案），容量仍然要真板子 —— 或者桌面上的配额模拟。
//
// 用法：
//   node tools/qemu-board.mjs port/build/hmyr-board.elf
//   node tools/qemu-board.mjs <elf> --machine netduino --seconds 6
//
// 机器名：mps2（默认，串口是 CMSDK UART，看得见输出）与 netduino（Cortex-M4，
// 但 QEMU 的 STM32 USART 模型在这一版上不往串口送字节 —— 那一档只看它跑不跑得完）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const 根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 参数 = process.argv.slice(2);
const 取 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i >= 0 && i + 1 < 参数.length ? 参数[i + 1] : 默认;
};
const 跳过 = new Set(["--machine", "--seconds", "--qemu"]);
// 第一个不是选项、也不是选项值的参数，就是 ELF 的位置。
const elf = 参数.find((a, i) => {
  if (a.startsWith("--")) return false;
  const 前 = 参数[i - 1];
  return !(前 && 跳过.has(前));
});
const 机器 = 取("--machine", "mps2");
const 秒 = Number(取("--seconds", "5"));

const 机名 = 机器 === "netduino" ? "netduinoplus2" : "mps2-an385";

if (!elf) {
  console.error("用法：node tools/qemu-board.mjs <elf> [--machine mps2|netduino] [--seconds N]");
  process.exit(2);
}

// QEMU 在哪：环境变量优先，然后是这台机器把它装的位置，最后才试 PATH。
const 候选 = [
  process.env.QEMU_SYSTEM_ARM,
  "E:/DaShaoHuo/apps/qemu/qemu-system-arm.exe",
  "qemu-system-arm",
].filter(Boolean);
let qemu = null;
for (const c of 候选) {
  if (c.includes("/") || c.includes("\\")) {
    if (fs.existsSync(c)) { qemu = c; break; }
  } else {
    qemu = c;  // 交给 PATH 去找；起不来会在下面报
    break;
  }
}

if (!qemu) {
  console.error("没有找到 qemu-system-arm —— 这一条在没装 QEMU 的机器上跳过，"
    + "而不是假装跑过。装法见 design/BOARD.txt 第十八节。");
  process.exit(2);
}

const 串口 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-qemu-")), "serial.txt");
const 子 = spawn(qemu, [
  "-M", 机名,
  "-kernel", path.resolve(elf),
  "-display", "none",
  "-monitor", "none",
  "-serial", `file:${串口}`,
], { stdio: ["ignore", "ignore", "pipe"] });

let 错 = "";
子.stderr.on("data", (d) => { 错 += d.toString(); });

const 收工 = (为什么) => {
  if (!子.killed) 子.kill("SIGKILL");
  const 出 = fs.existsSync(串口) ? fs.readFileSync(串口, "utf8") : "";
  console.log("机器     " + 机名 + "（" + (机器 === "netduino"
    ? "Cortex-M4，QEMU 这一版不往串口送字节，只看跑不跑得完"
    : "Cortex-M3，四兆 RAM —— 验逻辑，不验容量") + "）");
  console.log("时长     " + 秒 + " 秒（" + 为什么 + "）");
  console.log("串口     " + 出.length + " 字节");
  if (错.trim()) console.log("QEMU 说  " + 错.trim().split("\n").slice(0, 3).join(" / "));
  console.log("--- 串口内容 ---");
  process.stdout.write(出);
  if (出.length && !出.endsWith("\n")) process.stdout.write("\n");
  console.log("--- 结束 ---");
  process.exit(0);
};

// 程序在裸机上不会自己退出（Reset_Handler 最后是一个死循环），所以给它一个时限。
setTimeout(() => 收工("到时限"), 秒 * 1000);
子.on("exit", (码) => 收工("QEMU 自己退出，码 " + 码));
