/* Nucleo-F411RE 的串口：ST-Link 那一侧的虚拟串口接在 USART2 上。
 *
 * 为什么是这一份：port/board-main.c 里那个 板子吐字节 是弱定义（丢掉字节、只记账），
 * 这一份给它一个强定义，于是「板子上看得见输出」这件事只改一个文件。
 *
 * 三个数，都是对着这块板子的手册填的，不是猜的：
 *
 *   一、USART2 基址 0x40004400（APB1）。ST-Link 的 VCP 就挂在它上面（PA2 = TX，PA3 = RX）。
 *   二、复位后 SYSCLK 是 HSI 16 MHz，APB1 也是 16 MHz（没有配 PLL，也就没有分频）。
 *   三、115200 的 BRR：16e6 / (16 * 115200) = 8.6805，整数部分 8、小数部分 round(0.6805*16) = 11，
 *      所以 BRR = (8 << 4) | 11 = 0x8B。这一条按 F4 手册的 USART_BRR 公式算，
 *      而 8 与 11 两段都要按位放对，否则波特率差一截，收到的就是乱码。
 *
 * 一个地方与桌面不同：这里不等 TXE 之外的东西。发送寄存器空就写 —— 不查 TC、
 * 不查错误位，因为「看得见」是第一步，可靠性与吞吐是后面的事。
 */

#include <stdint.h>

#include "../vm/hmyr-port.h"

#define 寄存器(址) (*(volatile uint32_t *)(址))

#define RCC_AHB1ENR  0x40023830u
#define RCC_APB1ENR  0x40023840u
#define GPIOA_MODER  0x40020000u
#define GPIOA_AFRL   0x40020020u
#define USART2_SR    0x40004400u
#define USART2_DR    0x40004404u
#define USART2_BRR   0x40004408u
#define USART2_CR1   0x4000440Cu

#define USART_SR_TXE (1u << 7)
#define USART_CR1_UE (1u << 13)
#define USART_CR1_TE (1u << 3)

static int g_开过 = 0;

static void 开串口(void) {
  if (g_开过) return;
  g_开过 = 1;

  /* 时钟：GPIOA 在 AHB1，USART2 在 APB1。 */
  寄存器(RCC_AHB1ENR) |= (1u << 0);
  寄存器(RCC_APB1ENR) |= (1u << 17);

  /* PA2 与 PA3 设成复用（MODER = 10），复用号 AF7（AFRL 每引脚 4 位）。 */
  寄存器(GPIOA_MODER) = (寄存器(GPIOA_MODER) & ~((3u << 4) | (3u << 6))) | ((2u << 4) | (2u << 6));
  寄存器(GPIOA_AFRL) = (寄存器(GPIOA_AFRL) & ~((0xFu << 8) | (0xFu << 12))) | ((7u << 8) | (7u << 12));

  寄存器(USART2_BRR) = 0x8Bu;
  寄存器(USART2_CR1) = USART_CR1_UE | USART_CR1_TE;
}

/* 顶掉 board-main.c 里的弱定义。
 *
 * 那个 while 有上限，不是谨慎：在某些模拟环境里 USART 的 TXE 位不会置起
 * （设备在，但时钟没被使能），于是「等发送寄存器空」就变成永远。而永远卡在
 * 一个字节上，看上去与「程序根本没跑」一模一样 —— 加一个上限，至少能区分
 * 「它在等人」与「它没动」。上限之后这个字节就丢掉，计数在 g_丢过 里。 */
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
