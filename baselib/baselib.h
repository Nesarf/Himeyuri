#ifndef BASELIB_H
#define BASELIB_H

/* 基础库：给字节码机器的那块地。形状写在 design/BASELIB.txt —— 四样：分配、串、
 * 文件读写、退出。不实现闭包、异常、Map、JSON —— 那些是 JS 语义那一层的，而这条路
 * 不经过那一层。
 *
 * 接口一律 extern "C"：vm/hmyr.c 是 C11，将来两台要互相调，边界必须没有名字装饰。 */

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 分配：领一块 bytes 大的内存。第一代只领不还，与 vm/hmyr.c 自己的口径一致
 * （一个 run 很短，GC 是另一件活，写在那台机器的头注里）。bytes 为 0 时也给
 * 一块非空，因为调用方拿到 NULL 只会去猜。 */
void *baselib_alloc(size_t bytes);

/* 串：把 UTF-8 转成 UTF-16 码元 —— 字节码里的串就是这一种。返回值是
 * baselib_alloc 过的内存，末尾带一个终止 0（不计入长度）。*units 交回码元数
 * （不含终止 0），传 NULL 就不交。 */
uint16_t *baselib_utf8_to_utf16(const char *s, size_t *units);

/* 文件：读一整份进内存（baselib_alloc 的），*n 交回字节数。打不开、或者文件
 * 是空的，都返回 NULL 并把 *n 归零 —— 读不动是正常情形，调用方要能分开
 * 「没有这个文件」与「文件是空的」。 */
uint8_t *baselib_read_file(const char *path, size_t *n);

/* 退出：带一个码，机器停下来。 */
void baselib_exit(int code);

#ifdef __cplusplus
}
#endif

#endif
