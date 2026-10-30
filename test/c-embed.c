/* design/EMBED.txt 第四节那个最小形状的可执行版本。
 *
 * 这一个文件是「被别人调用」的判据：它自己是 C 的 main，而它做的事全是那四个句子。
 * 它不认识 Hmyr机器、不认识 Value、也不认识字节码长什么样 —— 那正是「宿主不该
 * 知道那台机器长什么样」那条规矩的可检查形式。
 *
 * 判据：程序返回 42 的时候，这一行打印 42，而 printf 的格式是 %d。
 */
#include <stdio.h>
#include "hmyr-api.h"

int main(int argc, char **argv) {
  hmyr_vm vm;
  double 数 = 0;
  int 码;

  if (argc < 2) {
    fprintf(stderr, "用法: %s 程序.hmoks\n", argv[0]);
    return 64;
  }

  vm = hmyr_vm_new();
  if (!vm) { fprintf(stderr, "HMYR-器-016 建不出句柄\n"); return 1; }

  码 = hmyr_load(vm, argv[1]);
  if (码) {
    fprintf(stderr, "HMYR-器-016 载入失败：%s\n", argv[1]);
    hmyr_vm_free(vm);
    return 2;
  }

  const char *名 = argc > 2 ? argv[2] : "main";
  码 = hmyr_call(vm, 名, &数);
  if (码) {
    fprintf(stderr, "HMYR-器-017 调用失败（返回 %d）\n", 码);
    hmyr_vm_free(vm);
    return 3;
  }

  printf("%d\n", (int)数);
  hmyr_vm_free(vm);
  return 0;
}
