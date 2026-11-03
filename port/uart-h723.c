/* STM32H723ZG 的串口：USART2，逻辑与 uart.c 逐字相同，三个常量换成 H7 的。
 *
 * 为什么另开一份而不在里面加 #ifdef：与 port/ 里那两份链接脚本、两份启动文件、
 * 两份串口的理由一样 —— 换芯片时改的是「地址与时钟」这几个数，而一份文件里放
 * 两套地址，最容易出的错是改了这边忘了那边。Makefile 的 UART 旋钮就是为这个留的。
 *
 * 三个数，对着 RM0468 填的（不是照 F4 的映射推的，因为 H7 把它挪过）：
 *
 *   一、RCC 从 0x40023800 搬到了 0x58024400。GPIOA 的时钟在 RCC_AHB4ENR
 *      （偏移 0xE0，bit 0），USART2 的时钟在 RCC_APB1LENR（偏移 0xE8，bit 17）。
 *      注意 H7 的 APB1 使能寄存器拆成了 L 与 H 两个，这个位在低半。
 *   二、GPIOA 从 0x40020000 搬到了 0x58020000。MODER 与 AFRL 的偏移不变，
 *      PA2/PA3 的复用号仍是 AF7。
 *   三、USART2 仍在 0x40004400，而 H7 复位后 SYSCLK 是 HSI 64 MHz（F4 是 16）。
 *      于是 BRR 重算：64e6 / (16 × 115200) = 34.72，整数 34、小数 round(0.72×16) = 12，
 *      BRR = (34 << 4) | 12 = 0x22C。算法与 F4 那份相同，变的只是被除数 ——
 *      而 BRR 算错不会报错，只会让人看到一串乱码。
 *
 * 一个 H7 才有的细节：这颗的 USART 带 FIFO（CR1.FIFOEN），默认关着，所以 DR
 * 仍然是「写一个字节」的语义。要用 FIFO 得改这里，但那是吞吐的事，不是「看得见」的事。
 */

#include <stdint.h>

#include "../vm/hmyr-port.h"

#define 寄存器(址) (*(volatile uint32_t *)(址))

#define RCC_BASE      0x58024400u
#define RCC_AHB4ENR   (RCC_BASE + 0xE0u)
#define RCC_APB1LENR  (RCC_BASE + 0xE8u)
#define GPIOA_BASE    0x58020000u
#define GPIOA_MODER   (GPIOA_BASE + 0x00u)
#define GPIOA_AFRL    (GPIOA_BASE + 0x20u)
#define USART2_SR     0x40004400u
#define USART2_DR     0x40004404u
#define USART2_BRR    0x40004408u
#define USART2_CR1    0x4000440Cu

#define USART_SR_TXE (1u << 7)
#define USART_CR1_UE (1u << 13)
#define USART_CR1_TE (1u << 3)

static int g_开过 = 0;

static void 开串口(void) {
  if (g_开过) return;
  g_开过 = 1;

  /* 时钟：GPIOA 在 AHB4，USART2 在 APB1 的低半。 */
  寄存器(RCC_AHB4ENR) |= (1u << 0);
  寄存器(RCC_APB1LENR) |= (1u << 17);

  /* PA2 与 PA3 设成复用（MODER = 10），复用号 AF7（AFRL 每引脚 4 位）。 */
  寄存器(GPIOA_MODER) = (寄存器(GPIOA_MODER) & ~((3u << 4) | (3u << 6))) | ((2u << 4) | (2u << 6));
  寄存器(GPIOA_AFRL) = (寄存器(GPIOA_AFRL) & ~((0xFu << 8) | (0xFu << 12))) | ((7u << 8) | (7u << 12));

  寄存器(USART2_BRR) = 0x22Cu;
  寄存器(USART2_CR1) = USART_CR1_UE | USART_CR1_TE;
}

/* 顶掉 board-main.c 里的弱定义。
 *
 * 那个 while 有上限，理由与 uart.c 里写的一样：某些模拟环境里 TXE 不会置起，
 * 于是「等发送寄存器空」变成永远，而永远卡在一个字节上看上去与「程序没跑」一样。 */
static size_t g_丢过 = 0;
size_t 板子串口丢过(void) { return g_丢过; }

void 板子吐字节(uint8_t 字节) {
  开串口();
  for (int 等 = 0; 等 < 200000; 等++) {
    if (寄存器(USART2_SR) & USART_SR_TXE) {
      寄存器(USART2_DR) = (uint32_t)字节;
      return;
    }
  }
  g_丢过++;
}
