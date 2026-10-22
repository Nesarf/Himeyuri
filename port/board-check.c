/* 桌面上的自检：把「板子上那条路」原样走一遍。
 *
 * 路径与板子一致：字节码在内存里、由 板子装上 交给平台口、然后调 hmyr_运行。
 * 差别只在最后一步 —— 这里的「出口」是一块缓冲，自检把它打印出来。
 *
 * 这一份存在的理由：板子那一侧没有硬件也能验的那部分，正是这里。
 * 它证明的是「平台口接上之后，这台机器还能跑一段字节码并交出正确的输出」，
 * 而不是「它在某颗芯片上跑起来了」—— 后者要硬件。
 */
#include <stdio.h>
#include <stdlib.h>

#include "../vm/hmyr-port.h"

/* 这两个由 port/arm-port.c 给出（桌面与板子共用同一份实现）。 */
void 板子装上(const uint8_t *字节码, size_t 长);
size_t 板子出口长(void);
void 板子清出口(void);

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: board-check program.hmyrb\n");
    return 2;
  }
  FILE *f = fopen(argv[1], "rb");
  if (!f) {
    fprintf(stderr, "board-check: cannot open %s\n", argv[1]);
    return 2;
  }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  uint8_t *字节码 = (uint8_t *)malloc((size_t)(n > 0 ? n : 1));
  if (!字节码) { fclose(f); fprintf(stderr, "board-check: out of memory\n"); return 2; }
  size_t 读入 = fread(字节码, 1, (size_t)n, f);
  fclose(f);

  板子装上(字节码, 读入);
  /* 参数与板子上的调用一致：一个「程序名」，没有别的。 */
  char *参数[1] = { (char *)argv[1] };
  int 码 = hmyr_运行(argv[1], 1, 参数);
  /* 出口在板子那一侧是一块缓冲 —— 这里把它原样交出去，
   * 于是「板子那条路」在桌面上也能被看见、被断言。 */
  {
    extern const uint8_t *板子出口(void);
    const uint8_t *出 = 板子出口();
    size_t 长 = 板子出口长();
    fprintf(stderr, "board-check: 出口 %zu 字节\n", 长);
    fwrite(出, 1, 长, stdout);
    if (长 == 0 || 出[长 - 1] != '\n') fputc('\n', stdout);
  }
  printf("exit %d\n", 码);
  return 0;
}
