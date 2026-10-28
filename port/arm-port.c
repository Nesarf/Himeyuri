/* 一块没有文件系统的板子上，这台机器怎么跑起来：一个最小的移植骨架。
 *
 * 它做三件事，都是板子那一侧的事：把烧在 Flash 里的那一段字节码交出去、
 * 把要打印的字节收进一个缓冲区、以及告诉 hmyr.c「读与写这样办」。
 *
 * 真要上板子还要两样东西，而它们不属于这一份：启动文件（向量表、Reset_Handler、
 * 堆栈初始化）与链接脚本（Flash 与 RAM 怎么摆）。Keil 那边是 startup_*.s 与 .sct。
 *
 * 这一份存在的理由是让「差什么」变成「差两个文件」，而不是一段散文。
 */
#include <stddef.h>
#include <stdint.h>

#include "../vm/hmyr-port.h"

/* 烧在 Flash 里的字节码。真实项目里由链接脚本给出地址，或者由烧写工具写进一块固定区域；
 * 这里用两个变量代替，装的时候传进来。 */
static const uint8_t *g_程序 = 0;
static size_t g_程序长 = 0;

/* 出口：一块固定大小的缓冲。板子上换成 UART 发一个字节即可 ——
 * 写满就丢了，是真的丢，不装作成功。
 *
 * volatile 是为了让这个示例诚实：不加它，编译器会看出「只写不读」，
 * 把整块缓冲优化掉，于是尺寸报告里看不到这四 KB —— 而那四 KB 是真的要占的。 */
#define 出口大小 4096
static volatile uint8_t g_出口[出口大小];
static size_t g_出口长 = 0;

static int 板子读(const char *路径, uint8_t **出, size_t *长) {
  (void)路径;                       /* 板子上只有一个「文件」：那份字节码 */
  if (!g_程序) return 0;
  *出 = (uint8_t *)g_程序;
  *长 = g_程序长;
  return 1;
}

static void 板子写(const uint8_t *p, size_t n) {
  for (size_t i = 0; i < n; i++) {
    if (g_出口长 < 出口大小) g_出口[g_出口长++] = p[i];
  }
}

/* 板子的入口调用它：装平台、给出字节码。之后就可以调 hmyr 那边的主流程。 */
void 板子装上(const uint8_t *字节码, size_t 长) {
  g_程序 = 字节码;
  g_程序长 = 长;
  Hmyr平台 口 = { 板子读, 板子写 };
  hmyr_装平台(&口);
}

/* 给测试与调试用：已经收到的字节数，以及清空。 */
size_t 板子出口长(void) { return g_出口长; }
const uint8_t *板子出口(void) { return (const uint8_t *)g_出口; }
void 板子清出口(void) { g_出口长 = 0; }

/* ---- 板子那一侧的 C 库适配 ------------------------------------------
 *
 * 链接时撞到的三个符号，都是「桌面有、裸机没有」的那一类：
 *
 *   __initial_sp  启动文件与链接脚本共用的栈顶（现在由 startup_cm4.s 给出）
 *   atexit        只有 HMYR_MEM 那条诊断路径会调它；裸机上没有，也就不记
 *   exit          这一台用它表示「不行了」。板子上它能做的只有停下来 ——
 *                 要么死循环，要么复位。死循环是更诚实的那一个：复位会让人
 *                 以为是别处的毛病，而停在那里至少能接调试器看栈。
 *
 * getenv 也一样：microlib 没有它。给一个「什么都没有」的版本，
 * 于是所有靠环境变量打开的诊断开关在这块板子上就是关着的 —— 这正是想要的。
 */
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
char *getenv(const char *名) { (void)名; return 0; }
int atexit(void (*函数)(void)) { (void)函数; return 0; }
void exit(int 码) { (void)码; for (;;) { } }

/* _sbrk：把堆往上推，但**不越过栈**。
 *
 * 为什么必须自己写：库里那一个只推指针、不检查，于是「堆用超了」不表现为
 * 分配失败，而是表现为「悄悄踩进栈」。design/BOARD.txt 第九节记的就是这件事 ——
 * 桌面上量到 hello 的堆峰值 92 KB，加静态段与栈共 148 KB，超过板子的 128 KB，
 * 而它在板上居然跑通了。两种解释只能留一个：要么堆没越界，要么越界了没被发现。
 *
 * 这一份让第二种解释不再可能：越过界线就返回 -1，于是 malloc 失败，
 * 而 hmyr.c 那边会把它当成一次分配失败来报。
 *
 * 界线从链接脚本拿：end 是 .bss 的末尾，_estack 是栈顶。
 * 栈那一段要先扣掉 —— 那是 link.ld 给 8 KB，两处不一致时症状是「栈一深就进 HardFault」。 */
#ifndef HMYR_HEAP_STACK_RESERVE
#define HMYR_HEAP_STACK_RESERVE (8u * 1024u)
#endif

extern char end;
extern char _estack;

void *_sbrk(ptrdiff_t 增) {
  static char *当前 = 0;
  if (当前 == 0) 当前 = &end;
  char *界 = (char *)((uintptr_t)&_estack - HMYR_HEAP_STACK_RESERVE);
  if (当前 + 增 > 界) return (void *)-1;   /* 不越界；让 malloc 老老实实失败 */
  char *旧 = 当前;
  当前 += 增;
  return (void *)旧;
}
#endif

