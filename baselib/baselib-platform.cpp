/* 第一次互相调：把 baselib 的读文件装进 vm 的平台口。
 *
 * vm/hmyr.c 与「它跑在哪」之间只有两个约定（vm/hmyr-port.h）：怎么读一个文件的
 * 字节、怎么把一段字节写出去。桌面默认是 fopen 与 stdout；这一份把「读」换成
 * baselib_read_file，写与错误不装（退回桌面默认），于是整台机器只有读文件那一下
 * 经过基础库。
 *
 * 这不是为了更快 —— baselib_read_file 与 vm 自己的桌面读文件做的是同一件事。
 * 它验的是形状：design/BASELIB.txt 说基础库给「文件读写」，而 vm 的读口要的
 * 正好是这个签名。装得上、跑得对，形状就对了；装不上，说明那份形状里有一句
 * 是错的。
 *
 * 用法：gcc -std=c11 -c -DHMYR_NO_MAIN vm/hmyr.c -o hmyr.o
 *       g++ -std=c++17 -I baselib -I vm baselib/baselib.cpp baselib/baselib-platform.cpp hmyr.o -o baselib-host
 *       baselib-host program.hmoks [arguments]
 */
#include "baselib.h"
#include "hmyr-port.h"

#include <cstdio>

static int 读(const char *路径, uint8_t **出, size_t *长) {
  uint8_t *p = baselib_read_file(路径, 长);
  if (!p) return 0;
  *出 = p;
  return 1;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: baselib-host program.hmoks [arguments]\n");
    return 2;
  }
  Hmyr平台 台 = { 读, NULL, NULL };
  hmyr_装平台(&台);
  return hmyr_运行(argv[1], argc - 1, argv + 1);
}
