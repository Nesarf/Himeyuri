/* 板子那一侧的入口：上电之后真正跑的那一段。
 *
 * 与 port/board-check.c 的分工：那一份在桌面上走这条路（从文件读字节码、
 * 把出口打到 stdout），这一份在板子上走同一条路 —— 字节码编在映像里，
 * 出口一个字节一个字节地交给串口。两条路共用 port/arm-port.c 的平台口，
 * 所以「平台口接上了」这件事只需要验一次。
 *
 * 这里有三个约定，都是「板子上与桌面上不一样」的地方，写在这里而不是
 * 留给链接器去解释：
 *
 *   一、字节码从哪来。板子上没有文件系统，所以字节码用 objcopy 打成一个
 *       对象文件链进映像，符号名由文件名决定：program.hmyrb 进来之后就是
 *       _binary_program_hmyrb_start 与 _binary_program_hmyrb_end。
 *       没打进来的时候它是弱符号，落成空指针 —— 于是映像照样链得过，
 *       跑起来会报「读不到文件」，而不是在链接这一步失败。
 *
 *   二、没有 argv。启动文件直接把控制权交给 main，没有 argc/argv 可言。
 *       所以参数表在这里造：一个「程序名」，没有别的。板子上的「读」忽略它。
 *
 *   三、没有退出。这台机器在桌面上用 exit 表示「不行了」，板子上那个 exit
 *       是死循环（见 arm-port.c）；main 正常返回之后也一样停在启动文件的
 *       收尾循环里。停下来比复位诚实：复位会让人以为是别处的毛病。
 */
#include <stddef.h>
#include <stdint.h>

#include "../vm/hmyr-port.h"

/* 这两组由 port/arm-port.c 给出（板子与桌面共用同一份实现）。 */
void 板子装上(const uint8_t *字节码, size_t 长);
size_t 板子出口长(void);
const uint8_t *板子出口(void);

/* 打进来的字节码。弱声明，理由见文件头第一条。 */
extern const uint8_t _binary_program_hmyrb_start[] __attribute__((weak));
extern const uint8_t _binary_program_hmyrb_end[] __attribute__((weak));

/* 往串口发一个字节。板子上由 port/uart.c 给强定义把它顶掉；
 * 这一份是「还没接线」时的退路：字节被丢掉，但记着丢了多少，
 * 于是桌面上能断言「它确实想发这么多」，而不是只能断言「没崩」。
 *
 * 为什么不直接写寄存器：USART2 的地址与 PA2/PA3 的复用配置跟着板子走，
 * 写错的症状是「串口没反应」，而查它的成本远高于写它。填三个数的事，
 * 等板子到了对着手册填。 */
static size_t g_吐过 = 0;

__attribute__((weak)) void 板子吐字节(uint8_t 字节) {
  (void)字节;
  g_吐过++;
}

size_t 板子吐过(void) { return g_吐过; }

int main(void) {
  const uint8_t *码起 = _binary_program_hmyrb_start;
  size_t 长 = 0;
  if (码起) 长 = (size_t)(_binary_program_hmyrb_end - _binary_program_hmyrb_start);

  /* 装平台口，然后把字节码交出去。之后这台机器与「它跑在哪」无关。 */
  板子装上(码起, 长);

  char 名[] = "program.hmyrb";
  char *参数[1] = { 名 };
  int 退出码 = hmyr_运行(名, 1, 参数);

  /* 出口一块一块地交给串口。中途不 flush：这一份底下没有缓冲，
   * 每个字节都是一次发送 —— 板子上先要「看得见」，吞吐是后面的事。 */
  {
    const uint8_t *出 = 板子出口();
    size_t 出长 = 板子出口长();
    for (size_t i = 0; i < 出长; i++) 板子吐字节(出[i]);
  }

  return 退出码;
}
