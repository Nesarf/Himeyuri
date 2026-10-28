/* MPS2（QEMU 的 mps2-an385）那一侧的串口：CMSDK APB UART0。
 *
 * 为什么要有这一份：Nucleo 那一份写的是 STM32 的 USART2，而 QEMU 的 stm32f4 模型
 * 里那个 USART 的 TXE 位不会置起（设备在，时钟没被使能），于是「等发送寄存器空」
 * 永远等不到 —— 症状是「一个字节也吐不出来」。MPS2 的 CMSDK UART 是 QEMU 里
 * 支持得最完整的一块，所以先在它上面验「这台机器跑得起来」，再把同一份映像
 * 换到板子的串口上。
 *
 * 两块的差别只有寄存器布局，而那是这一份存在的全部理由：
 *
 *   CMSDK APB UART0   0x40004000   DATA +0x00 · STATE +0x04 · CTRL +0x08 · BAUDDIV +0x10
 *   STATE 的 bit0 是「发送缓冲满」，所以等的是 !(STATE & 1)，与 STM32 的 TXE 相反。
 */

#include <stdint.h>

#include "../vm/hmyr-port.h"

#define 寄存器(址) (*(volatile uint32_t *)(址))

#define UART_DATA  0x40004000u
#define UART_STATE 0x40004004u
#define UART_CTRL  0x40004008u
#define UART_BAUD  0x40004010u

#define UART_CTRL_TXEN (1u << 0)
#define UART_CTRL_RXEN (1u << 1)
#define UART_STATE_TXFULL (1u << 0)

static int g_开过 = 0;

static void 开串口(void) {
  if (g_开过) return;
  g_开过 = 1;
  寄存器(UART_BAUD) = 16u;                    /* 16 MHz / 16 = 1 Mbaud，QEMU 只看有没有值 */
  寄存器(UART_CTRL) = UART_CTRL_TXEN | UART_CTRL_RXEN;
}

static size_t g_丢过 = 0;
size_t 板子串口丢过(void) { return g_丢过; }

void 板子吐字节(uint8_t 字节) {
  开串口();
  for (int 等 = 0; 等 < 200000; 等++) {
    if ((寄存器(UART_STATE) & UART_STATE_TXFULL) == 0) {
      寄存器(UART_DATA) = (uint32_t)字节;
      return;
    }
  }
  g_丢过++;
}
