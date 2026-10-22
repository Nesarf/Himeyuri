/* hmyr.c -- a bytecode machine for HMYR, in C.
 *
 * Why this file exists: the language can already interpret itself, but the
 * machine at the bottom of that stack is JavaScript. This is the same machine,
 * written so that it is not. It reads the .hmyrb format that src/code-file.mjs
 * writes and executes it. It knows nothing about HMYR syntax -- only the
 * instruction stream -- which is the point: it is the machine, not the language.
 *
 * Scope of this first version, stated so nobody has to guess:
 *   - opcodes: all of them
 *   - builtins: print, print_err, str, len, chr, ord, to_int, slice
 *     anything else reports HMYR-R0104 and stops
 *   - memory: values are allocated and never freed (a run is short; a GC is a
 *     different piece of work)
 *   - numbers are printed with %.15g, which agrees with the JavaScript side on
 *     integers and short fractions but not on every value; the exact
 *     shortest-round-trip formatter is src/decimal.mjs and porting it is work
 *     for a later round
 *
 * Build:  gcc -std=c11 -O2 -o hmyr-vm vm/hmyr.c
 * Run:    ./hmyr-vm program.hmyrb
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <process.h>
#elif !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
/* 裸机的 C 库没有 unistd.h —— ARM 那一边 pid 也没有意义（见 临时路径）。 */
#include <unistd.h>
#endif

/* 按 UTF-8 的路径开文件。
 *
 * 为什么需要这一条：Windows 的 fopen 按 ANSI 代码页解释路径，
 * 于是「三行.txt」这种名字在 fopen 那里就是另一个不存在的东西 ——
 * 而这一门语言里路径是 UTF-8 的串（或 UTF-16，转成 UTF-8 交过来）。
 * 所以先转成宽字符再开，别让操作系统的默认代码页决定哪些文件读得到。
 *
 * 非 Windows 的机器上 utf8 就是它认的那个字节串，直接交给 fopen。 */
static FILE *开文件(const char *utf8, const char *模式) {
#ifdef _WIN32
  int 宽长 = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
  if (宽长 <= 0) return NULL;
  wchar_t *宽 = (wchar_t *)malloc((size_t)宽长 * sizeof(wchar_t));
  if (!宽) return NULL;
  MultiByteToWideChar(CP_UTF8, 0, utf8, -1, 宽, 宽长);
  int 宽模长 = MultiByteToWideChar(CP_UTF8, 0, 模式, -1, NULL, 0);
  wchar_t 宽模[8];
  if (宽模长 <= 0 || 宽模长 > 8) { free(宽); return NULL; }
  MultiByteToWideChar(CP_UTF8, 0, 模式, -1, 宽模, 宽模长);
  FILE *f = _wfopen(宽, 宽模);
  free(宽);
  return f;
#else
  return fopen(utf8, 模式);
#endif
}

/* Two range tables generated from the Unicode corpus by tools/ucd-c.mjs.
 * They live in the repository as C arrays so this machine can answer "is this
 * a letter" without borrowing anybody's table at run time. */
#include "ucd-letter.h"
#include "ucd-mark.h"

/* Unicode 的大小写表，由 tools/ucd-case.mjs 按全码点生成 —— 不是抽样，
 * 于是这张表不会漏掉任何一个字符。归一化那三张表也是同一个来历，
 * 见 tools/ucd-nfc.mjs。 */
#include "ucd-case.h"
#include "ucd-nfc.h"

/* ---- 堆记账：这台机器分配了不回收 ------------------------------------
 *
 * 「没有 GC」这句话需要一个数字跟着，否则它既不能被验收，也不能被发现变坏。
 * 做法是每次分配多要八个字节，把那块有多大记在自己头上；于是「此刻活着多少」
 * 与「峰到多少」都是实测的，不是估的。代价是八个字节与一次加减法。
 *
 * 打开 HMYR_MEM 就在退出时打印一行。默认不出声：平常跑程序的人不需要看它。
 * 名字带前缀是因为 free 进来的指针要往回收那八个字节，四个都换掉了。
 */
static size_t g_mem_live = 0;
static size_t g_mem_peak = 0;

/* 分配上限。默认四吉字节 —— 这台机器没有回收，于是一个平方级的累积能把
 * 整台机器的内存吃满，而「没有 GC」不等于「可以吃满」。
 * 超过就明确退出（退出码 71），不让操作系统去收拾。
 * HMYR_MEM_LIMIT 改这个数（兆字节）；给 0 表示不限，只给查的人用。 */
static size_t g_mem_limit = (size_t)4 * 1024 * 1024 * 1024;

/* 让路：这台机器不只跑这一个程序。可用物理内存低于这道水位时先歇一下，
 * 等别人走完再分配；一直低就明确退出 —— 把内存吃满会触发系统那一层的内存压缩，
 * 整机跟着卡，那比这个程序失败严重得多。 */
#define 水位 ((size_t)1536 * 1024 * 1024)
#define 每查一次 ((size_t)1024 * 1024)

static size_t g_mem_since_check = 0;

static size_t 空闲物理(void) {
#ifdef _WIN32
  MEMORYSTATUSEX 状;
  状.dwLength = sizeof 状;
  if (!GlobalMemoryStatusEx(&状)) return (size_t)-1;
  return (size_t)状.ullAvailPhys;
#else
  return (size_t)-1;   /* 别的机器上先不判断，留给那一侧的移植 */
#endif
}

static void 让一让(size_t n) {
  g_mem_since_check += n;
  if (g_mem_since_check < 每查一次) return;
  g_mem_since_check = 0;
  size_t 空 = 空闲物理();
  if (空 == (size_t)-1) return;
  if (空 > 水位) return;
  /* 排队，不退出：等别人把内存让出来。这个程序慢一点没关系，
   * 而它一退出就等于「别人的机器状态决定了我能不能干活」——
   * 那种结果比慢一秒糟得多。等的时候打印一次，免得看起来像卡死。 */
  fprintf(stderr,
          "hmyr: waiting for memory (%llu MB free, low-water %llu MB) — other programmes go first\n",
          (unsigned long long)(空 / (1024 * 1024)),
          (unsigned long long)(水位 / (1024 * 1024)));
  for (;;) {
#ifdef _WIN32
    Sleep(50);
#endif
    空 = 空闲物理();
    if (空 == (size_t)-1 || 空 > 水位) return;
  }
}

static void *(*const 原malloc)(size_t) = malloc;
static void *(*const 原realloc)(void *, size_t) = realloc;
static void (*const 原free)(void *) = free;

static void 记一笔(size_t n) {
  g_mem_live += n;
  if (g_mem_live > g_mem_peak) g_mem_peak = g_mem_live;
  if (g_mem_limit && g_mem_live > g_mem_limit) {
    fprintf(stderr,
            "hmyr: this run went past its memory limit: %llu MB allocated and nothing is reclaimed "
            "(limit %llu MB; HMYR_MEM_LIMIT changes it, 0 means no limit)\n",
            (unsigned long long)(g_mem_live / (1024 * 1024)),
            (unsigned long long)(g_mem_limit / (1024 * 1024)));
    exit(71);
  }
  让一让(n);
}

static void *hm_malloc(size_t n) {
  unsigned char *p = (unsigned char *)原malloc(n + sizeof(size_t));
  if (!p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  *(size_t *)p = n;
  记一笔(n);
  return p + sizeof(size_t);
}

static void *hm_calloc(size_t a, size_t b) {
  size_t n = a * b;
  void *p = hm_malloc(n);
  memset(p, 0, n);
  return p;
}

static void *hm_realloc(void *q, size_t n) {
  if (!q) return hm_malloc(n);
  unsigned char *真 = (unsigned char *)q - sizeof(size_t);
  size_t 旧 = *(size_t *)真;
  真 = (unsigned char *)原realloc(真, n + sizeof(size_t));
  if (!真) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  *(size_t *)真 = n;
  g_mem_live -= 旧;
  记一笔(n);
  return 真 + sizeof(size_t);
}

static void hm_free(void *q) {
  if (!q) return;
  unsigned char *真 = (unsigned char *)q - sizeof(size_t);
  g_mem_live -= *(size_t *)真;
  原free(真);
}

static void 堆账报一下(void) {
  fprintf(stderr, "hmyr: heap live %llu bytes, peak %llu bytes, nothing reclaimed\n",
          (unsigned long long)g_mem_live, (unsigned long long)g_mem_peak);
}

#define malloc(n) hm_malloc(n)
#define calloc(a, b) hm_calloc(a, b)
#define realloc(p, n) hm_realloc(p, n)
#define free(p) hm_free(p)

static int in_ranges(const uint32_t *r, size_t count, uint32_t cp) {
  size_t lo = 0, hi = count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (cp < r[mid * 2]) hi = mid;
    else if (cp > r[mid * 2 + 1]) lo = mid + 1;
    else return 1;
  }
  return 0;
}

/* ---- 码点与大小写 ---------------------------------------------------- */

/* 词尾的那个大写 sigma 与它作为词尾时的形状。这两个码点各只有一个，
 * 所以 Final_Sigma 的规则可以直接写在这一层，不必再造一张表。 */
#define CP_CAPITAL_SIGMA 0x03A3u
#define CP_FINAL_SIGMA   0x03C2u

static const HmyrCaseEntry *case_find(const HmyrCaseEntry *tab, size_t count, uint32_t cp) {
  size_t lo = 0, hi = count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (cp < tab[mid].cp) hi = mid;
    else if (cp > tab[mid].cp) lo = mid + 1;
    else return &tab[mid];
  }
  return NULL;
}

/* 从第 i 个单元读一个码点，交回用掉了几个单元（一或二）。
 * 落单的代理单元按它自己算 —— 那不是一个字符，但也不该让整串断掉。 */
static int cp_at(const uint16_t *s, uint32_t n, uint32_t i, uint32_t *out) {
  if (i >= n) { *out = 0; return 0; }
  uint16_t u = s[i];
  if (u >= 0xD800u && u <= 0xDBFFu && i + 1 < n && s[i + 1] >= 0xDC00u && s[i + 1] <= 0xDFFFu) {
    *out = 0x10000u + (((uint32_t)u - 0xD800u) << 10) + ((uint32_t)s[i + 1] - 0xDC00u);
    return 2;
  }
  *out = u;
  return 1;
}

/* 往回退一个码点：i 是某个码点的起点，交回它前面那个码点的起点。 */
static uint32_t cp_before(const uint16_t *s, uint32_t i) {
  if (i == 0) return 0;
  if (i >= 2 && s[i - 1] >= 0xDC00u && s[i - 1] <= 0xDFFFu
      && s[i - 2] >= 0xD800u && s[i - 2] <= 0xDBFFu) return i - 2;
  return i - 1;
}

/* Final_Sigma：这个词尾的 sigma 前面要有「有大小写的」字符，后面不许有。
 * 两边都允许隔着若干「大小写可忽略」的东西 —— 组合记号、修饰符那一类。
 * 少了这一条，小写只在词中间那一半是对的，而两半在屏幕上一样像。 */
static int final_sigma(const uint16_t *s, uint32_t n, uint32_t at) {
  uint32_t i = at;
  int 前面有 = 0;
  while (i > 0) {
    i = cp_before(s, i);
    uint32_t cp = 0;
    cp_at(s, n, i, &cp);
    if (in_ranges(ucd_case_ignorable_ranges, ucd_case_ignorable_ranges_count, cp)) continue;
    if (in_ranges(ucd_cased_ranges, ucd_cased_ranges_count, cp)) 前面有 = 1;
    break;
  }
  if (!前面有) return 0;
  uint32_t j = at + 1;
  while (j < n) {
    uint32_t cp = 0;
    int 用 = cp_at(s, n, j, &cp);
    if (in_ranges(ucd_case_ignorable_ranges, ucd_case_ignorable_ranges_count, cp)) { j += (uint32_t)用; continue; }
    if (in_ranges(ucd_cased_ranges, ucd_cased_ranges_count, cp)) return 0;
    break;
  }
  return 1;
}

/* ---- 归一化 ---------------------------------------------------------- */

/* 韩文音节是一段算法，不是一张表：初、中、终三个字母拼一个音节。
 * 那一万一千多项若摊进表里，全是同一条算术，所以只写这一条。 */
#define CP_HANGUL_S_BASE 0xAC00u
#define CP_HANGUL_L_BASE 0x1100u
#define CP_HANGUL_V_BASE 0x1161u
#define CP_HANGUL_T_BASE 0x11A7u
#define HANGUL_L_COUNT 19u
#define HANGUL_V_COUNT 21u
#define HANGUL_T_COUNT 28u
#define HANGUL_N_COUNT (HANGUL_V_COUNT * HANGUL_T_COUNT)
#define HANGUL_S_COUNT (HANGUL_L_COUNT * HANGUL_N_COUNT)

static const HmyrDecompEntry *decomp_find(uint32_t cp) {
  size_t lo = 0, hi = ucd_decomp_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (cp < ucd_decomp[mid].cp) hi = mid;
    else if (cp > ucd_decomp[mid].cp) lo = mid + 1;
    else return &ucd_decomp[mid];
  }
  return NULL;
}

static uint8_t ccc_of(uint32_t cp) {
  size_t lo = 0, hi = ucd_ccc_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (cp < ucd_ccc[mid].cp) hi = mid;
    else if (cp > ucd_ccc[mid].cp) lo = mid + 1;
    else return ucd_ccc[mid].ccc;
  }
  return 0;
}

static int comp_find(uint32_t a, uint32_t b, uint32_t *out) {
  size_t lo = 0, hi = ucd_comp_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    const HmyrCompEntry *e = &ucd_comp[mid];
    if (a < e->a || (a == e->a && b < e->b)) hi = mid;
    else if (a > e->a || (a == e->a && b > e->b)) lo = mid + 1;
    else { *out = e->cp; return 1; }
  }
  return 0;
}

/* 一串码点，会长的。分解、排序、组合三步接力用它。 */
typedef struct { uint32_t *p; size_t n, cap; } CpBuf;

static void cp_push(CpBuf *b, uint32_t cp) {
  if (b->n == b->cap) {
    b->cap = b->cap ? b->cap * 2 : 64;
    b->p = (uint32_t *)realloc(b->p, b->cap * sizeof(uint32_t));
    if (!b->p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  }
  b->p[b->n++] = cp;
}

/* 分解到底：表里存的已经是全分解，所以这里只查一次；韩文音节按算法摊开。 */
static void decomp_into(CpBuf *out, uint32_t cp) {
  if (cp >= CP_HANGUL_S_BASE && cp < CP_HANGUL_S_BASE + HANGUL_S_COUNT) {
    uint32_t s = cp - CP_HANGUL_S_BASE;
    cp_push(out, CP_HANGUL_L_BASE + s / HANGUL_N_COUNT);
    cp_push(out, CP_HANGUL_V_BASE + (s % HANGUL_N_COUNT) / HANGUL_T_COUNT);
    if (s % HANGUL_T_COUNT) cp_push(out, CP_HANGUL_T_BASE + (s % HANGUL_T_COUNT));
    return;
  }
  const HmyrDecompEntry *e = decomp_find(cp);
  if (e) {
    for (uint16_t k = 0; k < e->n; k++) cp_push(out, e->u[k]);
    return;
  }
  cp_push(out, cp);
}

/* 规范次序：组合类大的记号往前拱，遇到起头（类为零）就停。
 * 稳定 —— 类相同的两个不换位，于是同一串输入总有同一个输出。 */
static void canon_order(CpBuf *b) {
  for (size_t i = 1; i < b->n; i++) {
    uint8_t c = ccc_of(b->p[i]);
    if (c == 0) continue;
    size_t j = i;
    while (j > 0) {
      uint8_t prev = ccc_of(b->p[j - 1]);
      if (prev <= c) break;      /* 零也是「不大于」，于是起头处自然停住 */
      uint32_t t = b->p[j - 1];
      b->p[j - 1] = b->p[j];
      b->p[j] = t;
      j--;
    }
  }
}

/* 韩文的组合也是算法：初声加中声成一个音节，那个音节再加终声成一个带收音的音节。
 * 表里没有这些对，因为它们不是数据 —— 一条算术生成一万多个音节。 */
static int hangul_compose(uint32_t a, uint32_t b, uint32_t *out) {
  if (a >= CP_HANGUL_L_BASE && a < CP_HANGUL_L_BASE + HANGUL_L_COUNT
      && b >= CP_HANGUL_V_BASE && b < CP_HANGUL_V_BASE + HANGUL_V_COUNT) {
    *out = CP_HANGUL_S_BASE
      + ((a - CP_HANGUL_L_BASE) * HANGUL_V_COUNT + (b - CP_HANGUL_V_BASE)) * HANGUL_T_COUNT;
    return 1;
  }
  if (a >= CP_HANGUL_S_BASE && a < CP_HANGUL_S_BASE + HANGUL_S_COUNT
      && (a - CP_HANGUL_S_BASE) % HANGUL_T_COUNT == 0
      && b > CP_HANGUL_T_BASE && b < CP_HANGUL_T_BASE + HANGUL_T_COUNT) {
    *out = a + (b - CP_HANGUL_T_BASE);
    return 1;
  }
  return 0;
}

/* 组合：拿最后一个起头去试，中间隔着类不小于它的记号就不试（阻塞）。
 * 合成成功之后那个记号就没了，于是「中间什么都没有」这件事要重新成立 ——
 * 这正是 last_cc 归零的意思，也是三个韩文字母能一路拼成一个音节的原因。 */
static void compose_all(CpBuf *b) {
  if (b->n == 0) return;
  size_t starter = 0;
  int 有起头 = ccc_of(b->p[0]) == 0;
  uint8_t last_cc = 有起头 ? 0 : ccc_of(b->p[0]);
  size_t i = 1;
  while (i < b->n) {
    uint8_t cc = ccc_of(b->p[i]);
    uint32_t 合成 = 0;
    if (有起头 && (last_cc == 0 || last_cc < cc)
        && (hangul_compose(b->p[starter], b->p[i], &合成) || comp_find(b->p[starter], b->p[i], &合成))) {
      b->p[starter] = 合成;
      if (i + 1 < b->n) memmove(&b->p[i], &b->p[i + 1], (b->n - i - 1) * sizeof(uint32_t));
      b->n--;
      last_cc = 0;
      continue;
    }
    if (cc == 0) { starter = i; 有起头 = 1; }
    last_cc = cc;
    i++;
  }
}

/* ---- values ---------------------------------------------------------- */

typedef enum { T_NULL, T_NUM, T_STR, T_BOOL, T_TUPLE, T_RECORD } Tag;

typedef struct Value Value;

typedef struct {
  const uint16_t **names;      /* field names, one allocation per name */
  uint32_t *name_lens;
  Value *vals;
  uint32_t n;
} Record;

struct Value {
  Tag tag;
  double num;
  int boolean;
  const uint16_t *s;   /* string: points into the file image, or into a heap copy */
  uint32_t slen;
  Value *items;        /* tuple items */
  uint32_t ilen;
  Record rec;
};

static Value v_null(void) { Value v; memset(&v, 0, sizeof v); v.tag = T_NULL; return v; }
static Value v_num(double n) { Value v = v_null(); v.tag = T_NUM; v.num = n; return v; }
static Value v_bool(int b) { Value v = v_null(); v.tag = T_BOOL; v.boolean = b ? 1 : 0; return v; }
static Value v_str(const uint16_t *p, uint32_t len) {
  Value v = v_null(); v.tag = T_STR; v.s = p; v.slen = len; return v;
}

static Value *alloc_values(uint32_t n) {
  Value *p = (Value *)calloc(n ? n : 1, sizeof(Value));
  if (!p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  return p;
}

/* 大小写：逐码点查表。上界是「每个单元都摊成三份」，因为表里最长的一条是三个单元。 */
static Value case_fold(Value s, int up) {
  const HmyrCaseEntry *tab = up ? ucd_upper_map : ucd_lower_map;
  size_t count = up ? ucd_upper_map_count : ucd_lower_map_count;
  const uint16_t *src = s.s;
  uint32_t n = s.slen;
  uint16_t *p = (uint16_t *)malloc((size_t)((size_t)n * 3 + 1) * sizeof(uint16_t));
  if (!p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  uint32_t i = 0, out = 0;
  while (i < n) {
    uint32_t cp = 0;
    int 用 = cp_at(src, n, i, &cp);
    if (!up && cp == CP_CAPITAL_SIGMA && final_sigma(src, n, i)) {
      p[out++] = (uint16_t)CP_FINAL_SIGMA;
    } else {
      const HmyrCaseEntry *e = case_find(tab, count, cp);
      if (e) {
        for (uint16_t k = 0; k < e->n; k++) p[out++] = e->u[k];
      } else {
        for (int k = 0; k < 用; k++) p[out++] = src[i + (uint32_t)k];
      }
    }
    i += (uint32_t)用;
  }
  return v_str(p, out);
}

/* 归一化：分解到底、按组合类排好、再尽量组合回去 —— NFC 就这三步。
 * 三张表都在 vm/ucd-nfc.h 里，来路是 data/ucd 的语料，于是这台机器
 * 不再借宿主的 normalize，也不再把文本原样交回了。 */
static Value normalize_nfc(Value s) {
  CpBuf b = {0, 0, 0};
  const uint16_t *src = s.s;
  uint32_t n = s.slen, i = 0;
  while (i < n) {
    uint32_t cp = 0;
    int 用 = cp_at(src, n, i, &cp);
    decomp_into(&b, cp);
    i += (uint32_t)用;
  }
  canon_order(&b);
  compose_all(&b);
  /* 码点回到单元。一个码点最多摊成两个单元，按两倍算够用。 */
  uint16_t *p = (uint16_t *)malloc((size_t)(b.n ? b.n * 2 : 1) * sizeof(uint16_t));
  if (!p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  uint32_t out = 0;
  for (size_t k = 0; k < b.n; k++) {
    uint32_t cp = b.p[k];
    if (cp <= 0xFFFF) {
      p[out++] = (uint16_t)cp;
    } else {
      uint32_t 码 = cp - 0x10000;
      p[out++] = (uint16_t)(0xD800 + (码 >> 10));
      p[out++] = (uint16_t)(0xDC00 + (码 & 0x3FF));
    }
  }
  free(b.p);
  return v_str(p, out);
}

/* ---- reading the file ------------------------------------------------ */

typedef struct {
  const uint8_t *bytes;
  size_t len;
  size_t at;
} Reader;

static void need(Reader *r, size_t n) {
  if (r->at + n > r->len) {
    fprintf(stderr, "hmyr: the file ends in the middle of something (offset %llu)\n",
            (unsigned long long)r->at);
    exit(2);
  }
}

static uint8_t rd_u8(Reader *r) { need(r, 1); return r->bytes[r->at++]; }

static uint16_t rd_u16(Reader *r) {
  need(r, 2);
  uint16_t v = (uint16_t)(r->bytes[r->at] | (r->bytes[r->at + 1] << 8));
  r->at += 2;
  return v;
}

static uint32_t rd_u32(Reader *r) {
  need(r, 4);
  uint32_t v = (uint32_t)(r->bytes[r->at] | (r->bytes[r->at + 1] << 8)
                          | (r->bytes[r->at + 2] << 16) | ((uint32_t)r->bytes[r->at + 3] << 24));
  r->at += 4;
  return v;
}

static double rd_f64(Reader *r) {
  need(r, 8);
  uint64_t bits = 0;
  for (int i = 7; i >= 0; i--) bits = (bits << 8) | r->bytes[r->at + (size_t)i];
  r->at += 8;
  double d;
  memcpy(&d, &bits, 8);
  return d;
}

/* Strings are read as UTF-16 code units. They are kept in place in the file
 * image (which stays mapped for the whole run), so nothing is copied. */
static const uint16_t *rd_str(Reader *r, uint32_t *out_len) {
  uint16_t n = rd_u16(r);
  need(r, (size_t)n * 2);
  /* The image is byte-aligned; we cannot hand out a uint16_t* safely unless we
   * copy, so each string gets its own buffer. */
  uint16_t *buf = (uint16_t *)malloc((size_t)(n ? n : 1) * sizeof(uint16_t));
  if (!buf) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  for (uint32_t i = 0; i < n; i++) buf[i] = rd_u16(r);
  *out_len = n;
  return buf;
}

/* ---- program --------------------------------------------------------- */

enum {
  OP_ADD, OP_ASSIGN, OP_BOOL, OP_CALLB, OP_CALLF, OP_CONST, OP_DIV, OP_EQ,
  OP_FIELD, OP_GE, OP_GLOBAL, OP_GT, OP_INDEX, OP_JMP, OP_JMPF, OP_JMPF_KEEP,
  OP_JMPT, OP_JMPT_KEEP, OP_LE, OP_LOAD, OP_LT, OP_MOD, OP_MUL, OP_NE,
  OP_NEG, OP_NOT, OP_POP, OP_RECORD, OP_RET, OP_STORE, OP_SUB, OP_TUPLE
};

static const char *op_names[] = {
  "ADD", "ASSIGN", "BOOL", "CALLB", "CALLF", "CONST", "DIV", "EQ",
  "FIELD", "GE", "GLOBAL", "GT", "INDEX", "JMP", "JMPF", "JMPF_KEEP",
  "JMPT", "JMPT_KEEP", "LE", "LOAD", "LT", "MOD", "MUL", "NE",
  "NEG", "NOT", "POP", "RECORD", "RET", "STORE", "SUB", "TUPLE"
};

typedef struct {
  uint8_t op;
  int64_t a;       /* slot, jump target, pool index, or count */
  int64_t b;       /* second immediate (argument count, record arity) */
  Value val;       /* CONST payload */
} Ins;

typedef struct {
  uint16_t *name;
  uint32_t name_len;
  uint16_t nargs;
  uint16_t nslots;
  uint16_t neffects;
  uint16_t **effects;
  uint32_t *effect_lens;
  uint32_t ncode;
  Ins *code;
} Func;

/* A name pool: every string a caller might need to compare by name. */
static uint16_t **pool_p;
static uint32_t *pool_len;
static uint32_t pool_n, pool_cap;

static int64_t pool_add(const uint16_t *p, uint32_t len) {
  if (pool_n == pool_cap) {
    pool_cap = pool_cap ? pool_cap * 2 : 256;
    pool_p = (uint16_t **)realloc(pool_p, pool_cap * sizeof(uint16_t *));
    pool_len = (uint32_t *)realloc(pool_len, pool_cap * sizeof(uint32_t));
    if (!pool_p || !pool_len) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  }
  pool_p[pool_n] = (uint16_t *)p;
  pool_len[pool_n] = len;
  return (int64_t)pool_n++;
}

static int name_is(int64_t idx, const char *ascii) {
  if (idx < 0 || (uint32_t)idx >= pool_n) return 0;
  uint32_t n = pool_len[idx];
  if (n != strlen(ascii)) return 0;
  for (uint32_t i = 0; i < n; i++) if (pool_p[idx][i] != (uint16_t)(unsigned char)ascii[i]) return 0;
  return 1;
}

static Func *funcs;
static uint32_t nfuncs;

static int64_t read_value(Reader *r, Value *out);

static int64_t read_value(Reader *r, Value *out) {
  uint8_t t = rd_u8(r);
  if (t == 0x00) { *out = v_null(); return 0; }
  if (t == 0x01) { *out = v_num(rd_f64(r)); return 0; }
  if (t == 0x02) {
    uint32_t n;
    const uint16_t *p = rd_str(r, &n);
    *out = v_str(p, n);
    return 0;
  }
  if (t == 0x03) { *out = v_bool(rd_u8(r)); return 0; }
  if (t == 0x04) {
    uint16_t n = rd_u16(r);
    Value *items = alloc_values(n);
    for (uint16_t i = 0; i < n; i++) read_value(r, &items[i]);
    Value v = v_null();
    v.tag = T_TUPLE;
    v.items = items;
    v.ilen = n;
    *out = v;
    return 0;
  }
  if (t == 0x05) {
    uint16_t n = rd_u16(r);
    Value *vals = alloc_values(n);
    const uint16_t **names = (const uint16_t **)calloc(n ? n : 1, sizeof(uint16_t *));
    uint32_t *lens = (uint32_t *)calloc(n ? n : 1, sizeof(uint32_t));
    for (uint16_t i = 0; i < n; i++) {
      uint32_t len = 0;
      names[i] = rd_str(r, &len);
      lens[i] = len;
      read_value(r, &vals[i]);
    }
    Value v = v_null();
    v.tag = T_RECORD;
    v.rec.vals = vals;
    v.rec.names = names;
    v.rec.name_lens = lens;
    v.rec.n = n;
    *out = v;
    return 0;
  }
  fprintf(stderr, "hmyr: unknown value tag %u\n", t);
  exit(2);
}

static void load_program(const uint8_t *bytes, size_t len) {
  Reader r = { bytes, len, 0 };
  const char *magic = "HMYRB";
  for (int i = 0; i < 5; i++) {
    if (rd_u8(&r) != (uint8_t)magic[i]) { fprintf(stderr, "hmyr: not a .hmyrb file\n"); exit(2); }
  }
  uint16_t ver = rd_u16(&r);
  if (ver != 1) { fprintf(stderr, "hmyr: file version %u, this reader knows 1\n", ver); exit(2); }

  nfuncs = rd_u16(&r);
  funcs = (Func *)calloc(nfuncs ? nfuncs : 1, sizeof(Func));
  for (uint32_t i = 0; i < nfuncs; i++) {
    Func *f = &funcs[i];
    f->name = (uint16_t *)rd_str(&r, &f->name_len);
    f->nargs = rd_u16(&r);
    f->nslots = rd_u16(&r);
    f->neffects = rd_u16(&r);
    f->effects = (uint16_t **)calloc(f->neffects ? f->neffects : 1, sizeof(uint16_t *));
    f->effect_lens = (uint32_t *)calloc(f->neffects ? f->neffects : 1, sizeof(uint32_t));
    for (uint16_t e = 0; e < f->neffects; e++) f->effects[e] = (uint16_t *)rd_str(&r, &f->effect_lens[e]);
    f->ncode = rd_u32(&r);
    f->code = (Ins *)calloc(f->ncode ? f->ncode : 1, sizeof(Ins));
    for (uint32_t c = 0; c < f->ncode; c++) {
      Ins *in = &f->code[c];
      in->op = rd_u8(&r);
      in->a = 0;
      in->b = 0;
      in->val = v_null();
      switch (in->op) {
        case OP_CONST: read_value(&r, &in->val); break;
        case OP_LOAD: case OP_ASSIGN: in->a = rd_u16(&r); break;
        case OP_STORE: in->a = rd_u16(&r); in->b = rd_u8(&r); break;
        case OP_GLOBAL: case OP_FIELD: {
          uint32_t n; const uint16_t *p = rd_str(&r, &n); in->a = pool_add(p, n); break;
        }
        case OP_JMP: case OP_JMPF: case OP_JMPT: case OP_JMPF_KEEP: case OP_JMPT_KEEP:
          in->a = rd_u32(&r); break;
        case OP_TUPLE: in->a = rd_u16(&r); break;
        case OP_RECORD: {
          uint16_t n = rd_u16(&r);
          int64_t start = (int64_t)pool_n;
          for (uint16_t k = 0; k < n; k++) {
            uint32_t len; const uint16_t *p = rd_str(&r, &len); pool_add(p, len);
          }
          in->a = start;
          in->b = n;
          break;
        }
        case OP_CALLB: case OP_CALLF: {
          uint32_t n; const uint16_t *p = rd_str(&r, &n);
          in->a = pool_add(p, n);
          in->b = rd_u16(&r);
          break;
        }
        default: break;
      }
    }
  }
  uint16_t nglob = rd_u16(&r);
  for (uint16_t i = 0; i < nglob; i++) { uint32_t n; rd_str(&r, &n); }

  /* HMYR_POOL=1：把这个名字池按索引打出来。它与 JS 侧按同一顺序模拟出来的
   * 池并排 diff，第一处不同就是文件读取（或池分配）出错的地方。 */
  if (getenv("HMYR_POOL")) {
    for (uint32_t i = 0; i < pool_n; i++) {
      fprintf(stderr, "%u ", (unsigned)i);
      for (uint32_t k = 0; k < pool_len[i] && k < 8; k++) fprintf(stderr, "%04x", (unsigned)pool_p[i][k]);
      fprintf(stderr, "\n");
    }
  }
}

/* ---- writing UTF-8 --------------------------------------------------- */

static void put_utf8(uint32_t cp) {
  if (cp < 0x80) { putchar((int)cp); return; }
  if (cp < 0x800) {
    putchar((int)(0xC0 | (cp >> 6)));
    putchar((int)(0x80 | (cp & 0x3F)));
    return;
  }
  if (cp < 0x10000) {
    putchar((int)(0xE0 | (cp >> 12)));
    putchar((int)(0x80 | ((cp >> 6) & 0x3F)));
    putchar((int)(0x80 | (cp & 0x3F)));
    return;
  }
  putchar((int)(0xF0 | (cp >> 18)));
  putchar((int)(0x80 | ((cp >> 12) & 0x3F)));
  putchar((int)(0x80 | ((cp >> 6) & 0x3F)));
  putchar((int)(0x80 | (cp & 0x3F)));
}

static void write_utf8(const uint16_t *s, uint32_t len, FILE *out) {
  for (uint32_t i = 0; i < len; i++) {
    uint32_t cp = s[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < len) {
      uint32_t lo = s[i + 1];
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
        i++;
      }
    }
    if (out == stdout) put_utf8(cp);
    else {
      /* encode into a small buffer so print_err can share the code */
      unsigned char b[4]; int n = 0;
      if (cp < 0x80) { b[n++] = (unsigned char)cp; }
      else if (cp < 0x800) { b[n++] = (unsigned char)(0xC0 | (cp >> 6)); b[n++] = (unsigned char)(0x80 | (cp & 0x3F)); }
      else if (cp < 0x10000) { b[n++] = (unsigned char)(0xE0 | (cp >> 12)); b[n++] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F)); b[n++] = (unsigned char)(0x80 | (cp & 0x3F)); }
      else { b[n++] = (unsigned char)(0xF0 | (cp >> 18)); b[n++] = (unsigned char)(0x80 | ((cp >> 12) & 0x3F)); b[n++] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F)); b[n++] = (unsigned char)(0x80 | (cp & 0x3F)); }
      fwrite(b, 1, (size_t)n, out);
    }
  }
}

/* UTF-16 to UTF-8, for the file names this machine has to hand to the OS. */
static char *utf16_to_utf8(const uint16_t *s, uint32_t len) {
  size_t cap = (size_t)len * 4 + 1;
  char *out = (char *)malloc(cap);
  if (!out) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  size_t n = 0;
  for (uint32_t i = 0; i < len; i++) {
    uint32_t cp = s[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < len) {
      uint32_t lo = s[i + 1];
      if (lo >= 0xDC00 && lo <= 0xDFFF) { cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); i++; }
    }
    if (cp < 0x80) out[n++] = (char)cp;
    else if (cp < 0x800) { out[n++] = (char)(0xC0 | (cp >> 6)); out[n++] = (char)(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) {
      out[n++] = (char)(0xE0 | (cp >> 12));
      out[n++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      out[n++] = (char)(0x80 | (cp & 0x3F));
    } else {
      out[n++] = (char)(0xF0 | (cp >> 18));
      out[n++] = (char)(0x80 | ((cp >> 12) & 0x3F));
      out[n++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      out[n++] = (char)(0x80 | (cp & 0x3F));
    }
  }
  out[n] = 0;
  return out;
}

/* UTF-8 to UTF-16. The file on disk is UTF-8; the language's strings are
 * UTF-16 code units, so every read goes through this. */
static uint16_t *utf8_to_utf16(const char *s, size_t len, uint32_t *out_len) {
  uint16_t *out = (uint16_t *)malloc((len + 1) * sizeof(uint16_t));
  if (!out) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  size_t n = 0, i = 0;
  while (i < len) {
    unsigned char b = (unsigned char)s[i];
    uint32_t cp = 0;
    int extra = 0;
    if (b < 0x80) { cp = b; }
    else if ((b & 0xE0) == 0xC0) { cp = b & 0x1F; extra = 1; }
    else if ((b & 0xF0) == 0xE0) { cp = b & 0x0F; extra = 2; }
    else if ((b & 0xF8) == 0xF0) { cp = b & 0x07; extra = 3; }
    else { cp = 0xFFFD; }
    i++;
    for (int k = 0; k < extra && i < len; k++) {
      cp = (cp << 6) | ((unsigned char)s[i] & 0x3F);
      i++;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      out[n++] = (uint16_t)(0xD800 + (cp >> 10));
      out[n++] = (uint16_t)(0xDC00 + (cp & 0x3FF));
    } else {
      out[n++] = (uint16_t)cp;
    }
  }
  *out_len = (uint32_t)n;
  return out;
}

/* ---- number to text -------------------------------------------------- */

/* 双精度 → 最短的、还能读回来的一串。
 *
 * 算法与 src/decimal.mjs 同一条：从一位有效数字试到十七位，第一个能读回原值的就留下。
 * 排版也照 ECMAScript 那一套（定点与指数形式的分界是它定的），
 * 因为「数写成字」这件事在两台机器上必须一字不差，否则同一个程序跑出两种输出。
 *
 * 早先这里用 %.15g，整数与短小数看着没问题，而一碰到 0.1 那一类就露馅 ——
 * 那件事记在 design/C-VM.txt 的第一条差异里，现在这条差异没有了。 */
static void 数字成文(double x, char *out, size_t cap) {
  if (isnan(x)) { snprintf(out, cap, "NaN"); return; }
  if (isinf(x)) { snprintf(out, cap, x < 0 ? "-Infinity" : "Infinity"); return; }
  if (x == 0) { snprintf(out, cap, "0"); return; }   /* 负零也打成零，与 JS 一致 */
  int 负 = x < 0;
  double a = 负 ? -x : x;
  char buf[64];
  int prec;
  for (prec = 1; prec <= 17; prec++) {
    snprintf(buf, sizeof buf, "%.*e", prec - 1, a);
    if (strtod(buf, NULL) == a) break;
  }
  /* 从 d.ddde±xx 里取出有效数字与指数 */
  char 数[40];
  int 位 = 0, e = 0;
  for (char *p = buf; *p && *p != 'e' && *p != 'E'; p++) {
    if (*p >= '0' && *p <= '9' && 位 < 39) 数[位++] = *p;
  }
  for (char *p = buf; *p; p++) if (*p == 'e' || *p == 'E') { e = atoi(p + 1); break; }
  /* 去掉尾零，指数跟着加 */
  while (位 > 1 && 数[位 - 1] == '0') { 位--; e++; }
  int k = 位;
  int n = e + 1;   /* 值 = 0.数 × 10 的 n 次方 */

  char 体[160];
  int o = 0;
  if (k <= n && n <= 21) {
    for (int i = 0; i < k; i++) 体[o++] = 数[i];
    for (int i = 0; i < n - k; i++) 体[o++] = '0';
  } else if (0 < n && n <= 21) {
    for (int i = 0; i < n; i++) 体[o++] = 数[i];
    体[o++] = '.';
    for (int i = n; i < k; i++) 体[o++] = 数[i];
  } else if (-6 < n && n <= 0) {
    体[o++] = '0'; 体[o++] = '.';
    for (int i = 0; i < -n; i++) 体[o++] = '0';
    for (int i = 0; i < k; i++) 体[o++] = 数[i];
  } else {
    int ee = n - 1;
    体[o++] = 数[0];
    if (k > 1) {
      体[o++] = '.';
      for (int i = 1; i < k; i++) 体[o++] = 数[i];
    }
    体[o++] = 'e';
    体[o++] = (ee >= 0) ? '+' : '-';
    char 指[16];
    snprintf(指, sizeof 指, "%d", ee >= 0 ? ee : -ee);
    for (char *p = 指; *p; p++) 体[o++] = *p;
  }
  体[o] = 0;
  snprintf(out, cap, "%s%s", 负 ? "-" : "", 体);
}

/* ---- the machine ----------------------------------------------------- */

static int step_limit = 5000000;
static long steps = 0;
static Value *g_stack;
static uint32_t g_stack_n, g_stack_cap;

/* A short ring of what the machine was doing. When a run ends badly, the last
 * few instructions are the only thing that says where "badly" started - the
 * programme's own error message is about a value, not about a place.
 * Enabled by HMYR_TRACE=1 so the normal run pays nothing. */
#define TRACE_N 40
typedef struct { uint32_t pc; uint8_t op; uint32_t n; } Trace;
static Trace g_trace[TRACE_N];
static int g_trace_at = 0;
static int g_trace_on = 0;

static void trace_dump(void) {
  fprintf(stderr, "--- the last %d instructions (n = stack depth when it ran) ---\n", TRACE_N);
  for (int k = 0; k < TRACE_N; k++) {
    int i = (g_trace_at + k) % TRACE_N;
    Trace *t = &g_trace[i];
    if (t->op == 255) continue;
    const char *nm = (t->op < sizeof op_names / sizeof *op_names) ? op_names[t->op] : "?";
    fprintf(stderr, "  pc=%-5u n=%-4u %s\n", (unsigned)t->pc, (unsigned)t->n, nm);
  }
}

static void push(Value v) {
  if (g_stack_n == g_stack_cap) {
    g_stack_cap = g_stack_cap ? g_stack_cap * 2 : 256;
    g_stack = (Value *)realloc(g_stack, g_stack_cap * sizeof(Value));
    if (!g_stack) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  }
  g_stack[g_stack_n++] = v;
}

/* 当前帧的栈基线。弹栈不许越过它 —— 这是全篇最要紧的一处语义对齐。
 *
 * JS 那台的栈是每帧一条数组，弹空只是拿到 undefined，帧外的东西碰不到。
 * C 这台所有帧共用一条栈，若 pop 不认基线，帧内弹空就会吃掉调用者的值：
 * 少一个值，后面所有实参整体错位一格。查了两轮的「实参错位」就是它。 */
static uint32_t g_base = 0;

static Value pop(void) {
  if (g_stack_n <= g_base) return v_null();
  return g_stack[--g_stack_n];
}

static int truthy(Value v) {
  if (v.tag == T_BOOL) return v.boolean;
  if (v.tag == T_NUM) return v.num != 0;
  if (v.tag == T_STR) return v.slen != 0;
  if (v.tag == T_NULL) return 0;
  if (v.tag == T_TUPLE) return v.ilen != 0;
  return 1;
}

static int g_failed = 0;
static char g_fail_msg[512];

/* 当前正在跑的函数。诊断用：一条指令的 pc 只在它自己的函数里有意义，
 * 所以报错时要能说出「哪个函数、第几条」。 */
static Func *g_cur = NULL;

/* 调用序列：HMYR_CALLS=1 时，每次函数调用打一行「第几个」。
 * 两台机器跑同一份字节码时，第一条不一致的调用就是分歧的起点。 */
static int g_calls_on = 0;
static long g_calls_n = 0;
static int g_fields_on = 0;

/* 事件编号：字段读取与每一次调用共用一条递增的序号。
 * 两台机器对着 diff 时，序号相同就说明「到这里为止发生的事情一样」，
 * 而第一处内容不同的地方，就是那个值出错的位置。 */
static long g_ev = 0;
/* 最近一次字段读取用的是哪个名字（池索引）。诊断用：
 * 某个调用的实参不对时，先问「上一个读的字段是哪个」。 */
static int64_t g_last_field = -1;

/* The argv the programme sees. Built in main from the real command line:
 * the first element is where the bytecode came from, the rest are the
 * programme's own arguments - the same shape the JavaScript machine uses. */
static Value g_argv;

static Value fail(const char *code, const char *msg) {
  if (!g_failed) {
    g_failed = 1;
    snprintf(g_fail_msg, sizeof g_fail_msg, "%s %s", code, msg);
  }
  return v_null();
}

static double as_num(Value v, int *ok) {
  *ok = (v.tag == T_NUM);
  return v.num;
}

static Value value_to_text(Value v, Value *out);

/* Text form of a value, matching what the JavaScript side prints for the kinds
 * this machine supports. Returns the same value as a string. */
static Value value_to_text(Value v, Value *out) {
  if (v.tag == T_STR) { *out = v; return v; }
  if (v.tag == T_NUM) {
    char 文[64];
    数字成文(v.num, 文, sizeof 文);
    uint32_t n = (uint32_t)strlen(文);
    uint16_t *p = (uint16_t *)malloc((size_t)(n ? n : 1) * sizeof(uint16_t));
    for (uint32_t i = 0; i < n; i++) p[i] = (uint16_t)(unsigned char)文[i];
    *out = v_str(p, n);
    return *out;
  }
  if (v.tag == T_BOOL) {
    const char *t = v.boolean ? "true" : "false";
    uint16_t *p = (uint16_t *)malloc(strlen(t) * sizeof(uint16_t));
    for (size_t i = 0; i < strlen(t); i++) p[i] = (uint16_t)(unsigned char)t[i];
    *out = v_str(p, (uint32_t)strlen(t));
    return *out;
  }
  if (v.tag == T_NULL) {
    uint16_t *p = (uint16_t *)malloc(3 * sizeof(uint16_t));
    p[0] = 'n'; p[1] = 'i'; p[2] = 'l';
    *out = v_str(p, 3);
    return *out;
  }
  if (v.tag == T_TUPLE) {
    /* "[" + each + ", " + "]" */
    uint32_t cap = 16, n = 0;
    uint16_t *buf = (uint16_t *)malloc(cap * sizeof(uint16_t));
    #define PUT(ch) do { if (n + 1 >= cap) { cap *= 2; buf = (uint16_t *)realloc(buf, cap * sizeof(uint16_t)); } buf[n++] = (uint16_t)(ch); } while (0)
    PUT('[');
    for (uint32_t i = 0; i < v.ilen; i++) {
      if (i) { PUT(','); PUT(' '); }
      Value inner;
      value_to_text(v.items[i], &inner);
      for (uint32_t k = 0; k < inner.slen; k++) PUT(inner.s[k]);
    }
    PUT(']');
    #undef PUT
    *out = v_str(buf, n);
    return *out;
  }
  /* records: the JavaScript side uses String(obj), which is "[object Object]" */
  {
    const char *t = "[object Object]";
    uint16_t *p = (uint16_t *)malloc(strlen(t) * sizeof(uint16_t));
    for (size_t i = 0; i < strlen(t); i++) p[i] = (uint16_t)(unsigned char)t[i];
    *out = v_str(p, (uint32_t)strlen(t));
    return *out;
  }
}

static int str_eq(Value a, Value b) {
  if (a.slen != b.slen) return 0;
  for (uint32_t i = 0; i < a.slen; i++) if (a.s[i] != b.s[i]) return 0;
  return 1;
}

static int str_cmp(Value a, Value b) {
  uint32_t n = a.slen < b.slen ? a.slen : b.slen;
  for (uint32_t i = 0; i < n; i++) {
    if (a.s[i] < b.s[i]) return -1;
    if (a.s[i] > b.s[i]) return 1;
  }
  if (a.slen < b.slen) return -1;
  if (a.slen > b.slen) return 1;
  return 0;
}

static int values_equal(Value a, Value b) {
  if (a.tag == T_NUM && b.tag == T_NUM) return a.num == b.num;
  if (a.tag == T_STR && b.tag == T_STR) return str_eq(a, b);
  if (a.tag != b.tag) return 0;
  if (a.tag == T_BOOL) return a.boolean == b.boolean;
  if (a.tag == T_NULL) return 1;
  return 0;
}

/* 按名字找函数，交回它在表里的位置；找不到交回 -1。
 * 交回位置而不是指针，是因为调用序列要跨机器对齐，而函数名多是中文 ——
 * 两台机器都打「第几个」，那个数字是共同的。 */
static int64_t find_func_index(int64_t name_idx) {
  for (uint32_t i = 0; i < nfuncs; i++) {
    if (funcs[i].name_len != pool_len[name_idx]) continue;
    uint32_t same = 1;
    for (uint32_t k = 0; k < funcs[i].name_len; k++) {
      if (funcs[i].name[k] != pool_p[name_idx][k]) { same = 0; break; }
    }
    if (same) return (int64_t)i;
  }
  return -1;
}

/* 一个函数声明过某个效果没有。效果名按 UTF-16 码元比。 */
/* 把一个语言值编成 .hmyrb 里那一段字节。
 * 语言里没有 typeof，也没有 try，所以编码留在这一份 —— 这一份本来就懂每个标签。
 * 段的增长用一个手写的线性表，够用（一条指令的立即数不会很长）。 */
static void 段推(uint8_t **段, size_t *长, size_t *容, uint8_t x) {
  if (*长 + 1 > *容) {
    *容 = *容 ? *容 * 2 : 64;
    *段 = (uint8_t *)realloc(*段, *容);
  }
  (*段)[(*长)++] = x;
}

static void 段u16(uint8_t **段, size_t *长, size_t *容, uint32_t v) {
  段推(段, 长, 容, (uint8_t)(v & 0xff));
  段推(段, 长, 容, (uint8_t)((v >> 8) & 0xff));
}

static void 段串(uint8_t **段, size_t *长, size_t *容, const uint16_t *s, uint32_t n) {
  段u16(段, 长, 容, n);
  for (uint32_t i = 0; i < n; i++) 段u16(段, 长, 容, s[i]);
}

static int pack_value(Value v, uint8_t **段, size_t *长, size_t *容) {
  if (v.tag == T_NULL) { 段推(段, 长, 容, 0); return 1; }
  if (v.tag == T_NUM) {
    段推(段, 长, 容, 1);
    uint64_t u = 0;
    memcpy(&u, &v.num, 8);
    for (int i = 0; i < 8; i++) 段推(段, 长, 容, (uint8_t)((u >> (8 * i)) & 0xff));
    return 1;
  }
  if (v.tag == T_STR) { 段推(段, 长, 容, 2); 段串(段, 长, 容, v.s, v.slen); return 1; }
  if (v.tag == T_BOOL) { 段推(段, 长, 容, 3); 段推(段, 长, 容, v.boolean ? 1 : 0); return 1; }
  if (v.tag == T_TUPLE) {
    /* 空元组编成 null：这门语言没有 null，「空元组就是它」，
     * 所以一个空元组在运行时的意思就是「没有值」。与 JS 那侧同一个规矩。 */
    if (v.ilen == 0) { 段推(段, 长, 容, 0); return 1; }
    段推(段, 长, 容, 4);
    段u16(段, 长, 容, v.ilen);
    for (uint32_t i = 0; i < v.ilen; i++) if (!pack_value(v.items[i], 段, 长, 容)) return 0;
    return 1;
  }
  if (v.tag == T_RECORD) {
    段推(段, 长, 容, 5);
    段u16(段, 长, 容, v.rec.n);
    for (uint32_t i = 0; i < v.rec.n; i++) 段串(段, 长, 容, v.rec.names[i], v.rec.name_lens[i]);
    for (uint32_t i = 0; i < v.rec.n; i++) if (!pack_value(v.rec.vals[i], 段, 长, 容)) return 0;
    return 1;
  }
  return 0;
}

static int has_effect(Func *f, const uint16_t *名, uint32_t 长) {
  for (uint32_t i = 0; i < f->neffects; i++) {
    if (f->effect_lens[i] != 长) continue;
    uint32_t same = 1;
    for (uint32_t k = 0; k < 长; k++) if (f->effects[i][k] != 名[k]) { same = 0; break; }
    if (same) return 1;
  }
  return 0;
}

/* 效果检查：被调者声明的，调用者得先声明。
 *
 * 这一条以前只写在 design/C-VM.txt 里当「这台机器不查效果」。
 * 现在查了，而它不需要任何额外数据 —— 函数表里本来就带着每个函数的效果名，
 * 只是以前读进来没人用。 */
static int g_effects_on = 1;

/* 编译那一段的 print 改道到标准错误 —— 理由写在 print 那个内置那里。 */
static int g_compile_quiet = 0;

static Value run_func(Func *f, Value *args, int nargs);

/* Builtins. Each returns 1 on success and stores into *out; 0 means "not a
 * builtin I know", and the failure is already recorded. */
static int call_builtin(int64_t name_idx, Value *args, int nargs, Value *out) {
  if (name_is(name_idx, "print") || name_is(name_idx, "print_err")) {
    /* 编译那一段的 print 改道到标准错误：启动器编源码时种子会打印「N 个字节」，
     * 那不该落在用户程序的输出里。改道而不是丢弃 —— 编译失败时那几行就是诊断。 */
    FILE *to = (name_is(name_idx, "print") && !g_compile_quiet) ? stdout : stderr;
    for (int i = 0; i < nargs; i++) {
      Value t;
      value_to_text(args[i], &t);
      write_utf8(t.s, t.slen, to);
    }
    *out = v_null();
    return 1;
  }
  if (name_is(name_idx, "str")) {
    if (nargs != 1) { fail("HMYR-R0101", "str wants one argument"); return 1; }
    value_to_text(args[0], out);
    return 1;
  }
  if (name_is(name_idx, "len")) {
    if (nargs != 1) { fail("HMYR-R0101", "len wants one argument"); return 1; }
    if (args[0].tag == T_STR) { *out = v_num((double)args[0].slen); return 1; }
    if (args[0].tag == T_TUPLE) { *out = v_num((double)args[0].ilen); return 1; }
    fail("HMYR-R0107", "len wants a string or a tuple");
    return 1;
  }
  if (name_is(name_idx, "chr")) {
    if (nargs != 1) { fail("HMYR-R0101", "chr wants one argument"); return 1; }
    int ok = 0; double cp = as_num(args[0], &ok);
    if (!ok) { fail("HMYR-R0130", "chr wants a number"); return 1; }
    long long 码 = (long long)floor(cp);
    if (码 < 0 || 码 > 0x10FFFF) { fail("HMYR-R0207", "not a code point"); return 1; }
    /* 基本平面之外的码点在串里占两个单元。以前这里一刀截成一个单元，
     * 于是同一段 chr(cp) 在 C 上得到的是那个码点的高位代理 ——
     * 一个看起来只是「字不对」的结果，其实整串都错了一格。 */
    uint16_t 单元[2];
    uint32_t 长 = 1;
    if (码 > 0xFFFF) {
      码 -= 0x10000;
      单元[0] = (uint16_t)(0xD800 + (码 >> 10));
      单元[1] = (uint16_t)(0xDC00 + (码 & 0x3FF));
      长 = 2;
    } else {
      单元[0] = (uint16_t)码;
    }
    uint16_t *p = (uint16_t *)malloc((size_t)长 * sizeof(uint16_t));
    memcpy(p, 单元, (size_t)长 * sizeof(uint16_t));
    *out = v_str(p, 长);
    return 1;
  }
  if (name_is(name_idx, "ord")) {
    if (nargs != 1) { fail("HMYR-R0101", "ord wants one argument"); return 1; }
    if (args[0].tag != T_STR || args[0].slen == 0) { fail("HMYR-R0206", "ord of an empty string"); return 1; }
    /* 一个「字符」是一个码点，不是一个单元：基本平面之外的字符要连着它后面
     * 那个低位代理一起读。JS 那三台用的都是 codePointAt(0)，这里跟上它。 */
    uint32_t cp = 0;
    cp_at(args[0].s, args[0].slen, 0, &cp);
    *out = v_num((double)cp);
    return 1;
  }
  if (name_is(name_idx, "to_int")) {
    if (nargs != 1) { fail("HMYR-R0101", "to_int wants one argument"); return 1; }
    if (args[0].tag == T_NUM) { *out = args[0]; return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "to_int wants a number or a string"); return 1; }
    /* decimal only: digits with an optional leading minus */
    uint32_t i = 0; int neg = 0; long long v = 0; int any = 0;
    if (i < args[0].slen && args[0].s[i] == '-') { neg = 1; i++; }
    for (; i < args[0].slen; i++) {
      uint16_t ch = args[0].s[i];
      if (ch < '0' || ch > '9') { fail("HMYR-R0130", "to_int wants a decimal integer"); return 1; }
      v = v * 10 + (ch - '0');
      any = 1;
    }
    if (!any) { fail("HMYR-R0130", "to_int wants a decimal integer"); return 1; }
    *out = v_num((double)(neg ? -v : v));
    return 1;
  }
  /* 算术那一组：纯函数，不碰世界。两台机器对这五个该给出同一个数，
   * 所以它们进了字节码内置表 —— 以前只在宿主求值器里有，编成字节码就找不着。 */
  if (name_is(name_idx, "abs") || name_is(name_idx, "floor") || name_is(name_idx, "int")) {
    if (nargs != 1) { fail("HMYR-R0101", "that builtin wants one argument"); return 1; }
    int ok = 0;
    double x = as_num(args[0], &ok);
    if (!ok) { fail("HMYR-R0130", "that builtin wants a number"); return 1; }
    if (name_is(name_idx, "abs")) *out = v_num(x < 0 ? -x : x);
    else if (name_is(name_idx, "floor")) *out = v_num(floor(x));
    else *out = v_num(trunc(x));
    return 1;
  }
  if (name_is(name_idx, "min") || name_is(name_idx, "max")) {
    if (nargs < 1) { fail("HMYR-R0101", "that builtin wants at least one argument"); return 1; }
    int 取大 = name_is(name_idx, "max");
    double 佳 = 0;
    for (int i = 0; i < nargs; i++) {
      int ok = 0;
      double x = as_num(args[i], &ok);
      if (!ok) { fail("HMYR-R0130", "min and max want numbers"); return 1; }
      if (i == 0 || (取大 ? x > 佳 : x < 佳)) 佳 = x;
    }
    *out = v_num(佳);
    return 1;
  }
  if (name_is(name_idx, "slice")) {
    if (nargs != 3) { fail("HMYR-R0101", "slice wants three arguments"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "slice wants a string"); return 1; }
    int ok1 = 0, ok2 = 0;
    double a = as_num(args[1], &ok1), b = as_num(args[2], &ok2);
    if (!ok1 || !ok2) { fail("HMYR-R0130", "slice bounds must be numbers"); return 1; }
    long long from = (long long)a, to = (long long)b;
    if (from < 0) from = 0;
    if (to > (long long)args[0].slen) to = (long long)args[0].slen;
    if (to < from) to = from;
    *out = v_str(args[0].s + from, (uint32_t)(to - from));
    return 1;
  }
  /* ---- the character tables ---- */
  if (name_is(name_idx, "is_letter") || name_is(name_idx, "is_mark")) {
    if (nargs != 1) { fail("HMYR-R0101", "that builtin wants one argument"); return 1; }
    if (args[0].tag != T_STR || args[0].slen == 0) { *out = v_bool(0); return 1; }
    uint32_t cp = args[0].s[0];
    if (name_is(name_idx, "is_letter")) *out = v_bool(in_ranges(ucd_letter_ranges, ucd_letter_count, cp));
    else *out = v_bool(in_ranges(ucd_mark_ranges, ucd_mark_count, cp));
    return 1;
  }
  /* 归一化：以前这里是「把文本原样交回」，理由是真表是十七兆语料。
   * 那说的是测试语料；生成一张表只要分解、组合类、组合对三样小东西，
   * 而三样都在仓库里 —— 于是这台机器也真的归一化了。 */
  if (name_is(name_idx, "nfc")) {
    if (nargs != 1) { fail("HMYR-R0101", "nfc wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "nfc wants a string"); return 1; }
    *out = normalize_nfc(args[0]);
    return 1;
  }
  if (name_is(name_idx, "to_upper") || name_is(name_idx, "to_lower")) {
    if (nargs != 1) { fail("HMYR-R0101", "that builtin wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "that builtin wants a string"); return 1; }
    *out = case_fold(args[0], name_is(name_idx, "to_upper"));
    return 1;
  }
  /* ---- records ---- */
  if (name_is(name_idx, "record_new")) {
    if (nargs != 1) { fail("HMYR-R0101", "record_new wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE) { fail("HMYR-R0214", "record_new wants a tuple of (name, value) pairs"); return 1; }
    uint32_t n = args[0].ilen;
    Value v = v_null();
    v.tag = T_RECORD;
    v.rec.vals = alloc_values(n);
    v.rec.names = (const uint16_t **)calloc(n ? n : 1, sizeof(uint16_t *));
    v.rec.name_lens = (uint32_t *)calloc(n ? n : 1, sizeof(uint32_t));
    /* 同名键覆盖，后者赢 —— 记录在 JS 那侧是 Map 或普通对象，两者都是这个规矩。
     * 这里若只按顺序塞，合并两条同名字段的记录会得到四个字段而不是两个，
     * 而那种结果看起来只是「多了一项」，不像一条错误。 */
    uint32_t 收 = 0;
    for (uint32_t i = 0; i < n; i++) {
      Value pair = args[0].items[i];
      if (pair.tag != T_TUPLE || pair.ilen != 2 || pair.items[0].tag != T_STR) {
        fail("HMYR-R0214", "every item must be a (name, value) pair with a string name");
        return 1;
      }
      const uint16_t *名 = pair.items[0].s;
      uint32_t 名长 = pair.items[0].slen;
      int 已有 = -1;
      for (uint32_t k = 0; k < 收; k++) {
        if (v.rec.name_lens[k] != 名长) continue;
        uint32_t same = 1;
        for (uint32_t q = 0; q < 名长; q++) if (v.rec.names[k][q] != 名[q]) { same = 0; break; }
        if (same) { 已有 = (int)k; break; }
      }
      if (已有 >= 0) {
        v.rec.vals[已有] = pair.items[1];
      } else {
        v.rec.names[收] = 名;
        v.rec.name_lens[收] = 名长;
        v.rec.vals[收] = pair.items[1];
        收++;
      }
    }
    v.rec.n = 收;
    *out = v;
    return 1;
  }
  if (name_is(name_idx, "field_get") || name_is(name_idx, "field_has")) {
    if (nargs != 2) { fail("HMYR-R0101", "that builtin wants two arguments"); return 1; }
    if (args[0].tag != T_RECORD) {
      if (name_is(name_idx, "field_has")) { *out = v_bool(0); return 1; }
      fail("HMYR-R0215", "field_get wants a record");
      return 1;
    }
    if (args[1].tag != T_STR) { fail("HMYR-R0130", "a field name must be a string"); return 1; }
    for (uint32_t i = 0; i < args[0].rec.n; i++) {
      if (args[0].rec.name_lens[i] != args[1].slen) continue;
      uint32_t same = 1;
      for (uint32_t k = 0; k < args[1].slen; k++) {
        if (args[0].rec.names[i][k] != args[1].s[k]) { same = 0; break; }
      }
      if (same) {
        if (name_is(name_idx, "field_has")) { *out = v_bool(1); return 1; }
        *out = args[0].rec.vals[i];
        return 1;
      }
    }
    if (name_is(name_idx, "field_has")) { *out = v_bool(0); return 1; }
    fail("HMYR-R0216", "no field with that name on that record");
    return 1;
  }
  if (name_is(name_idx, "field_names")) {
    if (nargs != 1) { fail("HMYR-R0101", "field_names wants one argument"); return 1; }
    if (args[0].tag != T_RECORD) { fail("HMYR-R0217", "field_names wants a record"); return 1; }
    uint32_t n = args[0].rec.n;
    Value v = v_null();
    v.tag = T_TUPLE;
    v.ilen = n;
    v.items = alloc_values(n);
    for (uint32_t i = 0; i < n; i++) v.items[i] = v_str(args[0].rec.names[i], args[0].rec.name_lens[i]);
    *out = v;
    return 1;
  }
  /* ---- files ---- */
  if (name_is(name_idx, "file_exists")) {
    if (nargs != 1) { fail("HMYR-R0101", "file_exists wants one argument"); return 1; }
    if (args[0].tag != T_STR) { *out = v_bool(0); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "rb");
    if (f) fclose(f);
    *out = v_bool(f != NULL);
    free(p);
    return 1;
  }
  if (name_is(name_idx, "read_text")) {
    if (nargs < 1) { fail("HMYR-R0101", "read_text wants at least one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "read_text wants a path string"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "rb");
    if (!f) { free(p); fail("HMYR-R0211", "cannot read that file"); return 1; }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = (char *)malloc((size_t)(n > 0 ? n : 1));
    size_t got = (n > 0) ? fread(buf, 1, (size_t)n, f) : 0;
    fclose(f);
    free(p);
    size_t at = 0;
    if (got >= 3 && (unsigned char)buf[0] == 0xEF && (unsigned char)buf[1] == 0xBB && (unsigned char)buf[2] == 0xBF) at = 3;
    uint32_t n16 = 0;
    uint16_t *u = utf8_to_utf16(buf + at, got - at, &n16);
    free(buf);
    *out = v_str(u, n16);
    return 1;
  }
  if (name_is(name_idx, "write_text")) {
    if (nargs != 2) { fail("HMYR-R0101", "write_text wants two arguments"); return 1; }
    if (args[0].tag != T_STR || args[1].tag != T_STR) { fail("HMYR-R0130", "write_text wants two strings"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    char *t = utf16_to_utf8(args[1].s, args[1].slen);
    FILE *f = 开文件(p, "wb");
    if (!f) { free(p); free(t); fail("HMYR-R0212", "cannot write that file"); return 1; }
    size_t tl = strlen(t);
    size_t wrote = fwrite(t, 1, tl, f);
    fclose(f);
    free(p);
    free(t);
    *out = v_num((double)(wrote == tl ? args[1].slen : 0));
    return 1;
  }
  /* 写一串字节。字节在语言里是「0 到 255 的整数元组」——
   * 这门语言没有字节类型，而 .hmyrb 的落盘需要一个能交出字节的出口。 */
  if (name_is(name_idx, "write_bytes")) {
    if (nargs != 2) { fail("HMYR-R0101", "write_bytes wants two arguments"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "write_bytes wants a path string"); return 1; }
    if (args[1].tag != T_TUPLE) { fail("HMYR-R0130", "write_bytes wants a tuple of bytes"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "wb");
    free(p);
    if (!f) { fail("HMYR-R0212", "cannot write that file"); return 1; }
    /* 元素可以是字节，也可以是一块字节（语言那边按块累积，省掉平方复制）。 */
    double 写 = 0;
    for (uint32_t i = 0; i < args[1].ilen; i++) {
      Value 项 = args[1].items[i];
      if (项.tag == T_TUPLE) {
        for (uint32_t k = 0; k < 项.ilen; k++) {
          int ok = 0;
          double d = as_num(项.items[k], &ok);
          if (!ok) { fclose(f); fail("HMYR-R0130", "every byte must be a number"); return 1; }
          unsigned char b = (unsigned char)(((long long)d) & 0xff);
          fwrite(&b, 1, 1, f);
          写 += 1;
        }
      } else {
        int ok = 0;
        double d = as_num(项, &ok);
        if (!ok) { fclose(f); fail("HMYR-R0130", "every byte must be a number"); return 1; }
        unsigned char b = (unsigned char)(((long long)d) & 0xff);
        fwrite(&b, 1, 1, f);
        写 += 1;
      }
    }
    fclose(f);
    *out = v_num(写);
    return 1;
  }
  /* 把一个值编成 .hmyrb 里那一段字节。
   *
   * 这一条本该在语言里写，但语言里没有 typeof，也没有 try ——
   * 判不出类型的编码器只会猜错。所以编码留在这里：这一份本来就懂每个标签。 */
  if (name_is(name_idx, "pack_value")) {
    if (nargs != 1) { fail("HMYR-R0101", "pack_value wants one argument"); return 1; }
    uint8_t *段 = NULL;
    size_t 长 = 0, 容 = 0;
    int 好 = pack_value(args[0], &段, &长, &容);
    if (!好) { free(段); fail("HMYR-R0214", "cannot encode this value"); return 1; }
    Value v = v_null();
    v.tag = T_TUPLE;
    v.ilen = (uint32_t)长;
    v.items = alloc_values((uint32_t)长);
    for (uint32_t i = 0; i < (uint32_t)长; i++) v.items[i] = v_num((double)段[i]);
    free(段);
    *out = v;
    return 1;
  }
  if (name_is(name_idx, "f64_bytes")) {
    if (nargs != 1) { fail("HMYR-R0101", "f64_bytes wants one argument"); return 1; }
    int ok0 = 0;
    double d = as_num(args[0], &ok0);
    if (!ok0) { fail("HMYR-R0130", "f64_bytes wants a number"); return 1; }
    uint64_t u = 0;
    memcpy(&u, &d, 8);
    Value v = v_null();
    v.tag = T_TUPLE;
    v.ilen = 8;
    v.items = alloc_values(8);
    for (int i = 0; i < 8; i++) v.items[i] = v_num((double)((u >> (8 * i)) & 0xff));
    *out = v;
    return 1;
  }
  /* 按行读：从偏移读一行，交回 {行, 下一起点}；读完交回 下一起点 = -1。
   * 语言里没有文件句柄，所以每次调用自己开、自己关 —— 语义封闭，能一段一段读。 */
  if (name_is(name_idx, "read_line")) {
    if (nargs != 2) { fail("HMYR-R0101", "read_line wants two arguments"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "read_line wants a path string"); return 1; }
    int ok = 0;
    double 起 = as_num(args[1], &ok);
    if (!ok) { fail("HMYR-R0130", "read_line wants a number offset"); return 1; }
    char *路 = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(路, "rb");
    free(路);
    if (!f) { fail("HMYR-R0211", "cannot read that file"); return 1; }
    if (fseek(f, (long)起, SEEK_SET) != 0) { fclose(f); fail("HMYR-R0211", "cannot seek in that file"); return 1; }
    /* 一行：读到换行为止（不含换行）。 */
    char 缓[4096];
    size_t 得 = 0;
    int c;
    while ((c = fgetc(f)) != EOF && c != '\n') {
      if (得 < sizeof 缓 - 1) 缓[得++] = (char)c;
    }
    缓[得] = 0;
    long 下 = -1;
    if (c == '\n') 下 = ftell(f);
    fclose(f);
    /* 去掉行尾的 \r，好让 CRLF 与 LF 两种文件读出来一样。 */
    if (得 > 0 && 缓[得 - 1] == '\r') { 得--; 缓[得] = 0; }
    uint32_t 行长 = 0;
    uint16_t *行们 = utf8_to_utf16(缓, 得, &行长);
    Value 行 = v_str(行们, 行长);
    Value 记 = v_null();
    记.tag = T_RECORD;
    记.rec.n = 2;
    记.rec.vals = alloc_values(2);
    记.rec.names = (const uint16_t **)calloc(2, sizeof(uint16_t *));
    记.rec.name_lens = (uint32_t *)calloc(2, sizeof(uint32_t));
    static const uint16_t 名行[] = {0x884c};        /* 行 */
    static const uint16_t 名下[] = {0x4e0b, 0x4e00, 0x8d77, 0x70b9}; /* 下一起点 */
    记.rec.names[0] = 名行; 记.rec.name_lens[0] = 1; 记.rec.vals[0] = 行;
    记.rec.names[1] = 名下; 记.rec.name_lens[1] = 4; 记.rec.vals[1] = v_num((double)下);
    *out = 记;
    return 1;
  }
  /* 整份按行切好。给「知道自己要全部」的调用者一个省事的入口。 */
  if (name_is(name_idx, "read_lines")) {
    if (nargs != 1) { fail("HMYR-R0101", "read_lines wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "read_lines wants a path string"); return 1; }
    char *路 = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(路, "rb");
    free(路);
    if (!f) { fail("HMYR-R0211", "cannot read that file"); return 1; }
    fseek(f, 0, SEEK_END);
    long 大小 = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (大小 < 0) { fclose(f); fail("HMYR-R0211", "cannot read that file"); return 1; }
    char *文 = (char *)malloc((size_t)大小 + 1);
    if (!文) { fclose(f); fail("HMYR-R0211", "cannot read that file"); return 1; }
    size_t 得 = fread(文, 1, (size_t)大小, f);
    fclose(f);
    文[得] = 0;
    /* 切行：末尾那个空段不算（文件以换行收尾是常态），行尾的 \r 去掉。 */
    uint32_t 数 = 0, 容 = 16;
    Value v = v_null();
    v.tag = T_TUPLE;
    v.items = alloc_values(容);
    size_t 起 = 0;
    for (size_t i = 0; i <= 得; i++) {
      if (i < 得 && 文[i] != '\n') continue;
      size_t 末 = i;
      if (末 > 起 && 文[末 - 1] == '\r') 末--;
      if (i == 得 && 末 == 起) break;   /* 末尾空行 */
      uint32_t 行长 = 0;
      uint16_t *行们 = utf8_to_utf16(文 + 起, 末 - 起, &行长);
      if (数 >= 容) {
        容 *= 2;
        Value *新 = alloc_values(容);
        for (uint32_t k = 0; k < 数; k++) 新[k] = v.items[k];
        v.items = 新;
      }
      v.items[数++] = v_str(行们, 行长);
      起 = i + 1;
    }
    free(文);
    v.ilen = 数;
    *out = v;
    return 1;
  }
  if (name_is(name_idx, "argv")) {
    if (nargs != 0) { fail("HMYR-R0101", "argv takes no arguments"); return 1; }
    *out = g_argv;
    return 1;
  }
  {
    /* Say which builtin is missing. A machine that only says "no" makes the
     * gap a guessing game; the name is the whole diagnostic. */
    char msg[256];
    uint32_t n = pool_len[name_idx];
    if (n > 200) n = 200;
    for (uint32_t i = 0; i < n; i++) {
      uint16_t ch = pool_p[name_idx][i];
      msg[i] = (ch < 128) ? (char)ch : '?';
    }
    msg[n] = 0;
    char full[320];
    snprintf(full, sizeof full, "this machine does not have the builtin '%s'", msg);
    fail("HMYR-R0104", full);
    return 1;
  }
}

static Value run_func(Func *f, Value *args, int nargs) {
  if (g_failed) return v_null();
  if (nargs != (int)f->nargs) {
    fail("HMYR-R0101", "that function got the wrong number of arguments");
    return v_null();
  }
  Value *slots = alloc_values(f->nslots);
  for (int i = 0; i < nargs && i < (int)f->nslots; i++) slots[i] = args[i];
  uint32_t base = g_stack_n;
  /* 进帧时把基线交给 pop：从那以后弹栈不会越过它。
   * 退出时要还原 —— 否则回到调用者之后，它自己也弹不动自己压的东西了。 */
  uint32_t 外base = g_base;
  g_base = base;
  Func *外函 = g_cur;
  g_cur = f;
  int32_t pc = 0;
  for (;;) {
    if (g_failed) return v_null();
    if (++steps > step_limit) { fail("HMYR-R0102", "the program ran for too long"); return v_null(); }
    if ((uint32_t)pc >= f->ncode) { fail("HMYR-R0110", "the instruction stream ran off its end"); return v_null(); }
    Ins *in = &f->code[pc];
    if (g_trace_on) {
      Trace *t = &g_trace[g_trace_at];
      t->pc = pc;
      t->op = in->op;
      t->n = g_stack_n;
      g_trace_at = (g_trace_at + 1) % TRACE_N;
    }
    switch (in->op) {
      case OP_CONST: push(in->val); pc++; break;
      case OP_LOAD:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char m[160];
          snprintf(m, sizeof m, "load from slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-R0110", m);
          return v_null();
        }
        push(slots[in->a]); pc++; break;
      case OP_STORE:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char m[160];
          snprintf(m, sizeof m, "store to slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-R0110", m);
          return v_null();
        }
        slots[in->a] = pop(); pc++; break;
      case OP_ASSIGN:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char m[160];
          snprintf(m, sizeof m, "assign to slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-R0110", m);
          return v_null();
        }
        slots[in->a] = pop(); pc++; break;
      case OP_POP: pop(); pc++; break;
      case OP_GLOBAL: { fail("HMYR-R0104", "globals are not in this machine yet"); return v_null(); }
      case OP_BOOL: { Value v = pop(); push(v_bool(truthy(v))); pc++; break; }
      case OP_NEG: { Value v = pop(); int ok = 0; double d = as_num(v, &ok);
        if (!ok) { fail("HMYR-R0130", "expected a number"); return v_null(); } push(v_num(-d)); pc++; break; }
      case OP_NOT: { Value v = pop(); push(v_bool(!truthy(v))); pc++; break; }
      case OP_ADD: {
        Value b = pop(), a = pop();
        if (a.tag == T_TUPLE && b.tag == T_TUPLE) {
          Value v = v_null(); v.tag = T_TUPLE; v.ilen = a.ilen + b.ilen;
          v.items = alloc_values(v.ilen);
          memcpy(v.items, a.items, a.ilen * sizeof(Value));
          memcpy(v.items + a.ilen, b.items, b.ilen * sizeof(Value));
          push(v);
        } else if (a.tag == T_STR || b.tag == T_STR) {
          Value sa, sb; value_to_text(a, &sa); value_to_text(b, &sb);
          uint16_t *p = (uint16_t *)malloc((size_t)(sa.slen + sb.slen) * sizeof(uint16_t));
          memcpy(p, sa.s, (size_t)sa.slen * sizeof(uint16_t));
          memcpy(p + sa.slen, sb.s, (size_t)sb.slen * sizeof(uint16_t));
          push(v_str(p, sa.slen + sb.slen));
        } else {
          int ok1 = 0, ok2 = 0;
          double x = as_num(a, &ok1), y = as_num(b, &ok2);
          if (!ok1 || !ok2) { fail("HMYR-R0130", "expected numbers"); return v_null(); }
          push(v_num(x + y));
        }
        pc++; break;
      }
      case OP_SUB: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); return v_null(); }
        push(v_num(x - y)); pc++; break; }
      case OP_MUL: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); return v_null(); }
        push(v_num(x * y)); pc++; break; }
      case OP_DIV: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); return v_null(); }
        if (y == 0) { fail("HMYR-R0120", "division by zero"); return v_null(); }
        push(v_num(x / y)); pc++; break; }
      case OP_MOD: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); return v_null(); }
        if (y == 0) { fail("HMYR-R0120", "division by zero"); return v_null(); }
        double m = x - y * (double)(long long)(x / y);
        push(v_num(m)); pc++; break; }
      case OP_EQ: { Value b = pop(), a = pop(); push(v_bool(values_equal(a, b))); pc++; break; }
      case OP_NE: { Value b = pop(), a = pop(); push(v_bool(!values_equal(a, b))); pc++; break; }
      case OP_LT: case OP_LE: case OP_GT: case OP_GE: {
        Value b = pop(), a = pop();
        int c = 0;
        if (a.tag == T_NUM && b.tag == T_NUM) c = (a.num < b.num) ? -1 : (a.num > b.num ? 1 : 0);
        else if (a.tag == T_STR && b.tag == T_STR) c = str_cmp(a, b);
        else { fail("HMYR-R0131", "cannot compare those two values"); return v_null(); }
        int r = 0;
        if (in->op == OP_LT) r = c < 0;
        else if (in->op == OP_LE) r = c <= 0;
        else if (in->op == OP_GT) r = c > 0;
        else r = c >= 0;
        push(v_bool(r)); pc++; break;
      }
      case OP_JMP: pc = (int32_t)in->a; break;
      case OP_JMPF: { Value v = pop(); if (!truthy(v)) pc = (int32_t)in->a; else pc++; break; }
      case OP_JMPT: { Value v = pop(); if (truthy(v)) pc = (int32_t)in->a; else pc++; break; }
      case OP_JMPF_KEEP: if (g_stack_n > base && !truthy(g_stack[g_stack_n - 1])) pc = (int32_t)in->a; else { pop(); pc++; } break;
      case OP_JMPT_KEEP: if (g_stack_n > base && truthy(g_stack[g_stack_n - 1])) pc = (int32_t)in->a; else { pop(); pc++; } break;
      case OP_TUPLE: {
        uint32_t n = (uint32_t)in->a;
        Value v = v_null(); v.tag = T_TUPLE; v.ilen = n;
        v.items = alloc_values(n);
        for (uint32_t i = 0; i < n; i++) v.items[i] = g_stack[g_stack_n - n + i];
        g_stack_n -= n;
        push(v); pc++; break;
      }
      case OP_RECORD: {
        uint32_t n = (uint32_t)in->b;
        Value v = v_null(); v.tag = T_RECORD; v.rec.n = n;
        v.rec.vals = alloc_values(n);
        uint32_t *lens = (uint32_t *)calloc(n ? n : 1, sizeof(uint32_t));
        const uint16_t **names = (const uint16_t **)calloc(n ? n : 1, sizeof(uint16_t *));
        for (uint32_t i = 0; i < n; i++) {
          lens[i] = pool_len[in->a + i];
          names[i] = pool_p[in->a + i];
        }
        for (uint32_t i = 0; i < n; i++) v.rec.vals[i] = g_stack[g_stack_n - n + i];
        g_stack_n -= n;
        v.rec.name_lens = lens;
        v.rec.names = names;
        push(v); pc++; break;
      }
      case OP_FIELD: {
        Value t = pop();
        if (t.tag != T_RECORD) {
          /* 说清楚是哪个字段、哪条指令、拿到的是什么 —— 「no field on that value」
           * 只说了一半，而查的时候要的是另一半。 */
          char 名[64];
          uint32_t nl = pool_len[in->a] < 63 ? pool_len[in->a] : 63;
          for (uint32_t k = 0; k < nl; k++) 名[k] = (pool_p[in->a][k] < 128) ? (char)pool_p[in->a][k] : '?';
          名[nl] = 0;
          char m[220];
          char 函名[48];
          uint32_t fl3 = (g_cur && g_cur->name_len < 47) ? g_cur->name_len : 0;
          for (uint32_t k = 0; k < fl3; k++) 函名[k] = (g_cur->name[k] < 128) ? (char)g_cur->name[k] : '?';
          函名[fl3] = 0;
          snprintf(m, sizeof m, "field '%s' read off a value that is not a record (tag=%d, %s pc=%u)",
                   名, (int)t.tag, 函名, (unsigned)pc);
          fail("HMYR-R0106", m);
          return v_null();
        }
        /* find the field by name */
        int found = 0;
        int 位 = -1;
        for (uint32_t i = 0; i < t.rec.n; i++) {
          if (t.rec.name_lens[i] != pool_len[in->a]) continue;
          uint32_t same = 1;
          for (uint32_t k = 0; k < t.rec.name_lens[i]; k++) {
            if (t.rec.names[i][k] != pool_p[in->a][k]) { same = 0; break; }
          }
          if (same) { push(t.rec.vals[i]); found = 1; 位 = (int)i; break; }
        }
        /* 影子输出：这条读到的字段在这个记录里排第几。两台机器对着 diff，
         * 就能看出是「记录造错了」还是「找错了」。 */
        g_last_field = in->a;
        if (g_fields_on) {
          fprintf(stderr, "EV %ld ", g_ev++);
          fprintf(stderr, "FIELD pc=%u n=%u i=%d name=", (unsigned)pc, (unsigned)t.rec.n, 位);
          for (uint32_t k = 0; k < pool_len[in->a] && k < 8; k++) fprintf(stderr, "%04x", (unsigned)pool_p[in->a][k]);
          if (位 >= 0) {
            Value v = t.rec.vals[位];
            if (v.tag == T_BOOL) fprintf(stderr, " val=bool:%d", v.boolean ? 1 : 0);
            else if (v.tag == T_NUM) fprintf(stderr, " val=num");
            else if (v.tag == T_STR) fprintf(stderr, " val=str");
            else if (v.tag == T_TUPLE) fprintf(stderr, " val=tuple");
            else if (v.tag == T_RECORD) fprintf(stderr, " val=record");
            else fprintf(stderr, " val=null");
          }
          fprintf(stderr, "\n");
        }
        if (!found) { fail("HMYR-R0106", "no field with that name"); return v_null(); }
        pc++; break;
      }
      case OP_INDEX: {
        Value i = pop(), t = pop();
        int ok = 0; double d = as_num(i, &ok);
        if (!ok) { fail("HMYR-R0130", "index must be a number"); return v_null(); }
        long long idx = (long long)d;
        if (t.tag == T_STR) {
          if (idx < 0 || idx >= (long long)t.slen) { fail("HMYR-R0151", "index outside the value"); return v_null(); }
          push(v_str(t.s + idx, 1));
        } else if (t.tag == T_TUPLE) {
          if (idx < 0 || idx >= (long long)t.ilen) { fail("HMYR-R0151", "index outside the value"); return v_null(); }
          push(t.items[idx]);
        } else { fail("HMYR-R0152", "cannot index that value"); return v_null(); }
        pc++; break;
      }
      case OP_CALLB: {
        uint32_t n = (uint32_t)in->b;
        if (g_calls_on && g_calls_n < 200000) {
          char bn[64];
          uint32_t bl = pool_len[in->a] < 63 ? pool_len[in->a] : 63;
          for (uint32_t k = 0; k < bl; k++) bn[k] = (pool_p[in->a][k] < 128) ? (char)pool_p[in->a][k] : '?';
          bn[bl] = 0;
          fprintf(stderr, "EV %ld CALLB %s n=%u\n", g_ev++, bn, (unsigned)n);
          g_calls_n++;
        }
        if (g_stack_n < base || g_stack_n - base < n) {
          char m[160];
          snprintf(m, sizeof m, "a builtin call wants %u argument(s), the frame has %u",
                   (unsigned)n, (unsigned)(g_stack_n - base));
          fail("HMYR-R0110", m);
          return v_null();
        }
        Value *args = (Value *)malloc((size_t)(n ? n : 1) * sizeof(Value));
        for (uint32_t i = 0; i < n; i++) args[i] = g_stack[g_stack_n - n + i];
        g_stack_n -= n;
        Value out = v_null();
        call_builtin(in->a, args, (int)n, &out);
        free(args);
        if (g_failed) return v_null();
        push(out); pc++; break;
      }
      case OP_CALLF: {
        int64_t 位 = find_func_index(in->a);
        Func *callee = (位 >= 0) ? &funcs[位] : NULL;
        if (!callee) { fail("HMYR-R0104", "there is no such function"); return v_null(); }
        if (g_calls_on && g_calls_n < 200000) {
          /* 对某一个函数，顺手把实参的种类打出来：调用序列只说明「调了它」，
           * 说不清「给了它什么」。求二元 就是被盯的那个（79 号）。 */
          if (位 == 79) {
            fprintf(stderr, "ARGS79 base=%u stackn=%u n=%u tags=", (unsigned)base, (unsigned)g_stack_n, (unsigned)in->b);
            for (uint32_t i = 0; i < (uint32_t)in->b; i++) fprintf(stderr, " %d", (int)g_stack[g_stack_n - (uint32_t)in->b + i].tag);
            fprintf(stderr, " lastfield=");
            if (g_last_field >= 0) { for (uint32_t k = 0; k < pool_len[g_last_field] && k < 8; k++) fprintf(stderr, "%04x", (unsigned)pool_p[g_last_field][k]); }
            fprintf(stderr, "\n");
          }
          /* 栈深要减掉本帧基线：C 这边所有帧共用一条栈，而 JS 那边每帧一条。
           * 不减的话两个数字根本不是一回事 —— 这一点白比过一轮。 */
          fprintf(stderr, "EV %ld CALL %lld sn=%u n=%u tags=", g_ev++, (long long)位,
                  (unsigned)(g_stack_n - base), (unsigned)in->b);
          for (uint32_t i = 0; i < (uint32_t)in->b; i++) fprintf(stderr, " %d", (int)g_stack[g_stack_n - (uint32_t)in->b + i].tag);
          fprintf(stderr, "\n");
          g_calls_n++;
        }
        uint32_t n = (uint32_t)in->b;
        /* 效果往下核：被调者声明了什么，调用者就得先声明什么。
         * 这一条在语言规范里，而这里以前不查 —— 数据本来就在函数表里。 */
        if (g_effects_on) {
          for (uint32_t e = 0; e < callee->neffects; e++) {
            if (has_effect(f, callee->effects[e], callee->effect_lens[e])) continue;
            char 效[32];
            uint32_t el = callee->effect_lens[e] < 31 ? callee->effect_lens[e] : 31;
            for (uint32_t k = 0; k < el; k++) 效[k] = (callee->effects[e][k] < 128) ? (char)callee->effects[e][k] : '?';
            效[el] = 0;
            char 名[64];
            uint32_t fl2 = callee->name_len < 63 ? callee->name_len : 63;
            for (uint32_t k = 0; k < fl2; k++) 名[k] = (callee->name[k] < 128) ? (char)callee->name[k] : '?';
            名[fl2] = 0;
            char m[200];
            snprintf(m, sizeof m, "%s uses effect '%s', which the caller did not declare", 名, 效);
            fail("HMYR-R0201", m);
            return v_null();
          }
        }
        if (g_stack_n < base || g_stack_n - base < n) {
          char fname[64];
          uint32_t fl = callee->name_len < 63 ? callee->name_len : 63;
          for (uint32_t k = 0; k < fl; k++) fname[k] = (callee->name[k] < 128) ? (char)callee->name[k] : '?';
          fname[fl] = 0;
          char m[260];
          snprintf(m, sizeof m, "calling %s (#%lld) wants %u argument(s), the frame has %u (pc=%u)",
                   fname, (long long)位, (unsigned)n, (unsigned)(g_stack_n - base), (unsigned)pc);
          fail("HMYR-R0110", m);
          return v_null();
        }
        Value *args = (Value *)malloc((size_t)(n ? n : 1) * sizeof(Value));
        for (uint32_t i = 0; i < n; i++) args[i] = g_stack[g_stack_n - n + i];
        g_stack_n -= n;
        Value r = run_func(callee, args, (int)n);
        free(args);
        if (g_failed) return v_null();
        push(r); pc++; break;
      }
      case OP_RET: { Value v = pop(); g_stack_n = base; g_base = 外base; g_cur = 外函; return v; }
      default: {
        char msg[160];
        uint32_t k = in->op;
        const char *nm = (k < sizeof op_names / sizeof *op_names) ? op_names[k] : "?";
        snprintf(msg, sizeof msg, "cannot execute the instruction %s", nm);
        fail("HMYR-R0110", msg);
        return v_null();
      }
    }
  }
}

static uint8_t *read_file(const char *path, size_t *out_len) {
  FILE *f = 开文件(path, "rb");
  if (!f) { fprintf(stderr, "hmyr: cannot open %s\n", path); exit(1); }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  uint8_t *buf = (uint8_t *)malloc((size_t)(n > 0 ? n : 1));
  if (!buf) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  size_t got = fread(buf, 1, (size_t)n, f);
  fclose(f);
  *out_len = got;
  return buf;
}

/* ---- 一个可执行文件，两个入口 ----------------------------------------
 *
 *   hmyr 程序.hmyrb [参数]   装载就绪的字节码，直接跑。
 *   hmyr 程序.hmyr  [参数]   先让种子把它编成字节码，再跑那一份。
 *
 * 第二种就是这个文件作为「启动器」的那一面。它做到的是一件具体的事：
 * 从源码到运行，路上没有 JavaScript —— 种子是自己编出来的字节码，
 * 编出来的那一份也由这台机器跑。
 */

/* 编译那一段的 print 改道到标准错误 —— 理由写在 print 那个内置旁边。 */

/* 把装载过的那一份放下，好装下一份。不清的话第二份的槽位与名字池会接在第一份
 * 后面，症状是「程序跑起来了，但用的是别人的常数」—— 那种错比崩溃难查。 */
static void unload_program(void) {
  funcs = NULL;
  nfuncs = 0;
  pool_p = NULL;
  pool_len = NULL;
  pool_n = 0;
  pool_cap = 0;
  g_stack_n = 0;
  g_base = 0;
  g_cur = NULL;
  g_failed = 0;
  g_last_field = -1;
  g_trace_at = 0;
  steps = 0;
  g_argv = v_null();
}

static int 文件在(const char *path) {
  FILE *f = 开文件(path, "rb");
  if (!f) return 0;
  fclose(f);
  return 1;
}

/* 临时字节码放哪儿：系统的临时目录。名字带 pid，两次同时跑也不会撞。
 * 裸机上没有 pid 也没有并发，名字就是固定的那个。 */
static void 临时路径(char *buf, size_t cap) {
#ifdef _WIN32
  const char *dir = getenv("TEMP");
  if (!dir || !*dir) dir = getenv("TMP");
  if (!dir || !*dir) dir = ".";
  snprintf(buf, cap, "%s\\hmyr-%ld.hmyrb", dir, (long)_getpid());
#elif defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
  const char *dir = getenv("TMPDIR");
  if (!dir || !*dir) dir = "/tmp";
  snprintf(buf, cap, "%s/hmyr.hmyrb", dir);
#else
  const char *dir = getenv("TMPDIR");
  if (!dir || !*dir) dir = "/tmp";
  snprintf(buf, cap, "%s/hmyr-%ld.hmyrb", dir, (long)getpid());
#endif
}

/* 种子在哪。三种找法，按「离用户近」排：环境变量、可执行文件旁边、
 * 当前目录。找不到就明说，别让人等一个「没有这个文件」的通用消息。 */
static int 找种子(char *buf, size_t cap, const char *argv0) {
  const char *env = getenv("HMYR_SEED");
  if (env && *env) {
    snprintf(buf, cap, "%s", env);
    if (文件在(buf)) return 1;
  }
  /* 可执行文件所在目录：砍掉最后一段路径。 */
  char 目录[900];
  snprintf(目录, sizeof 目录, "%s", argv0);
  char *切 = NULL;
  for (char *p = 目录; *p; p++) if (*p == '/' || *p == '\\') 切 = p;
  if (切) {
    *切 = 0;
    snprintf(buf, cap, "%s%cbootstrap%cpack.hmyrb", 目录, '\\', '\\');
    if (文件在(buf)) return 1;
    snprintf(buf, cap, "%s%c..%cbootstrap%cpack.hmyrb", 目录, '\\', '\\', '\\');
    if (文件在(buf)) return 1;
  }
  snprintf(buf, cap, "bootstrap%cpack.hmyrb", '\\');
  if (文件在(buf)) return 1;
  return 0;
}

/* 步限：默认五百万步。跑解释器替程序执行要几十倍，所以从环境变量放宽 ——
 * 编译那一段则直接按放宽的那个数算，因为「编一份源码」本来就不是小活。 */
static int 步限从环境(void) {
  const char *sl = getenv("HMYR_STEPS");
  if (sl) {
    long v = atol(sl);
    if (v > 0) return (int)(v > 2000000000L ? 2000000000L : v);
  }
  return 5000000;
}

/* 装一份字节码、按命令行给它 argv、跑，交回退出码。
 *
 * 装载路径与 argv[0] 分开给：装载用临时文件，而程序看到的第一个参数
 * 应该是用户敲的那个源文件 —— 它读 argv() 时不该看见一个临时名字。 */
static int run_bytecode(const char *path, const char *argv0, int nrest, char **rest, int 限) {
  size_t len = 0;
  uint8_t *bytes = read_file(path, &len);
  if (!bytes) {
    fprintf(stderr, "HMYR-E0009 cannot read that bytecode file: %s\n", path);
    return 1;
  }
  load_program(bytes, len);
  step_limit = 限;
  steps = 0;
  g_failed = 0;

  /* 第一个槽位是脚本自己，之后才是参数 —— 与启动器那一层的约定一致。 */
  g_argv = v_null();
  g_argv.tag = T_TUPLE;
  g_argv.ilen = (uint32_t)(nrest + 1);
  g_argv.items = alloc_values(g_argv.ilen);
  {
    uint32_t n16 = 0;
    uint16_t *u = utf8_to_utf16(argv0, strlen(argv0), &n16);
    g_argv.items[0] = v_str(u, n16);
  }
  for (int i = 0; i < nrest; i++) {
    uint32_t n16 = 0;
    uint16_t *u = utf8_to_utf16(rest[i], strlen(rest[i]), &n16);
    g_argv.items[i + 1] = v_str(u, n16);
  }

  /* 入口：带参数时用 命令行入口，否则用 main。自举层两个都有 ——
   * main 是它自己的四行自测，命令行入口 是真的那个。 */
  Func *entry = NULL;
  Func *cli = NULL;
  {
    const uint16_t cli_name[] = { 0x547D, 0x4EE4, 0x884C, 0x5165, 0x53E3 };
    for (uint32_t i = 0; i < nfuncs; i++) {
      Func *f = &funcs[i];
      if (f->name_len == 4 && f->name[0] == 'm' && f->name[1] == 'a' && f->name[2] == 'i' && f->name[3] == 'n') entry = f;
      if (f->name_len == 5) {
        uint32_t same = 1;
        for (uint32_t k = 0; k < 5; k++) if (f->name[k] != cli_name[k]) { same = 0; break; }
        if (same) cli = f;
      }
    }
  }
  if (cli && nrest > 0) entry = cli;
  if (!entry) { fprintf(stderr, "HMYR-E0009 no main in %s\n", path); return 1; }

  Value r = run_func(entry, NULL, 0);
  if (g_trace_on) trace_dump();
  if (g_failed) {
    fprintf(stderr, "%s\n", g_fail_msg);
    return 1;
  }
  /* 返回值就是退出码，不是输出。自举层自己会打印它那份验收的编号，
   * 而一台机器不欠谁这一行。 */
  return (r.tag == T_NUM) ? (int)r.num : 0;
}

/* 启动器的正文：两趟。第一趟种子编，第二趟跑编出来的那一份。 */
static int cli_main(int argc, char **argv) {
  char 种子[1024];
  if (!找种子(种子, sizeof 种子, argv[0])) {
    fprintf(stderr, "HMYR-E0009 no seed: put bootstrap/pack.hmyrb beside this program, "
                    "or say where it is with HMYR_SEED\n");
    return 2;
  }
  char 临时[1024];
  临时路径(临时, sizeof 临时);
  remove(临时);

  {
    /* 种子要两样：输出路径，以及源文件。它的 argv 约定是
     * argv()[1] 是输出、argv()[2..] 是源 —— 所以这两个是「其余参数」。 */
    char *参[2];
    参[0] = 临时;
    参[1] = argv[1];
    g_compile_quiet = 1;
    int 码 = run_bytecode(种子, 种子, 2, 参, 200000000);
    g_compile_quiet = 0;
    if (码 != 0) {
      remove(临时);
      fprintf(stderr, "HMYR-E0009 the seed could not compile %s\n", argv[1]);
      return 码 == 0 ? 1 : 码;
    }
  }
  if (!文件在(临时)) {
    remove(临时);
    fprintf(stderr, "HMYR-E0009 the seed said it wrote %s, and it is not there\n", 临时);
    return 1;
  }

  unload_program();
  {
    int nrest = argc - 2;
    char **参 = (char **)malloc(sizeof(char *) * (size_t)(nrest > 0 ? nrest : 1));
    if (!参) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
    for (int i = 0; i < nrest; i++) 参[i] = argv[i + 2];
    int 码 = run_bytecode(临时, argv[1], nrest, 参, 步限从环境());
    /* HMYR_KEEP 留着那份字节码：查「编错了还是跑错了」的时候，
     * 手上有那份文件与没有，是完全两件事。 */
    if (!getenv("HMYR_KEEP")) {
      remove(临时);
    } else {
      fprintf(stderr, "HMYR_KEEP kept %s\n", 临时);
    }
    return 码;
  }
}

/* ---- 命令行参数：Windows 上要自己再切一次 -----------------------------
 *
 * main 拿到的 argv 是按系统代码页解出来的。中文路径在那一步就已经坏了，
 * 而这一层要用那份路径去开文件 —— 于是「文件明明在，它说没有」。
 * 原始命令行还以宽字符留着，所以自己再切一次，按 UTF-8 交出去。
 *
 * 切法照 Windows 的规矩：空白分隔；双引号括起来的算一个；
 * 引号里的两个双引号表示一个引号；反斜槓在引号前成对时保留一半。
 * 这是 MSVCRT 的那一套，Windows 上所有程序看到的参数都是按它切的。
 */
#ifdef _WIN32
static char **切宽命令行(int *argc_out) {
  const wchar_t *p = GetCommandLineW();
  if (!p) return NULL;
  size_t cap = 8, n = 0;
  char **出 = (char **)malloc(cap * sizeof(char *));
  if (!出) return NULL;
  while (*p) {
    while (*p == L' ' || *p == L'\t') p++;
    if (!*p) break;
    wchar_t 缓[4096];
    size_t 长 = 0;
    int 引号 = 0;
    while (*p) {
      wchar_t c = *p;
      if (!引号 && (c == L' ' || c == L'\t')) break;
      if (c == L'\\') {
        size_t 数 = 0;
        while (*p == L'\\') { 数++; p++; }
        if (*p == L'"') {
          /* 成对的反斜槓留一半，落单的那个转义引号。 */
          for (size_t k = 数 / 2; k > 0; k--) { if (长 < 4095) 缓[长++] = L'\\'; }
          if (数 % 2) { if (长 < 4095) 缓[长++] = L'"'; p++; }
        } else {
          for (size_t k = 数; k > 0; k--) { if (长 < 4095) 缓[长++] = L'\\'; }
        }
        continue;
      }
      if (c == L'"') {
        if (引号 && p[1] == L'"') { if (长 < 4095) 缓[长++] = L'"'; p += 2; continue; }
        引号 = !引号;
        p++;
        continue;
      }
      if (长 < 4095) 缓[长++] = c;
      p++;
    }
    缓[长] = 0;
    if (n == cap) {
      cap *= 2;
      char **再 = (char **)realloc(出, cap * sizeof(char *));
      if (!再) return 出;
      出 = 再;
    }
    出[n++] = utf16_to_utf8((const uint16_t *)缓, (uint32_t)长);
  }
  *argc_out = (int)n;
  return 出;
}
#endif

int main(int argc, char **argv) {
#ifdef _WIN32
  /* 先换成宽命令行切出来的那一份：main 给的那份已经把中文路径弄坏了。 */
  {
    int 宽数 = 0;
    char **宽参 = 切宽命令行(&宽数);
    if (宽参 && 宽数 > 0) { argc = 宽数; argv = 宽参; }
  }
#endif
  if (argc < 2) {
    fprintf(stderr, "usage: hmyr program.hmyr [arguments]\n"
                    "   or: hmyr program.hmyrb [arguments]\n");
    return 2;
  }
#ifdef _WIN32
  /* 输出按字节写。Windows 的文本模式会把每个换行翻成两个字节，于是
   * 同一个程序在这台机器上多出一样东西 —— 而「两台机器同一个答案」
   * 这句话里，答案指的是交出去的那串字节。 */
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif
  g_trace_on = getenv("HMYR_TRACE") != NULL;
  g_calls_on = getenv("HMYR_CALLS") != NULL;
  g_fields_on = getenv("HMYR_FIELDS") != NULL;
  for (int i = 0; i < TRACE_N; i++) g_trace[i].op = 255;
  if (getenv("HMYR_MEM")) atexit(堆账报一下);
  {
    /* 上限：给了就照给的，给 0 表示不限。 */
    const char *ml = getenv("HMYR_MEM_LIMIT");
    if (ml) {
      long v = atol(ml);
      g_mem_limit = v > 0 ? (size_t)v * 1024 * 1024 : 0;
    }
  }

  /* 两个入口：给一份源码时先编再跑（启动器那一面），给一份字节码时直接跑。
   * 判据是后缀 —— 别看文件内容去猜，猜错的时候症状比报错难查得多。 */
  {
    size_t 名长 = strlen(argv[1]);
    if (名长 > 5 && strcmp(argv[1] + 名长 - 5, ".hmyr") == 0) return cli_main(argc, argv);
  }
  return run_bytecode(argv[1], argv[1], argc - 2, argv + 2, 步限从环境());
}
