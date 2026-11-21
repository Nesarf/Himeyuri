/* 基础库的最小实现。四样都在，每一行都与 design/BASELIB.txt 的形状对得上。
 * 这是第一块砖：让判据有一个可以跑的东西，而不是一份只在纸上的接口。 */

#include "baselib.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

void *baselib_alloc(size_t bytes) {
  return std::malloc(bytes ? bytes : 1);
}

/* 转换分两趟：第一趟数码元，第二趟写。两趟读法必须一字不差，所以读码点那一小段
 * 写成一个函数，改一处两趟一起变 —— 分开写两遍，改坏一趟时另一趟还是旧的。 */
static unsigned 读码点(const unsigned char *p, int *步) {
  if (*p < 0x80) { *步 = 1; return *p; }
  if ((*p & 0xE0) == 0xC0) { *步 = 2; return ((*p & 0x1F) << 6) | (p[1] & 0x3F); }
  if ((*p & 0xF0) == 0xE0) { *步 = 3; return ((*p & 0x0F) << 12) | ((p[1] & 0x3F) << 6) | (p[2] & 0x3F); }
  *步 = 4; return ((*p & 0x07) << 18) | ((p[1] & 0x3F) << 12) | ((p[2] & 0x3F) << 6) | (p[3] & 0x3F);
}

uint16_t *baselib_utf8_to_utf16(const char *s, size_t *units) {
  const unsigned char *p = (const unsigned char *)s;
  size_t n = 0;
  while (*p) {
    int 步 = 0;
    unsigned cp = 读码点(p, &步);
    p += 步;
    n += (cp > 0xFFFF) ? 2 : 1;
  }
  uint16_t *out = (uint16_t *)baselib_alloc((n + 1) * sizeof(uint16_t));
  size_t i = 0;
  p = (const unsigned char *)s;
  while (*p) {
    int 步 = 0;
    unsigned cp = 读码点(p, &步);
    p += 步;
    if (cp > 0xFFFF) {
      cp -= 0x10000;
      out[i++] = (uint16_t)(0xD800 + (cp >> 10));
      out[i++] = (uint16_t)(0xDC00 + (cp & 0x3FF));
    } else {
      out[i++] = (uint16_t)cp;
    }
  }
  out[i] = 0;
  if (units) *units = i;
  return out;
}

uint8_t *baselib_read_file(const char *path, size_t *n) {
  FILE *f = std::fopen(path, "rb");
  if (!f) { if (n) *n = 0; return NULL; }
  if (std::fseek(f, 0, SEEK_END) != 0) { std::fclose(f); if (n) *n = 0; return NULL; }
  long len = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  uint8_t *buf = (uint8_t *)baselib_alloc(len > 0 ? (size_t)len : 1);
  size_t got = std::fread(buf, 1, len > 0 ? (size_t)len : 1, f);
  std::fclose(f);
  if (n) *n = got;
  return buf;
}

void baselib_exit(int code) {
  std::exit(code);
}
