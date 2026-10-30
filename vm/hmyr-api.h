/* HMYR 的嵌入接口：四个句子。设计见 design/EMBED.txt 第四节。
 *
 * 为什么句柄是 void *：宿主不该知道那台机器长什么样。它只拿一个不透明的
 * 东西，交给下一个句子，最后还回去。
 *
 * 用法（也就是那一页第四节的最小形状）：
 *
 *   #include "hmyr-api.h"
 *   hmyr_vm vm = hmyr_vm_new();
 *   if (!vm) return 1;
 *   if (hmyr_load(vm, "程序.hmoks")) return 2;
 *   double 数 = 0;
 *   if (hmyr_call(vm, "main", &数)) return 3;
 *   printf("%d\n", (int)数);
 *   hmyr_vm_free(vm);
 *
 * 三个失败各自的意思：载入失败（文件读不到、魔数不对）、没有那个函数、
 * 跑的时候那个程序自己报错。三种都由返回值区分，而不是猜。
 */
#ifndef HMYR_API_H
#define HMYR_API_H

#ifdef __cplusplus
extern "C" {
#endif

typedef void *hmyr_vm;

hmyr_vm hmyr_vm_new(void);
void    hmyr_vm_free(hmyr_vm vm);

/* 载入一个 .hmoks。返回 0 表示成功。 */
int hmyr_load(hmyr_vm vm, const char *path);

/* 调一个具名函数。返回 0 成功、1 跑的时候出错、2 没有那个函数。
 * 数出 可以是 NULL（只要副作用、不要返回值的时候）。 */
int hmyr_call(hmyr_vm vm, const char *name, double *num_out);

#ifdef __cplusplus
}
#endif

#endif /* HMYR_API_H */
