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

/* 内置种子：桌面那一支把整份编译器编进来，于是这个可执行文件自带编译能力。
 * 板子上不编它 —— 那台没有文件系统，也用不到 cli_main；而且几百千字节的常量
 * 会把 flash 塞满，那不是「最小机器层」该有的样子。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
#include "pack_seed.h"
#endif


#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <process.h>
#include <direct.h>
#include <wchar.h>
#elif !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
/* 裸机的 C 库没有 unistd.h —— ARM 那一边 pid 也没有意义（见 临时路径）。 */
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>
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

/* 列一个目录：交回名字的数组（UTF-8，已排好序），*out_n 是条数。
 *
 * 注意这个函数在 #define malloc→hm_malloc 之前，所以它用的是系统堆。
 * 调用处必须用 原free 释放，不能让它走 hm_free —— 两套堆的指针混着释放，
 * 症状是 0xC0000374（堆损坏），而错误信息里一个字都不会说这件事。
 * 把这两个函数挪到宏之后也是对的，那样全走 hm_*；选现在这条是因为它不动已有的行。
 *
 * 排序放在这里，不留给调用者：「两台机器交回同一个顺序」是清单能逐字节比对的前提，
 * 而目录顺序是文件系统的习惯，不是语言的。JS 那一侧与这一侧都排，于是两边一致。
 *
 * 四种结局要分得开：
 *   打不开        -> NULL
 *   打开了但是空的 -> 一个非 NULL 的哑指针，*out_n = 0
 *   有名字        -> 数组，*out_n 是条数
 *   裸机 ARM      -> NULL（那一边没有「一个目录」这种东西，与 unistd.h 同一个条件）
 */
static int 比名字(const void *a, const void *b) {
  return strcmp(*(const char *const *)a, *(const char *const *)b);
}

static char **列目录(const char *utf8, uint32_t *out_n) {
  *out_n = 0;
  char **名们 = NULL;
  uint32_t 数 = 0, 容 = 0;
#if defined(_WIN32)
  int 宽长 = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
  if (宽长 <= 0) return NULL;
  wchar_t *宽 = (wchar_t *)malloc((size_t)(宽长 + 2) * sizeof(wchar_t));
  if (!宽) return NULL;
  MultiByteToWideChar(CP_UTF8, 0, utf8, -1, 宽, 宽长);
  /* 宽长 含结尾的那个 0，所以它的位置是 宽长 - 1；往后拼一个 \* 通配符。 */
  size_t 末位 = (size_t)宽长 - 1;
  宽[末位] = L'\\';
  宽[末位 + 1] = L'*';
  宽[末位 + 2] = 0;
  WIN32_FIND_DATAW 找;
  HANDLE h = FindFirstFileW(宽, &找);
  free(宽);
  if (h == INVALID_HANDLE_VALUE) return NULL;
  do {
    if (wcscmp(找.cFileName, L".") == 0 || wcscmp(找.cFileName, L"..") == 0) continue;
    int 字节数 = WideCharToMultiByte(CP_UTF8, 0, 找.cFileName, -1, NULL, 0, NULL, NULL);
    if (字节数 <= 0) continue;
    char *名 = (char *)malloc((size_t)字节数);
    if (!名) break;
    WideCharToMultiByte(CP_UTF8, 0, 找.cFileName, -1, 名, 字节数, NULL, NULL);
    if (数 == 容) {
      容 = 容 ? 容 * 2 : 16;
      名们 = (char **)realloc(名们, (size_t)容 * sizeof(char *));
    }
    名们[数++] = 名;
  } while (FindNextFileW(h, &找));
  FindClose(h);
#elif !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
  DIR *d = opendir(utf8);
  if (!d) return NULL;
  struct dirent *项;
  while ((项 = readdir(d)) != NULL) {
    if (strcmp(项->d_name, ".") == 0 || strcmp(项->d_name, "..") == 0) continue;
    char *名 = (char *)malloc(strlen(项->d_name) + 1);
    if (!名) break;
    strcpy(名, 项->d_name);
    if (数 == 容) {
      容 = 容 ? 容 * 2 : 16;
      名们 = (char **)realloc(名们, (size_t)容 * sizeof(char *));
    }
    名们[数++] = 名;
  }
  closedir(d);
#else
  /* 裸机上这两个变量没有用处：没有目录可列，也没有名字要收。 */
  (void)utf8;
  (void)容;
  return NULL;
#endif
  if (数 > 0) qsort(名们, (size_t)数, sizeof(char *), 比名字);
  *out_n = 数;
  /* 空目录要交回一个非 NULL：NULL 是「打不开」，这两种结局不能混成一种。 */
  if (名们 == NULL) 名们 = (char **)calloc(1, sizeof(char *));
  return 名们;
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

typedef enum { T_NULL, T_NUM, T_STR, T_BOOL, T_TUPLE, T_ARRAY, T_RECORD, T_INDEX } Tag;

typedef struct Value Value;
typedef struct 索引 索引;

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
  索引 *idx;           /* index: a keyed table, see below */
};

/* ---- 这台机器：状态收在一个地方 -------------------------------------
 *
 * design/SELFRUN.txt 那一格的第二、三半。回收的根先收进了 gc_标根（一个名字），
 * 再收进这个结构；随后执行位置也进来了 —— 因为它们与根一样，是「每台机器一份」。
 *
 * 为什么值得：线程要的是「第二台机器」。而第二台机器的根与执行位置
 * 都不该再借第一个的。收成结构之后，那件事只剩下「把这个对象变成每台一份」。
 *
 * 还差的一样东西是签名：这些字段今天是全局 g_机 的字段，任何函数都能直接读。
 * 真正实例化要的是「每个跑指令的函数收下一个 Hmyr机器 *」—— 那是最后一刀，
 * 价码在 tools/machine-scope.mjs 里：十四个函数直接读这些位置，
 * 而它们各自又被别处调用。这一份的边界写在这里，否则下一刀会以为已经收完了。
 *
 * 键队列的大小原先定义在终端那一段（#define KEY_环 16），现在提到这里：
 * 一个结构体要知道自己数组有多大，而宏跟着它走比留在八百行之外好读。
 */

#define KEY_环 16

typedef struct 帧记录 帧记录;   /* 定义在下面：这里只要一个指针 */
typedef struct Func Func;       /* 同上 */

typedef struct {
  /* ---- 回收要找的根 ---- */
  /* 操作栈：每一帧的槽都在里面 */
  Value *stack;
  uint32_t stack_n, stack_cap;
  /* 程序参数 */
  Value argv;
  /* 终端键队列：环形，头与计数 */
  Value 键们[KEY_环];
  int 键头, 键数;
  /* 帧链：每一帧一个记录，向上串 */
  帧记录 *帧链;
  /* 函数表：指令里带着常量值 */
  Func *函数们;
  uint32_t 函数数;

  /* ---- 执行位置：不是根，但同样是「每台一份」 ---- */
  /* 当前帧的槽起点（操作栈里的下标） */
  uint32_t 基址;
  /* 正在跑的那个函数：报错定位与诊断输出要用它 */
  Func *当前函数;
  /* 已跑步数，与它的上限 */
  long 步数;
  int 步限;
} Hmyr机器;

/* 主机：一台进程里必然有的那一个。线程要的是「第二台」，所以 g_机 是指针 ——
 * 这一刀只换形状，行为一个字节都不变（宿主那一份在 main 之前没人碰它）。 */
static Hmyr机器 主机;
static Hmyr机器 *g_机 = &主机;

/* ---- 索引：一个按键查的东西 ------------------------------------------
 *
 * design/INDEX.txt 定了约定，这一份把它做出来。C 那台原先在这里答一句
 * 具体的拒绝（「键是运行时的字符串，那要一张真正的哈希表」）—— 而这张表
 * 用的不是哈希：排序数组加二分。
 *
 * 为什么不用哈希：INDEX.txt 第五节把这个选择留给实现，判据是用法 ——
 * 语料生成是「先全放、再全查」。排序数组在那里每个 set 是 O(1) 追加，
 * 第一次查之前排一次（O(n log n)），之后每次查 O(log n)。哈希表要多一段
 * 桶内存，还得处理删除；这一台不需要删除。
 *
 * 懒排序：set 只追加并标脏，查之前若脏则排一次。覆盖同一个键不追加，
 * 也就不动它的序号 —— 那是 INDEX.txt 第三条约定：键序留在第一次那儿。
 */
typedef struct {
  const uint16_t *键;   /* 码元，走 串存 */
  uint32_t 键长;
  uint32_t 序号;
  Value 值;
} 索引项;

struct 索引 {
  索引项 *项;
  uint32_t n, cap;
  uint32_t 下一个序号;
  int 已排;
};

static Value v_null(void) { Value v; memset(&v, 0, sizeof v); v.tag = T_NULL; return v; }
static Value v_num(double n) { Value v = v_null(); v.tag = T_NUM; v.num = n; return v; }
static Value v_bool(int b) { Value v = v_null(); v.tag = T_BOOL; v.boolean = b ? 1 : 0; return v; }
/* ---- 回收：开关与分配入口 ---------------------------------------------
 *
 * 这一台的分配一直不回收，于是「一份一份编」时前面几份的堆全留着 ——
 * 自编译峰值 3.145 GB 就是这么来的。
 *
 * 收两样：Value 数组（元组的元素、记录的 vals、调用帧的槽）与字符串。
 * 字符串能收的前提是「交给 Value 的每一段都从 串存 来」——
 * slice 因此改成拷贝：子串指针落在块中间的话，地址表查不到它，
 * 而查不到就等于「不是我的块」，那一段就会在父串被收掉之后悬空。
 *
 * 文件镜像里的字符串不在这条链上（它们指向装载缓冲区），
 * 所以标记时查不到，也就永远不收 —— 那正是它们该有的待遇。
 *
 * 默认不开。HMYR_GC=1 打开，阈值默认 32 MB（HMYR_GC_BYTES 改）。
 * 实现见 run_func 之前那一段：它要知道帧链与根在哪儿。
 */
static int g_gc开 = 0;
static void *gc_分配(size_t 字节, int 种类);
static uint16_t *gc_串分配(size_t 码元数);

/* 一段 UTF-16 的存储：回收开着就交给回收，否则照旧走堆。 */
static uint16_t *串存(size_t 码元数) {
  if (g_gc开) return gc_串分配(码元数);
  {
    uint16_t *p = (uint16_t *)malloc((码元数 ? 码元数 : 1) * sizeof(uint16_t));
    if (!p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
    return p;
  }
}

static Value v_str(const uint16_t *p, uint32_t len) {
  Value v = v_null(); v.tag = T_STR; v.s = p; v.slen = len; return v;
}

/* 一个 ASCII 串变成语言里的字符串。终端与诊断都拿它交回短序列：
 * 那些序列里没有一个字节是中文，所以逐字节摊成码元就够。 */
static Value ascii_text(const char *s) {
  size_t n = strlen(s);
  uint16_t *p = 串存(n ? n : 1);
  for (size_t i = 0; i < n; i++) p[i] = (uint16_t)(unsigned char)s[i];
  return v_str(p, (uint32_t)n);
}

/* ---- 时间 ------------------------------------------------------------
 *
 * now_ms 是墙上时间（毫秒）。板子上还没有时钟源，于是给 0 —— 「没有这一格」
 * 说成 0，而不是编一个数出来；文档里写清这一条。
 * sleep_ms 在桌面上真的睡；板子上空转（没有 sleep 系统调用），
 * 而它的返回值是它答应等的毫秒数，不是它实际等了多久。 */
static double 现在毫秒(void) {
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
  return 0.0;
#elif defined(_WIN32)
  FILETIME ft;
  ULARGE_INTEGER u;
  GetSystemTimeAsFileTime(&ft);
  u.LowPart = ft.dwLowDateTime;
  u.HighPart = ft.dwHighDateTime;
  /* FILETIME 从 1601-01-01 起算，单位 100 纳秒；这一句把它换成 1970 起的毫秒。 */
  return (double)((u.QuadPart - 116444736000000000ULL) / 10000ULL);
#else
  struct timespec ts;
  timespec_get(&ts, TIME_UTC);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1000000.0;
#endif
}

static void 睡多久(long ms) {
  if (ms <= 0) return;
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
  /* 空转：板子上没有 sleep，而「等一等」这件事仍然要有个交代。 */
  volatile long i;
  for (i = 0; i < ms * 1000; i++) { }
#elif defined(_WIN32)
  Sleep((DWORD)ms);
#else
  {
    struct timespec ts;
    ts.tv_sec = (time_t)(ms / 1000);
    ts.tv_nsec = (long)(ms % 1000) * 1000000L;
    nanosleep(&ts, NULL);
  }
#endif
}

/* ---- 环境与路径 ------------------------------------------------------
 *
 * 这一组读的是「这台机器在哪儿」：当前目录、主目录、临时目录、仓库根。
 * 所以两台机器给出不同的字符串是对的 —— 契约里写的是「读宿主的位置」，
 * 不是「所有宿主必须同名」。测试因此只断言形状与结尾，不断言整串。
 *
 * 两个如实说「没有」的：
 *   repo_path  这台机器没有仓库根。设了 HMYR_REPO 就用它，否则把相对路径原样交回。
 *   python_path 这台机器不是 Python 宿主 —— 没有那一条托管路径可给。
 */
static char g_locale[32] = "";
static const char *locale_名字们[] = {"zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"};

/* 定义在后面（装载那一节）；这里先用一次，所以先声明。 */
static uint16_t *utf8_to_utf16(const char *s, size_t len, uint32_t *out_len);

static char *拼接(const char *a, const char *b) {
  size_t na = strlen(a), nb = strlen(b);
  char *p = (char *)malloc(na + nb + 1);
  if (!p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  memcpy(p, a, na);
  memcpy(p + na, b, nb + 1);
  return p;
}

/* UTF-8 的 C 串变成语言里的字符串。路径与环境都可能不是纯 ASCII。 */
static Value 路径值(const char *utf8) {
  uint32_t n = 0;
  uint16_t *p = utf8_to_utf16(utf8, (uint32_t)strlen(utf8), &n);
  return v_str(p, n);
}

/* 环境变量，没有就给空串。板子上 getenv 是空的（见 port/arm-port.c），
 * 于是这一组在板子上全部交回空串 —— 那是「没有」，不是「碰巧是空」。 */
static const char *环境(const char *名) {
  const char *v = getenv(名);
  return (v && *v) ? v : "";
}

/* ---- 跑一个程序 ------------------------------------------------------
 *
 * 结果五件：退出码、stdout、stderr、有没有超时、跑不起来时的错误码。
 * 它们照实报告，不抛 —— 「程序没找到」是关于世界的结论，不是脚本的错。
 *
 * 完整实现只有 Windows 这一份（本机可验收）。别的平台交回一条明确的
 * 错误码，而不是一个看起来像成功的空结果。
 */
typedef struct { char *p; size_t n, cap; } 字节串;

#ifdef _WIN32
static void 字节串放(字节串 *b, const char *s, size_t n) {
  if (b->n + n + 1 > b->cap) {
    size_t 新 = b->cap ? b->cap : 4096;
    while (b->n + n + 1 > 新) 新 *= 2;
    b->p = (char *)realloc(b->p, 新);
    if (!b->p) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
    b->cap = 新;
  }
  memcpy(b->p + b->n, s, n);
  b->n += n;
  b->p[b->n] = 0;
}
#endif

/* 去掉尾部空白，与 JS 那侧的 trimEnd 一致：那是契约里写明的形状。 */
static void 字节串去尾白(字节串 *b) {
  while (b->n > 0) {
    char c = b->p[b->n - 1];
    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { b->n--; b->p[b->n] = 0; }
    else break;
  }
}

#ifdef _WIN32
/* 一个参数按 MSVCRT 的规矩加引号，拼到宽命令行后面。
 * 与切宽命令行那一份是同一套规矩的两面。 */
static void 宽拼参(wchar_t *dst, size_t cap, size_t *at, const wchar_t *s) {
  int 需引 = (*s == 0) || wcschr(s, L' ') || wcschr(s, L'\t') || wcschr(s, L'"');
  if (*at + 2 < cap) dst[(*at)++] = L' ';
  if (需引 && *at + 2 < cap) dst[(*at)++] = L'"';
  size_t 斜杠 = 0;
  for (const wchar_t *p = s; ; p++) {
    if (*p == L'\\') { 斜杠++; continue; }
    if (*p == L'"') {
      for (size_t k = 0; k < 斜杠 * 2 + 1 && *at + 1 < cap; k++) dst[(*at)++] = L'\\';
      斜杠 = 0;
      if (*at + 1 < cap) dst[(*at)++] = L'"';
      continue;
    }
    for (size_t k = 0; k < 斜杠 && *at + 1 < cap; k++) dst[(*at)++] = L'\\';
    斜杠 = 0;
    if (!*p) break;
    if (*at + 1 < cap) dst[(*at)++] = *p;
  }
  if (需引 && *at + 1 < cap) dst[(*at)++] = L'"';
}

static void 读管道(HANDLE h, 字节串 *b) {
  for (;;) {
    DWORD 可读 = 0;
    if (!PeekNamedPipe(h, NULL, 0, NULL, &可读, NULL) || 可读 == 0) break;
    char 缓[4096];
    DWORD 得 = 0;
    DWORD 要 = 可读 < (DWORD)sizeof 缓 ? 可读 : (DWORD)sizeof 缓;
    if (!ReadFile(h, 缓, 要, &得, NULL) || 得 == 0) break;
    字节串放(b, 缓, 得);
  }
}
#endif

/* 输出解码：utf8 一条路，gbk 一条路（中文 Windows 的控制台多半是它）。
 * 别的编码名按 utf8 读 —— 契约里只承诺这两种。 */
static Value 解码输出(const 字节串 *b, const char *编码) {
  const char *s = b->p ? b->p : "";
  size_t n = b->n;
#ifdef _WIN32
  if (编码 && (strcmp(编码, "gbk") == 0 || strcmp(编码, "gb2312") == 0 || strcmp(编码, "cp936") == 0)) {
    int 长 = MultiByteToWideChar(936, 0, s, (int)n, NULL, 0);
    if (长 > 0) {
      uint16_t *p = 串存((size_t)长);
      int 得 = MultiByteToWideChar(936, 0, s, (int)n, (wchar_t *)p, 长);
      return v_str(p, (uint32_t)得);
    }
  }
#endif
  {
    uint32_t 长 = 0;
    uint16_t *p = utf8_to_utf16(s, n, &长);
    return v_str(p, 长);
  }
}
/* 现在的工作目录（UTF-8）。cwd 与 chdir 共用它 ——
 * chdir 成功之后要交回新的目录，那是同一条读法。 */
static char *现在工作在(void) {
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
  return 拼接("", "");
#elif defined(_WIN32)
  {
    wchar_t wbuf[2048];
    if (_wgetcwd(wbuf, 2048)) {
      char u[8192];
      WideCharToMultiByte(CP_UTF8, 0, wbuf, -1, u, (int)sizeof u, NULL, NULL);
      return 拼接("", u);
    }
    return 拼接("", "");
  }
#else
  {
    char buf[4096];
    if (getcwd(buf, sizeof buf)) return 拼接("", buf);
    return 拼接("", "");
  }
#endif
}

/* ---- 一条键队列 ------------------------------------------------------
 *
 * 套件塞键、真终端读键，共用同一条队列。有界（64）：满了就不收，
 * 交回当前长度 —— 这一条差异写在 CAPABILITIES.txt 里。 */
#ifdef _WIN32
static DWORD g_原控制台模式 = 0;
static int g_有原模式 = 0;
#endif

static void 键入队(Value v) {
  if (g_机->键数 >= KEY_环) return;
  g_机->键们[(g_机->键头 + g_机->键数) % KEY_环] = v;
  g_机->键数++;
}

static Value 键出队(void) {
  if (g_机->键数 == 0) return v_null();
  Value v = g_机->键们[g_机->键头];
  g_机->键头 = (g_机->键头 + 1) % KEY_环;
  g_机->键数--;
  return v;
}

/* 一条 UTF-16 串拆成「键」：每个是一到两个码元。
 * 与 JS 那侧的 for...of 一致 —— 代理对算一个键，不拆成两个。
 * 板子上没有 stdin，所以这一支只在桌面那两条路上编译。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
static int 拆码点(Value s, Value *out, int 上限) {
  int n = 0;
  uint32_t i = 0;
  while (i < s.slen && n < 上限) {
    uint32_t cp = s.s[i], 长 = 1;
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.slen) {
      uint32_t 低 = s.s[i + 1];
      if (低 >= 0xDC00 && 低 <= 0xDFFF) 长 = 2;
    }
    out[n++] = v_str(s.s + i, 长);
    i += 长;
  }
  return n;
}
#endif

static Value *alloc_values(uint32_t n) {
  size_t 字节 = (size_t)(n ? n : 1) * sizeof(Value);
  if (!g_gc开) {
    Value *p = (Value *)hm_calloc(n ? n : 1, sizeof(Value));
    return p;
  }
  {
    Value *p = (Value *)gc_分配(字节, 0);
    memset(p, 0, 字节);
    return p;
  }
}

/* ---- 索引：造、留、找 ------------------------------------------------
 *
 * 三个入口放在这里，因为它们的约定只有彼此知道：项数组由 索引留 整块换新，
 * 二分只在 已排 为真时成立。摊进内置那一大段会让「谁改 已排」散在四处，
 * 而这类散法最后总以「某一次取值拿到错的东西」收场。
 */
static 索引 *索引造(void) {
  索引 *t;
  if (g_gc开) {
    t = (索引 *)gc_分配(sizeof(索引), 3);   /* 种类 3：里面只有指针与计数，没有 Value */
    memset(t, 0, sizeof(索引));
  } else {
    t = (索引 *)hm_calloc(1, sizeof(索引));
  }
  if (!t) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  t->已排 = 1;
  return t;
}

/* 扩容：GC 开着就换一块新的、把旧的留给回收（GC 块不能 realloc）。
 * 旧块里的键与值已经被 memcpy 到新块，而标记只跟新块走 —— 所以不会少标。 */
static void 索引留(索引 *t, uint32_t 要) {
  索引项 *项;
  uint32_t 新;
  if (t->cap >= 要) return;
  新 = t->cap ? t->cap * 2 : 16;
  while (新 < 要) 新 *= 2;
  if (g_gc开) {
    项 = (索引项 *)gc_分配((size_t)新 * sizeof(索引项), 2);
    memset(项, 0, (size_t)新 * sizeof(索引项));
  } else {
    项 = (索引项 *)hm_calloc(新, sizeof(索引项));
  }
  if (!项) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  if (t->n) memcpy(项, t->项, (size_t)t->n * sizeof(索引项));
  t->项 = 项;
  t->cap = 新;
}

/* 两个键的字典序：先逐码元，短的在前。 */
static int 键比(const uint16_t *a, uint32_t an, const uint16_t *b, uint32_t bn) {
  uint32_t m = an < bn ? an : bn;
  for (uint32_t i = 0; i < m; i++) if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
  if (an == bn) return 0;
  return an < bn ? -1 : 1;
}

static int 索引比(const void *a, const void *b) {
  const 索引项 *x = (const 索引项 *)a;
  const 索引项 *y = (const 索引项 *)b;
  return 键比(x->键, x->键长, y->键, y->键长);
}

/* 交回下标，没有交回 -1。脏表先排一次 —— 排序只在「查」这一侧发生，
 * 因为语料生成是几万次放配几千次取。 */
static int 索引找(索引 *t, const uint16_t *键, uint32_t 键长) {
  uint32_t 低, 高;
  if (!t->已排) { qsort(t->项, t->n, sizeof(索引项), 索引比); t->已排 = 1; }
  低 = 0; 高 = t->n;
  while (低 < 高) {
    uint32_t 中 = 低 + (高 - 低) / 2;
    int c = 键比(t->项[中].键, t->项[中].键长, 键, 键长);
    if (c == 0) return (int)中;
    if (c < 0) 低 = 中 + 1; else 高 = 中;
  }
  return -1;
}

/* 放一个：已有的改值（序号不动），没有的追加并标脏。
 * 脏表里只能线性找 —— 那张表最多只有「自上次排序以来的新增」那么多项。 */
static void 索引放(索引 *t, const uint16_t *键, uint32_t 键长, Value 值) {
  int 已有 = -1;
  if (t->已排) {
    已有 = 索引找(t, 键, 键长);
  } else {
    for (uint32_t i = 0; i < t->n; i++) {
      if (键比(t->项[i].键, t->项[i].键长, 键, 键长) == 0) { 已有 = (int)i; break; }
    }
  }
  if (已有 >= 0) { t->项[已有].值 = 值; return; }
  索引留(t, t->n + 1);
  {
    uint16_t *拷贝 = 串存(键长 ? 键长 : 1);
    if (!拷贝) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
    for (uint32_t i = 0; i < 键长; i++) 拷贝[i] = 键[i];
    t->项[t->n].键 = 拷贝;
    t->项[t->n].键长 = 键长;
    t->项[t->n].序号 = t->下一个序号++;
    t->项[t->n].值 = 值;
    t->n++;
    t->已排 = 0;
  }
}

/* 大小写：逐码点查表。上界是「每个单元都摊成三份」，因为表里最长的一条是三个单元。 */
static Value case_fold(Value s, int up) {
  const HmyrCaseEntry *tab = up ? ucd_upper_map : ucd_lower_map;
  size_t count = up ? ucd_upper_map_count : ucd_lower_map_count;
  const uint16_t *src = s.s;
  uint32_t n = s.slen;
  uint16_t *p = 串存((size_t)((size_t)n * 3 + 1));
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
  uint16_t *p = 串存((size_t)(b.n ? b.n * 2 : 1));
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

typedef struct Func {
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

// 按 UTF-16 码元比名字。name_is 用的是 ASCII 字节，而中文名字（数组、设）
// 在名字表里是码元 —— 拿字节去比永远不相等。
static int name_is16(int64_t idx, const uint16_t *u, uint32_t n) {
  if (idx < 0 || (uint32_t)idx >= pool_n) return 0;
  if (pool_len[idx] != n) return 0;
  for (uint32_t i = 0; i < n; i++) if (pool_p[idx][i] != u[i]) return 0;
  return 1;
}

static int name_is(int64_t idx, const char *ascii) {
  if (idx < 0 || (uint32_t)idx >= pool_n) return 0;
  uint32_t n = pool_len[idx];
  if (n != strlen(ascii)) return 0;
  for (uint32_t i = 0; i < n; i++) if (pool_p[idx][i] != (uint16_t)(unsigned char)ascii[i]) return 0;
  return 1;
}


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

  g_机->函数数 = rd_u16(&r);
  g_机->函数们 = (Func *)calloc(g_机->函数数 ? g_机->函数数 : 1, sizeof(Func));
  for (uint32_t i = 0; i < g_机->函数数; i++) {
    Func *f = &g_机->函数们[i];
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

/* ---- 平台口：读一个文件的字节、写一段字节 ----------------------------
 *
 * 这一台机器要在四种东西上跑：Windows、POSIX、ARM 裸机、以及以后任何一块板子。
 * 与语言无关、而每台机器都不一样的事只有两件：怎么把一个文件的字节读进来，
 * 怎么把一段 UTF-8 写出去。所以它们成了两个函数指针（见 vm/hmyr-port.h）。
 *
 * 默认是空的两个 —— 空的时候走下面那两份桌面实现，于是桌面上的行为一个字节没变。
 * 板子那边开机时调一次 hmyr_装平台，把「从串口收字节」「往串口发字节」装进去；
 * 语言侧不用改，它只认「读」与「写」这两个动作。
 */
#include "hmyr-port.h"

static Hmyr平台 g_平台 = { NULL, NULL };

void hmyr_装平台(const Hmyr平台 *p) {
  if (p) g_平台 = *p;
}

/* 一个码点编成 UTF-8，交回用掉了几个字节。 */
static int 编码点(unsigned char b[4], uint32_t cp) {
  int n = 0;
  if (cp < 0x80) { b[n++] = (unsigned char)cp; }
  else if (cp < 0x800) { b[n++] = (unsigned char)(0xC0 | (cp >> 6)); b[n++] = (unsigned char)(0x80 | (cp & 0x3F)); }
  else if (cp < 0x10000) { b[n++] = (unsigned char)(0xE0 | (cp >> 12)); b[n++] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F)); b[n++] = (unsigned char)(0x80 | (cp & 0x3F)); }
  else { b[n++] = (unsigned char)(0xF0 | (cp >> 18)); b[n++] = (unsigned char)(0x80 | ((cp >> 12) & 0x3F)); b[n++] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F)); b[n++] = (unsigned char)(0x80 | (cp & 0x3F)); }
  return n;
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
    if (out == stdout) {
      if (g_平台.写) {
        /* 板子那边要的是字节，不是 FILE*：编成一个码点的字节就交出去。 */
        unsigned char b[4];
        int n = 编码点(b, cp);
        g_平台.写(b, (size_t)n);
      } else {
        put_utf8(cp);
      }
    } else {
      unsigned char b[4];
      int n = 编码点(b, cp);
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
  uint16_t *out = 串存(len + 1);
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

/* ---- 调用深度 ---------------------------------------------------------
 *
 * 这台机器的调用是 C 递归：HMYR 里的一层调用就是 C 的一层栈帧。快，但代价是
 * 「程序递归得深」会变成「机器栈吃掉」。栈见底时 Windows 给的只是退出码
 * 0xC00000FD，一行人话都没有 —— 所以这里量它，而不是猜它。
 *
 * HMYR_DEPTH=1：每刷新一次峰值就打一行（深度 + 函数名，每 64 层一记）。
 * 崩掉之前留下的最后一行，就是那段递归的名字。
 * HMYR_MAX_DEPTH=N：到 N 层就自己停下并说明（桌面用；板子上 getenv 是空的）。
 */
static uint32_t g_深度 = 0;
static uint32_t g_最深 = 0;
static int g_depth_on = 0;
static uint32_t g_depth_cap = 0;

static void 函数名(Func *f, char *out, size_t cap) {
  size_t n = 0;
  if (f && cap > 1) {
    n = f->name_len < cap - 1 ? f->name_len : cap - 1;
    for (size_t i = 0; i < n; i++) out[i] = (f->name[i] < 128) ? (char)f->name[i] : '?';
  }
  if (cap) out[n] = 0;
}

static void 记深度(Func *f, Func *父) {
  g_深度++;
  if (g_深度 > g_最深) {
    g_最深 = g_深度;
    if (g_depth_on && (g_深度 < 8 || g_深度 % 64 == 0)) {
      char 子名[64], 父名[48];
      函数名(f, 子名, sizeof 子名);
      函数名(父, 父名, sizeof 父名);
      char *名 = utf16_to_utf8(f->name, f->name_len);
      fprintf(stderr, "DEPTH %u #%ld %s (from %s) %s\n", (unsigned)g_深度,
              (long)(f - g_机->函数们), 子名, 父名, 名 ? 名 : "?");
      free(名);
    }
  }
  if (g_depth_cap && g_深度 > g_depth_cap) {
    char *名 = utf16_to_utf8(f->name, f->name_len);
    fprintf(stderr, "hmyr: calls went %u deep, past the ceiling %u (at %s)\n",
            (unsigned)g_深度, (unsigned)g_depth_cap, 名 ? 名 : "?");
    free(名);
    exit(72);
  }
}

static void push(Value v) {
  if (g_机->stack_n == g_机->stack_cap) {
    g_机->stack_cap = g_机->stack_cap ? g_机->stack_cap * 2 : 256;
    g_机->stack = (Value *)realloc(g_机->stack, g_机->stack_cap * sizeof(Value));
    if (!g_机->stack) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
  }
  g_机->stack[g_机->stack_n++] = v;
}

/* 当前帧的栈基线。弹栈不许越过它 —— 这是全篇最要紧的一处语义对齐。
 *
 * JS 那台的栈是每帧一条数组，弹空只是拿到 undefined，帧外的东西碰不到。
 * C 这台所有帧共用一条栈，若 pop 不认基线，帧内弹空就会吃掉调用者的值：
 * 少一个值，后面所有实参整体错位一格。查了两轮的「实参错位」就是它。 */

static Value pop(void) {
  if (g_机->stack_n <= g_机->基址) return v_null();
  return g_机->stack[--g_机->stack_n];
}

static int truthy(Value v) {
  if (v.tag == T_BOOL) return v.boolean;
  if (v.tag == T_NUM) return v.num != 0;
  if (v.tag == T_STR) return v.slen != 0;
  if (v.tag == T_NULL) return 0;
  if (v.tag == T_TUPLE || v.tag == T_ARRAY) return v.ilen != 0;
  return 1;
}

static int g_failed = 0;
static char g_fail_msg[512];

/* 当前正在跑的函数。诊断用：一条指令的 pc 只在它自己的函数里有意义，
 * 所以报错时要能说出「哪个函数、第几条」。 */

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

/* ---- 回收：标记与清扫 ------------------------------------------------
 *
 * 一次收集做三件事：从根标起（操作栈、argv、键队列、每个活动帧的槽、
 * 函数表里的常量），把没标到的块还掉，再重建地址表。
 * 地址表让「这个指针是不是我的块」变成一次查找 —— 否则标记阶段
 * 会去读一个不属于自己的地址，那种崩法比泄漏难查得多。
 *
 * 板子上不编这一块：地址表在桌面占两兆左右的静态内存，而板子的堆
 * 只有几十千字节。那一台本来也遇不到三吉字节级的自编译。
 */
typedef struct 帧记录 {
  Value *slots;
  uint32_t 槽数;
  struct 帧记录 *上;
} 帧记录;


#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
static void *gc_分配(size_t 字节, int 种类) { (void)字节; (void)种类; return NULL; }
static uint16_t *gc_串分配(size_t 码元数) { (void)码元数; return NULL; }
#else
/* 这三个只在桌面那一支里用：板子上不编回收，也就没有账可记。 */
static size_t g_gc字节 = 0, g_gc数 = 0, g_gc阈值 = 32 * 1024 * 1024;
static int g_gc日志 = 0;
typedef struct Gc块 {
  struct Gc块 *下;
  size_t 载荷;
  uint32_t 标记;
  uint8_t 种类;   /* 0 = Value 数组，1 = UTF-16 串（叶子），
                     2 = 索引项数组（每项一个键指针加一个值，不能按 Value 读），
                     3 = 别的叶子（里面没有 Value，也没有要追的指针） */
} Gc块;

static Gc块 *g_gc链 = NULL;

/* 地址表按需扩容。自编译一次要分配几十万块，表一开始只给四千槽 ——
 * 固定十三万槽的版本在表满之后每次插入都要走一遍全表，慢到十几倍。 */
static void **g_gc键 = NULL;
static Gc块 **g_gc值 = NULL;
static size_t g_gc槽 = 0, g_gc占 = 0;

/* 标记用显式栈，不递归：元组可以套得很深，而标记走的是数据的形状 ——
 * 递归版在自编译那种规模上会把机器栈吃掉（实测退出码 0xC00000FD）。 */
static Gc块 **g_标栈 = NULL;
static size_t g_标数 = 0, g_标容 = 0;

static Gc块 *gc_查(void *p);

static void gc_压标(Gc块 *b) {
  if (!b || b->标记) return;
  b->标记 = 1;
  if (g_标数 == g_标容) {
    size_t 新 = g_标容 ? g_标容 * 2 : 4096;
    g_标栈 = (Gc块 **)hm_realloc(g_标栈, 新 * sizeof(Gc块 *));
    g_标容 = 新;
  }
  g_标栈[g_标数++] = b;
}

static void gc_标值(Value v) {
  if ((v.tag == T_TUPLE || v.tag == T_ARRAY) && v.items) gc_压标(gc_查(v.items));
  else if (v.tag == T_RECORD && v.rec.vals) gc_压标(gc_查(v.rec.vals));
  else if (v.tag == T_STR && v.s) gc_压标(gc_查((void *)v.s));
  /* 索引有两块：表本身（叶子，里面只有指针与计数）与项数组（装键与值，要按项读）。
   * 两块都得压标 —— 挂在链上的块只要不被压标就会被清扫掉，而「表被收掉但项还在」
   * 与「项被收掉但表还在」都只会表现为某一次取值拿到错的东西。 */
  else if (v.tag == T_INDEX && v.idx) {
    gc_压标(gc_查(v.idx));
    if (v.idx->项) gc_压标(gc_查(v.idx->项));
  }
}

static void gc_建表(size_t 槽) {
  g_gc槽 = 槽;
  g_gc占 = 0;
  g_gc键 = (void **)hm_calloc(槽, sizeof(void *));
  g_gc值 = (Gc块 **)hm_calloc(槽, sizeof(Gc块 *));
}

static size_t gc_槽(void *p, size_t 槽数) {
  return (size_t)(((uintptr_t)p >> 3) & (槽数 - 1));
}

static void gc_插(void *p, Gc块 *b);

static void gc_扩容(void) {
  size_t 新槽 = g_gc槽 ? g_gc槽 * 2 : 4096;
  void **旧键 = g_gc键;
  Gc块 **旧值 = g_gc值;
  size_t 旧槽 = g_gc槽;
  gc_建表(新槽);
  for (size_t i = 0; i < 旧槽; i++) if (旧键[i]) gc_插(旧键[i], 旧值[i]);
  if (旧键) hm_free(旧键);
  if (旧值) hm_free(旧值);
}

static void gc_插(void *p, Gc块 *b) {
  if (g_gc占 * 10 >= g_gc槽 * 7) gc_扩容();
  {
    size_t i = gc_槽(p, g_gc槽);
    while (g_gc键[i]) i = (i + 1) & (g_gc槽 - 1);
    g_gc键[i] = p;
    g_gc值[i] = b;
    g_gc占++;
  }
}

static Gc块 *gc_查(void *p) {
  if (!g_gc槽) return NULL;
  {
    size_t i = gc_槽(p, g_gc槽);
    while (g_gc键[i]) {
      if (g_gc键[i] == p) return g_gc值[i];
      i = (i + 1) & (g_gc槽 - 1);
    }
  }
  return NULL;
}

static void *gc_分配(size_t 字节, int 种类) {
  Gc块 *b = (Gc块 *)hm_malloc(sizeof(Gc块) + 字节);
  void *载荷 = (void *)(b + 1);
  b->下 = g_gc链;
  b->载荷 = 字节;
  b->标记 = 0;
  b->种类 = (uint8_t)种类;
  g_gc链 = b;
  g_gc字节 += 字节;
  g_gc数++;
  gc_插(载荷, b);
  return 载荷;
}

static uint16_t *gc_串分配(size_t 码元数) {
  return (uint16_t *)gc_分配((码元数 ? 码元数 : 1) * sizeof(uint16_t), 1);
}

/* ---- 回收的根：一处列出 ---------------------------------------------
 *
 * design/SELFRUN.txt 那一格（把状态收进一个 Hmyr机器 结构）的第一刀就是这里：
 * 先让「根在哪儿」有一个名字，再谈把它搬进结构。两件事分开的理由是它们各自能验 ——
 * 这一刀不改变行为，只把那五处散在 gc_收集 里的压标收到一个函数里。
 *
 * 根有五类，共同点是「解释器还活着，所以这些东西不能收」：
 *
 *   操作栈   g_机->stack 那一段：每一帧的槽都在里面
 *   argv     g_机->argv：程序参数本身是值
 *   键队列   g_机->键们：终端输入推进去的那一串
 *   帧链     g_机->帧链：每一帧的槽数组（标的是块本身，不只是槽里的值）
 *   函数表   g_机->函数们：指令里带着常量值
 *
 * 判据：这五类全在，且 gc_收集 里不再出现第二处压标。
 * 第二刀（Hmyr根 结构）要改的就是这一份 —— 到那时这里的每一行变成 g_机->xxx，
 * 而 gc_收集 一行都不用动。
 */
static void gc_标根(void) {
  for (uint32_t i = 0; i < g_机->stack_n; i++) gc_标值(g_机->stack[i]);
  gc_标值(g_机->argv);
  for (int i = 0; i < g_机->键数; i++) gc_标值(g_机->键们[(g_机->键头 + i) % KEY_环]);
  for (帧记录 *f = g_机->帧链; f; f = f->上) {
    /* 标的是「槽数组」这一个块本身：它也是 alloc_values 分配的，
     * 只标槽里的值会让清扫把它自己收掉 —— 那是「活着的东西被回收」的典型形状。 */
    gc_压标(gc_查(f->slots));
  }
  for (uint32_t i = 0; i < g_机->函数数; i++) {
    Func *fn = &g_机->函数们[i];
    for (uint32_t j = 0; j < fn->ncode; j++) gc_标值(fn->code[j].val);
  }
}

static size_t gc_收集(void) {
  size_t 前 = g_gc字节;
  size_t 前数 = g_gc数;
  if (g_gc日志) fprintf(stderr, "gc: 开始 前 %llu 字节 %llu 块\n",
                        (unsigned long long)前, (unsigned long long)前数);
  gc_标根();
  /* 显式栈把标记走完：每弹一个块，把它里面的值再压进去。
   * 字符串块是叶子 —— 它的载荷是码元，不是 Value，不能按 Value 去读。 */
  while (g_标数 > 0) {
    Gc块 *b = g_标栈[--g_标数];
    if (b->种类 == 1 || b->种类 == 3) continue;
    if (b->种类 == 2) {
      /* 索引项数组：每项一个键指针加一个值。不能按 Value 读 ——
       * 索引项比 Value 大，那样读会把后面的项错位成前面项的一部分。 */
      索引项 *项 = (索引项 *)(b + 1);
      size_t n = b->载荷 / sizeof(索引项);
      for (size_t i = 0; i < n; i++) {
        if (项[i].键) gc_压标(gc_查((void *)项[i].键));
        gc_标值(项[i].值);
      }
      continue;
    }
    {
      Value *v = (Value *)(b + 1);
      size_t n = b->载荷 / sizeof(Value);
      for (size_t i = 0; i < n; i++) gc_标值(v[i]);
    }
  }
  {
    Gc块 *存活 = NULL;
    size_t 字节 = 0, 数 = 0;
    Gc块 *b = g_gc链;
    while (b) {
      Gc块 *下 = b->下;
      if (b->标记) {
        b->标记 = 0;
        b->下 = 存活;
        存活 = b;
        字节 += b->载荷;
        数++;
      } else {
        hm_free(b);
      }
      b = 下;
    }
    g_gc链 = 存活;
    g_gc字节 = 字节;
    g_gc数 = 数;
  }
  /* 表按活块数重建：清扫之后块数掉下去，表也该跟着小下来 ——
   * 否则下一次增长又要撞上扩容。 */
  {
    size_t 新 = 4096;
    while (新 < (g_gc数 + 1) * 2) 新 *= 2;
    if (g_gc键) { hm_free(g_gc键); g_gc键 = NULL; }
    if (g_gc值) { hm_free(g_gc值); g_gc值 = NULL; }
    gc_建表(新);
    for (Gc块 *b = g_gc链; b; b = b->下) gc_插((void *)(b + 1), b);
  }
  /* 活数据不肯降到阈值以下时，把阈值抬到「活数据的一点二倍 + 一兆」。
   * 两倍太松：自编译的活数据一百五十兆，两倍就是每增三百兆才收一次，
   * 峰值会被那三百兆顶起来。一点二倍是「略高于活数据」，
   * 于是收集变成「多出来的就收」，峰值贴着活数据走。 */
  if (g_gc字节 * 10 > g_gc阈值 * 8) g_gc阈值 = g_gc字节 + g_gc字节 / 5 + (1u << 20);
  if (g_gc日志) fprintf(stderr, "gc: 结束 后 %llu 字节 %llu 块（放掉 %llu，新阈值 %llu）\n",
                        (unsigned long long)g_gc字节, (unsigned long long)g_gc数,
                        (unsigned long long)(前 - g_gc字节), (unsigned long long)g_gc阈值);
  return 前 - g_gc字节;
}
#endif

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
    uint16_t *p = 串存((size_t)(n ? n : 1));
    for (uint32_t i = 0; i < n; i++) p[i] = (uint16_t)(unsigned char)文[i];
    *out = v_str(p, n);
    return *out;
  }
  if (v.tag == T_BOOL) {
    const char *t = v.boolean ? "true" : "false";
    uint16_t *p = 串存(strlen(t));
    for (size_t i = 0; i < strlen(t); i++) p[i] = (uint16_t)(unsigned char)t[i];
    *out = v_str(p, (uint32_t)strlen(t));
    return *out;
  }
  if (v.tag == T_NULL) {
    uint16_t *p = 串存(3);
    p[0] = 'n'; p[1] = 'i'; p[2] = 'l';
    *out = v_str(p, 3);
    return *out;
  }
  if (v.tag == T_TUPLE || v.tag == T_ARRAY) {
    /* "[" + each + ", " + "]" */
    /* 这一支要 realloc，而回收块不能被 realloc（块头会丢）——
     * 它只用在诊断文本上，量很小，走普通堆。 */
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
    uint16_t *p = 串存(strlen(t));
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
  for (uint32_t i = 0; i < g_机->函数数; i++) {
    if (g_机->函数们[i].name_len != pool_len[name_idx]) continue;
    uint32_t same = 1;
    for (uint32_t k = 0; k < g_机->函数们[i].name_len; k++) {
      if (g_机->函数们[i].name[k] != pool_p[name_idx][k]) { same = 0; break; }
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
  // 32 位位运算：与 JS 那三份同一套语义（无符号 32 位，移位按 31 取模）。
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x4E0E}, 2)) {      /* 位与 */
    if (nargs != 2) { fail("HMYR-R0160", "位与 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num & (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x6216}, 2)) {      /* 位或 */
    if (nargs != 2) { fail("HMYR-R0160", "位或 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num | (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x5F02, 0x6216}, 3)) { /* 位异或 */
    if (nargs != 2) { fail("HMYR-R0160", "位异或 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num ^ (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x975E}, 2)) {      /* 位非 */
    if (nargs != 1) { fail("HMYR-R0160", "位非 wants one argument"); return 1; }
    *out = v_num((double)(uint32_t)(~(uint32_t)args[0].num));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x53F3, 0x79FB}, 3)) { /* 位右移 */
    if (nargs != 2) { fail("HMYR-R0160", "位右移 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num >> ((uint32_t)args[1].num & 31u)));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x52A0}, 2)) {      /* 位加 */
    if (nargs != 2) { fail("HMYR-R0160", "位加 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num + (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x5FAA, 0x73AF, 0x53F3, 0x79FB}, 5)) { /* 位循环右移 */
    if (nargs != 2) { fail("HMYR-R0160", "位循环右移 wants two arguments"); return 1; }
    uint32_t x = (uint32_t)args[0].num, n = (uint32_t)args[1].num & 31u;
    *out = v_num((double)(n == 0 ? x : ((x >> n) | (x << (32 - n)))));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x4F4D, 0x5FAA, 0x73AF, 0x5DE6, 0x79FB}, 5)) { /* 位循环左移 */
    if (nargs != 2) { fail("HMYR-R0160", "位循环左移 wants two arguments"); return 1; }
    uint32_t x = (uint32_t)args[0].num, n = (uint32_t)args[1].num & 31u;
    *out = v_num((double)(n == 0 ? x : ((x << n) | (x >> (32 - n)))));
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x6570, 0x7EC4}, 2)) {
    if (nargs != 1) { fail("HMYR-R0150", "数组 wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE) { fail("HMYR-R0150", "数组 wants a tuple"); return 1; }
    Value v = v_null(); v.tag = T_ARRAY; v.ilen = args[0].ilen;
    v.items = alloc_values(v.ilen);
    for (uint32_t i = 0; i < v.ilen; i++) v.items[i] = args[0].items[i];
    *out = v;
    return 1;
  }
  if (name_is16(name_idx, (const uint16_t[]){0x8BBE}, 1)) {
    if (nargs != 3) { fail("HMYR-R0151", "设 wants three arguments"); return 1; }
    if (args[0].tag != T_ARRAY) { fail("HMYR-R0151", "设 wants an array built by 数组"); return 1; }
    int64_t i = (int64_t)args[1].num;
    if (i < 0 || i >= (int64_t)args[0].ilen) { fail("HMYR-R0152", "index outside the array"); return 1; }
    args[0].items[i] = args[2];
    *out = args[0];
    return 1;
  }
  if (name_is(name_idx, "len")) {
    if (nargs != 1) { fail("HMYR-R0101", "len wants one argument"); return 1; }
    if (args[0].tag == T_STR) { *out = v_num((double)args[0].slen); return 1; }
    if (args[0].tag == T_TUPLE || args[0].tag == T_ARRAY) { *out = v_num((double)args[0].ilen); return 1; }
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
    uint16_t *p = 串存((size_t)长);
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
    /* 拷贝而不是交回子串指针：回收靠「块起点」认自己的块，
     * 指到块中间的子串查不到，父串一被收掉它就悬空了。 */
    {
      uint32_t 长 = (uint32_t)(to - from);
      uint16_t *p = 串存(长 ? 长 : 1);
      if (长) memcpy(p, args[0].s + from, (size_t)长 * sizeof(uint16_t));
      *out = v_str(p, 长);
    }
    return 1;
  }
  /* 按分隔串切开。语义照 JavaScript 的 String.prototype.split：
   * 空分隔按码元切（空串给空元组），其余按不重叠的子串切，
   * 连续或末尾的分隔都会留下空段 —— 那三种情形各写在测试里。 */
  if (name_is(name_idx, "split")) {
    if (nargs != 2) { fail("HMYR-R0101", "split wants two arguments"); return 1; }
    Value s, d;
    value_to_text(args[0], &s);
    value_to_text(args[1], &d);
    if (d.slen == 0) {
      Value v = v_null(); v.tag = T_TUPLE; v.ilen = s.slen;
      v.items = alloc_values(s.slen);
      for (uint32_t i = 0; i < s.slen; i++) {
        uint16_t *p = 串存(1);
        p[0] = s.s[i];
        v.items[i] = v_str(p, 1);
      }
      *out = v;
      return 1;
    }
    uint32_t 段 = 1;
    for (uint32_t i = 0; i + d.slen <= s.slen; ) {
      if (memcmp(s.s + i, d.s, (size_t)d.slen * sizeof(uint16_t)) == 0) { 段++; i += d.slen; }
      else i++;
    }
    Value v = v_null(); v.tag = T_TUPLE; v.ilen = 段;
    v.items = alloc_values(段);
    uint32_t 起 = 0, k = 0;
    for (uint32_t i = 0; i + d.slen <= s.slen; ) {
      if (memcmp(s.s + i, d.s, (size_t)d.slen * sizeof(uint16_t)) == 0) {
        uint32_t 长 = i - 起;
        uint16_t *p = 串存((size_t)(长 ? 长 : 1));
        if (长) memcpy(p, s.s + 起, (size_t)长 * sizeof(uint16_t));
        v.items[k++] = v_str(p, 长);
        起 = i + d.slen;
        i = 起;
      } else i++;
    }
    {
      uint32_t 长 = s.slen - 起;
      uint16_t *p = 串存((size_t)(长 ? 长 : 1));
      if (长) memcpy(p, s.s + 起, (size_t)长 * sizeof(uint16_t));
      v.items[k++] = v_str(p, 长);
    }
    *out = v;
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
  /* ---- 索引 ---- */
  /* 一个按键查的东西，约定在 design/INDEX.txt。这一台以前在这里答一句具体的拒绝
   * （「键是运行时的字符串，那要一张真正的哈希表」）—— 现在做出来了，
   * 用的是排序数组加二分，理由写在 索引造 那一节的头注释里。 */
  if (name_is(name_idx, "index_new")) {
    if (nargs != 0) { fail("HMYR-R0101", "index_new wants no arguments"); return 1; }
    *out = v_null();
    out->tag = T_INDEX;
    out->idx = 索引造();
    return 1;
  }
  if (name_is(name_idx, "index_set")) {
    if (nargs != 3) { fail("HMYR-R0101", "index_set wants (index, key, value)"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-R0219", "index_set wants an index"); return 1; }
    if (args[1].tag != T_STR) { fail("HMYR-R0130", "index_set wants a string key, found "); return 1; }
    索引放(args[0].idx, args[1].s, args[1].slen, args[2]);
    /* 交回同一个索引：INDEX.txt 第一条约定，于是可以链着写。 */
    *out = args[0];
    return 1;
  }
  if (name_is(name_idx, "index_get")) {
    int 处;
    if (nargs != 2) { fail("HMYR-R0101", "index_get wants (index, key)"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-R0219", "index_get wants an index"); return 1; }
    if (args[1].tag != T_STR) { fail("HMYR-R0130", "index_get wants a string key"); return 1; }
    处 = 索引找(args[0].idx, args[1].s, args[1].slen);
    if (处 < 0) { fail("HMYR-R0218", "no such key in that index"); return 1; }
    *out = args[0].idx->项[处].值;
    return 1;
  }
  /* index_has 是纯函数：给错东西也交回 false，不抛 —— 问「有没有」不是失败。 */
  if (name_is(name_idx, "index_has")) {
    if (nargs != 2) { fail("HMYR-R0101", "index_has wants (index, key)"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx || args[1].tag != T_STR) { *out = v_bool(0); return 1; }
    *out = v_bool(索引找(args[0].idx, args[1].s, args[1].slen) >= 0);
    return 1;
  }
  if (name_is(name_idx, "index_len")) {
    if (nargs != 1) { fail("HMYR-R0101", "index_len wants one argument"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-R0219", "index_len wants an index"); return 1; }
    *out = v_num((double)args[0].idx->n);
    return 1;
  }
  if (name_is(name_idx, "index_keys")) {
    索引 *t;
    Value v;
    uint32_t *序;
    if (nargs != 1) { fail("HMYR-R0101", "index_keys wants one argument"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-R0219", "index_keys wants an index"); return 1; }
    t = args[0].idx;
    v = v_null();
    v.tag = T_TUPLE;
    v.ilen = t->n;
    v.items = alloc_values(t->n ? t->n : 1);
    /* 键序是「第一次放进去的顺序」。表若被二分过，物理顺序已经不是那个了 ——
     * 所以按序号另排一份下标。插入排序够用：这一支的键数是几千这个量级。 */
    序 = (uint32_t *)hm_calloc(t->n ? t->n : 1, sizeof(uint32_t));
    if (!序) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
    for (uint32_t i = 0; i < t->n; i++) 序[i] = i;
    for (uint32_t i = 1; i < t->n; i++) {
      uint32_t k = 序[i], j = i;
      while (j > 0 && t->项[序[j - 1]].序号 > t->项[k].序号) { 序[j] = 序[j - 1]; j--; }
      序[j] = k;
    }
    for (uint32_t i = 0; i < t->n; i++) {
      索引项 *e = &t->项[序[i]];
      v.items[i] = v_str(e->键, e->键长);
    }
    hm_free(序);
    *out = v;
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
  /* 列目录：顺序已经由 列目录 排好，这里只把名字搬成语言的值。
   * 打不开是 R0211（与 read_text 同一类：文件系统没给），空目录不是错。 */
  if (name_is(name_idx, "read_dir")) {
    if (nargs != 1) { fail("HMYR-R0101", "read_dir wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "read_dir wants a path string"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    uint32_t n = 0;
    char **名们 = 列目录(p, &n);
    free(p);
    if (!名们) { fail("HMYR-R0211", "cannot list that directory"); return 1; }
    Value v = v_null();
    v.tag = T_TUPLE;
    v.ilen = n;
    v.items = alloc_values(n);
    for (uint32_t i = 0; i < n; i++) {
      uint32_t 长 = 0;
      /* utf8_to_utf16 的内存来自 arena（串存），由 GC 管 —— 不能 free。
       * 第一版在这里写了 free(u)，那是把 arena 指针交给堆去释放。 */
      uint16_t *u = utf8_to_utf16(名们[i], strlen(名们[i]), &长);
      v.items[i] = v_str(u, 长);
      /* 名字与数组由 列目录 分配，而它定义在 #define malloc→hm_malloc 之前 ——
       * 于是那几个指针属于系统堆。这里必须用 原free，不能让它走 hm_free：
       * 两套堆的指针混着释放，症状是 0xC0000374（堆损坏），而错误信息里
       * 一个字都不会说这件事。 */
      原free(名们[i]);
    }
    原free(名们);
    *out = v;
    return 1;
  }
  /* 这是不是一个目录。问不到就是 false —— 与 file_exists 同一个态度：
   * 「问不到」与「不是」在调用者眼里通常是同一件事。
   * 裸机上没有这种东西，一并与 unistd.h 同一个条件。 */
  if (name_is(name_idx, "is_dir")) {
    if (nargs != 1) { fail("HMYR-R0101", "is_dir wants one argument"); return 1; }
    if (args[0].tag != T_STR) { *out = v_bool(0); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    int 是 = 0;
#if defined(_WIN32)
    int 宽长 = MultiByteToWideChar(CP_UTF8, 0, p, -1, NULL, 0);
    if (宽长 > 0) {
      wchar_t *宽 = (wchar_t *)malloc((size_t)宽长 * sizeof(wchar_t));
      if (宽) {
        MultiByteToWideChar(CP_UTF8, 0, p, -1, 宽, 宽长);
        DWORD 属性 = GetFileAttributesW(宽);
        是 = (属性 != INVALID_FILE_ATTRIBUTES && (属性 & FILE_ATTRIBUTE_DIRECTORY)) ? 1 : 0;
        free(宽);
      }
    }
#elif !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
    struct stat 状;
    if (stat(p, &状) == 0) 是 = S_ISDIR(状.st_mode) ? 1 : 0;
#else
    (void)p;
#endif
    free(p);
    *out = v_bool(是);
    return 1;
  }
  /* CRC32：纯算术，不需要效果。参数收字节元组，元素可以是一字节，也可以是一块。
   * 表第一次用时生成（256 项，多项式 0xEDB88320），与 src/eval.mjs、src/vm-builtins.mjs
   * 是同一张 —— 三处对同一串字节必须给出同一个值，否则 ZIP 不互通。 */
  if (name_is16(name_idx, (const uint16_t[]){0x6821, 0x9A8C, 0x548C}, 3)) {  /* 校验和 */
    if (nargs != 1) { fail("HMYR-R0101", "校验和 wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE && args[0].tag != T_ARRAY) { fail("HMYR-R0130", "校验和 wants a tuple of bytes"); return 1; }
    static uint32_t 校验表[256];
    static int 表已建 = 0;
    if (!表已建) {
      for (uint32_t n = 0; n < 256; n++) {
        uint32_t x = n;
        for (int k = 0; k < 8; k++) x = (x & 1u) ? (0xEDB88320u ^ (x >> 1)) : (x >> 1);
        校验表[n] = x;
      }
      表已建 = 1;
    }
    uint32_t c = 0xFFFFFFFFu;
    for (uint32_t i = 0; i < args[0].ilen; i++) {
      Value x = args[0].items[i];
      if (x.tag == T_TUPLE || x.tag == T_ARRAY) {
        for (uint32_t k = 0; k < x.ilen; k++) {
          if (x.items[k].tag != T_NUM) { fail("HMYR-R0130", "校验和 wants bytes"); return 1; }
          uint32_t b = (uint32_t)((long long)x.items[k].num) & 0xffu;
          c = (c >> 8) ^ 校验表[(c ^ b) & 0xffu];
        }
      } else {
        if (x.tag != T_NUM) { fail("HMYR-R0130", "校验和 wants bytes"); return 1; }
        uint32_t b = (uint32_t)((long long)x.num) & 0xffu;
        c = (c >> 8) ^ 校验表[(c ^ b) & 0xffu];
      }
    }
    *out = v_num((double)(c ^ 0xFFFFFFFFu));
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
  /* 原始字节：嵌入与打包要它。与 read_text 同一条读法，只是不解码 ——
   * 二进制一过 UTF-8 就坏，而「坏」在这里不报错，只会变成一串替换字符。 */
  if (name_is(name_idx, "read_bytes")) {
    if (nargs != 1) { fail("HMYR-R0101", "read_bytes wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "read_bytes wants a path string"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "rb");
    if (!f) { free(p); fail("HMYR-R0211", "cannot read that file"); return 1; }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    unsigned char *buf = (unsigned char *)malloc((size_t)(n > 0 ? n : 1));
    size_t got = (n > 0) ? fread(buf, 1, (size_t)n, f) : 0;
    fclose(f);
    free(p);
    {
      Value v = v_null(); v.tag = T_TUPLE; v.ilen = (uint32_t)got;
      v.items = alloc_values((uint32_t)(got ? got : 1));
      for (size_t i = 0; i < got; i++) v.items[i] = v_num((double)buf[i]);
      *out = v;
    }
    free(buf);
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
  /* 从标准输入读一行。交回一个记录：{行, 结束}。
   * 「结束」是 EOF —— 与「读到一个空行」是两件事，LSP 那种「读到没有为止」
   * 的循环要能分清它们。板子上没有标准输入，于是那里一律交回结束。
   * 不添换行、也不去尾随空白（行尾的 \r 除外）：这是原始的一行。 */
  if (name_is(name_idx, "read_stdin_line")) {
    if (nargs != 0) { fail("HMYR-R0101", "read_stdin_line takes no arguments"); return 1; }
    uint16_t *行 = NULL;
    uint32_t 行长 = 0;
    int 结束 = 1;
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
    行 = 串存(1);
#else
    {
      size_t cap = 256, n = 0;
      char *buf = (char *)malloc(cap);
      if (!buf) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
      int c = 0;
      for (;;) {
        c = fgetc(stdin);
        if (c == EOF || c == '\n') break;
        if (n + 1 >= cap) {
          cap *= 2;
          buf = (char *)realloc(buf, cap);
          if (!buf) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
        }
        buf[n++] = (char)c;
      }
      结束 = (c == EOF) ? 1 : 0;
      if (n > 0 && buf[n - 1] == '\r') n--;
      行 = utf8_to_utf16(buf, n, &行长);
      free(buf);
    }
#endif
    {
      Value 记 = v_null();
      记.tag = T_RECORD;
      记.rec.n = 2;
      记.rec.vals = alloc_values(2);
      记.rec.names = (const uint16_t **)calloc(2, sizeof(uint16_t *));
      记.rec.name_lens = (uint32_t *)calloc(2, sizeof(uint32_t));
      static const uint16_t 名行[] = {0x884c};
      static const uint16_t 名终[] = {0x7ed3, 0x675f};
      记.rec.names[0] = 名行; 记.rec.name_lens[0] = 1; 记.rec.vals[0] = v_str(行, 行长);
      记.rec.names[1] = 名终; 记.rec.name_lens[1] = 2; 记.rec.vals[1] = v_bool(结束);
      *out = 记;
    }
    return 1;
  }
  /* 从标准输入读 N 个字节。交回 {字节们, 结束}。
   * 与 read_stdin_line 分开，是因为 JSON-RPC 那类东西的请求体未必只有一行：
   * 先读头拿到长度，再按长度读这么多字节 —— 两件事，两格。
   * 结束表示「没读满」：EOF 先到了。 */
  if (name_is(name_idx, "read_stdin_bytes")) {
    if (nargs != 1) { fail("HMYR-R0101", "read_stdin_bytes wants one argument"); return 1; }
    {
      int ok = 0;
      double nn = as_num(args[0], &ok);
      if (!ok) { fail("HMYR-R0130", "read_stdin_bytes wants a number"); return 1; }
      long want = (long)floor(nn);
      if (want < 0) want = 0;
      size_t 得 = 0;
      int 结束 = 1;
      unsigned char *buf = (unsigned char *)malloc((size_t)(want ? want : 1));
      if (!buf) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
      /* 板子上没有标准输入：一个字节也读不到。 */
      结束 = 1;
#else
      while (得 < (size_t)want) {
        size_t n = fread(buf + 得, 1, (size_t)want - 得, stdin);
        if (n == 0) break;
        得 += n;
      }
      结束 = (得 < (size_t)want) ? 1 : 0;
#endif
      {
        Value 字节们 = v_null();
        字节们.tag = T_TUPLE;
        字节们.ilen = (uint32_t)得;
        字节们.items = alloc_values((uint32_t)(得 ? 得 : 1));
        for (size_t i = 0; i < 得; i++) 字节们.items[i] = v_num((double)buf[i]);
        free(buf);
        {
          Value 记 = v_null();
          记.tag = T_RECORD;
          记.rec.n = 2;
          记.rec.vals = alloc_values(2);
          记.rec.names = (const uint16_t **)calloc(2, sizeof(uint16_t *));
          记.rec.name_lens = (uint32_t *)calloc(2, sizeof(uint32_t));
          static const uint16_t 名字节[] = {0x5b57, 0x8282, 0x4eec};
          static const uint16_t 名终[] = {0x7ed3, 0x675f};
          记.rec.names[0] = 名字节; 记.rec.name_lens[0] = 3; 记.rec.vals[0] = 字节们;
          记.rec.names[1] = 名终; 记.rec.name_lens[1] = 2; 记.rec.vals[1] = v_bool(结束);
          *out = 记;
        }
      }
    }
    return 1;
  }
  /* 字节元组转文本：按 UTF-8 解码。read_stdin_bytes 交回的是字节，
   * 而 JSON 之类的体是 UTF-8 —— 两格之间需要这一格。
   * 它不管编码猜测：给的就是 UTF-8，坏字节按替换字符走（与 read_text 同一条路）。 */
  if (name_is(name_idx, "bytes_to_text")) {
    if (nargs != 1) { fail("HMYR-R0101", "bytes_to_text wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE) { fail("HMYR-R0130", "bytes_to_text wants a tuple of bytes"); return 1; }
    {
      uint32_t 数 = args[0].ilen;
      unsigned char *buf = (unsigned char *)malloc((size_t)(数 ? 数 : 1));
      if (!buf) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
      for (uint32_t i = 0; i < 数; i++) {
        int ok = 0;
        double b = as_num(args[0].items[i], &ok);
        buf[i] = ok ? (unsigned char)((long long)b) : 0;
      }
      uint32_t 长 = 0;
      uint16_t *s = utf8_to_utf16((const char *)buf, 数, &长);
      free(buf);
      *out = v_str(s, 长);
    }
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
  /* ---- 终端：只交回字符串，一个字都不写出去 ----------------------------
   * 副作用留给 print —— 这几条算出来的是「该写什么」，不是「写了什么」，
   * 所以测试能断言它们，而板子没有终端也不会假装有。
   * term_size 在桌面上问一次控制台；问不到就给 24 行 80 列，
   * 与 JS 那一侧的默认一致（capabilities.terminal.size 的缺省值）。 */
  if (name_is(name_idx, "term_size")) {
    if (nargs != 0) { fail("HMYR-R0101", "term_size takes no arguments"); return 1; }
    long 行 = 24, 列 = 80;
#ifdef _WIN32
    {
      HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
      CONSOLE_SCREEN_BUFFER_INFO info;
      if (h && h != INVALID_HANDLE_VALUE && GetConsoleScreenBufferInfo(h, &info)) {
        行 = info.srWindow.Bottom - info.srWindow.Top + 1;
        列 = info.srWindow.Right - info.srWindow.Left + 1;
        if (行 < 1) 行 = 24;
        if (列 < 1) 列 = 80;
      }
    }
#endif
    Value v = v_null(); v.tag = T_TUPLE; v.ilen = 2;
    v.items = alloc_values(2);
    v.items[0] = v_num((double)行);
    v.items[1] = v_num((double)列);
    *out = v;
    return 1;
  }
  if (name_is(name_idx, "term_clear")) {
    if (nargs != 0) { fail("HMYR-R0101", "term_clear takes no arguments"); return 1; }
    *out = ascii_text("\x1b[2J");
    return 1;
  }
  if (name_is(name_idx, "term_hide")) {
    if (nargs != 0) { fail("HMYR-R0101", "term_hide takes no arguments"); return 1; }
    *out = ascii_text("\x1b[?25l");
    return 1;
  }
  if (name_is(name_idx, "term_show")) {
    if (nargs != 0) { fail("HMYR-R0101", "term_show takes no arguments"); return 1; }
    *out = ascii_text("\x1b[?25h");
    return 1;
  }
  if (name_is(name_idx, "term_escape")) {
    if (nargs != 2) { fail("HMYR-R0101", "term_escape wants two arguments"); return 1; }
    int o1 = 0, o2 = 0;
    double r = as_num(args[0], &o1), c = as_num(args[1], &o2);
    if (!o1 || !o2) { fail("HMYR-R0130", "term_escape wants two numbers"); return 1; }
    long rr = (long)floor(r), cc = (long)floor(c);
    if (rr < 1) rr = 1;
    if (cc < 1) cc = 1;
    char buf[64];
    snprintf(buf, sizeof buf, "\x1b[%ld;%ldH", rr, cc);
    *out = ascii_text(buf);
    return 1;
  }
  if (name_is(name_idx, "term_color")) {
    if (nargs < 1 || nargs > 2) { fail("HMYR-R0101", "term_color wants one or two arguments"); return 1; }
    int o1 = 0;
    double fg = as_num(args[0], &o1);
    if (!o1) { fail("HMYR-R0130", "term_color wants a number"); return 1; }
    long f = (long)floor(fg);
    if (f < 0) { *out = ascii_text("\x1b[0m"); return 1; }
    long b = -1;
    if (nargs == 2) {
      int o2 = 0;
      double bg = as_num(args[1], &o2);
      if (!o2) { fail("HMYR-R0130", "term_color's second argument must be a number"); return 1; }
      b = (long)floor(bg);
    }
    char buf[96];
    if (b < 0) snprintf(buf, sizeof buf, "\x1b[38;5;%ldm", f);
    else snprintf(buf, sizeof buf, "\x1b[38;5;%ld;48;5;%ldm", f, b);
    *out = ascii_text(buf);
    return 1;
  }
  /* ---- 时间：读一次钟，或等一会儿 ----------------------------------
   * 它们破坏可复现性，这一条写在设计里（CAPABILITIES.txt 第六组）。
   * 测试只断言形状 —— 钟走过的方向、sleep_ms 交回它答应等的那个数 ——
   * 不断言具体值，因为那件事本来就不该被断言。 */
  if (name_is(name_idx, "now_ms")) {
    if (nargs != 0) { fail("HMYR-R0101", "now_ms takes no arguments"); return 1; }
    *out = v_num(现在毫秒());
    return 1;
  }
  if (name_is(name_idx, "sleep_ms")) {
    if (nargs != 1) { fail("HMYR-R0101", "sleep_ms wants one argument"); return 1; }
    int o1 = 0;
    double ms = as_num(args[0], &o1);
    if (!o1) { fail("HMYR-R0130", "sleep_ms wants a number"); return 1; }
    long m = (long)floor(ms);
    if (m < 0) m = 0;
    睡多久(m);
    *out = v_num((double)m);
    return 1;
  }
  /* ---- 环境与路径：读这台机器在哪儿 ---------------------------------- */
  if (name_is(name_idx, "cwd")) {
    if (nargs != 0) { fail("HMYR-R0101", "cwd takes no arguments"); return 1; }
    char *p = 现在工作在();
    *out = 路径值(p);
    free(p);
    return 1;
  }
  if (name_is(name_idx, "home_dir")) {
    if (nargs != 0) { fail("HMYR-R0101", "home_dir takes no arguments"); return 1; }
    const char *h = 环境("USERPROFILE");
    if (!*h) h = 环境("HOME");
    *out = 路径值(h);
    return 1;
  }
  if (name_is(name_idx, "temp_path")) {
    if (nargs != 1) { fail("HMYR-R0101", "temp_path wants one argument"); return 1; }
    Value 名;
    value_to_text(args[0], &名);
    const char *dir = 环境("HMYR_TMP");
    if (!*dir) dir = 环境("TEMP");
    if (!*dir) dir = 环境("TMP");
#if !defined(_WIN32)
    if (!*dir) dir = "/tmp";
#endif
    char *名文 = utf16_to_utf8(名.s, 名.slen);
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
    /* 板子上没有临时目录：只给这个名字，表示「该有一个地方，而这里没有」。 */
    char *全 = 拼接("hmyr-", 名文 ? 名文 : "");
#else
    char *前半 = 拼接(dir, "/hmyr-");
    char *全 = 拼接(前半, 名文 ? 名文 : "");
    free(前半);
#endif
    free(名文);
#ifdef _WIN32
    _mkdir(全);   /* 已经在就算了：与 JS 那侧的 ensureDir 同一条规矩。 */
#elif !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
    mkdir(全, 0777);
#endif
    *out = 路径值(全);
    free(全);
    return 1;
  }
  if (name_is(name_idx, "repo_path")) {
    if (nargs != 1) { fail("HMYR-R0101", "repo_path wants one argument"); return 1; }
    Value 相对;
    value_to_text(args[0], &相对);
    char *rel = utf16_to_utf8(相对.s, 相对.slen);
    const char *根 = 环境("HMYR_REPO");
    char *全;
    if (*根) {
      char *前半 = 拼接(根, "/");
      全 = 拼接(前半, rel ? rel : "");
      free(前半);
    } else {
      /* 这台机器没有仓库根。原样交回相对路径，而不是编一个看起来像仓库的串。 */
      全 = 拼接("", rel ? rel : "");
    }
    *out = 路径值(全);
    free(全);
    free(rel);
    return 1;
  }
  if (name_is(name_idx, "python_path")) {
    if (nargs != 0) { fail("HMYR-R0101", "python_path takes no arguments"); return 1; }
    const char *p = 环境("HMYR_PYTHON");
    *out = ascii_text(*p ? p : "python");
    return 1;
  }
  if (name_is(name_idx, "locale_current")) {
    if (nargs != 0) { fail("HMYR-R0101", "locale_current takes no arguments"); return 1; }
    *out = ascii_text(g_locale);
    return 1;
  }
  if (name_is(name_idx, "locale_set")) {
    if (nargs != 1) { fail("HMYR-R0101", "locale_set wants one argument"); return 1; }
    Value 名;
    value_to_text(args[0], &名);
    char *文 = utf16_to_utf8(名.s, 名.slen);
    int 认 = 0;
    for (size_t i = 0; i < sizeof locale_名字们 / sizeof *locale_名字们; i++) {
      if (文 && strcmp(文, locale_名字们[i]) == 0) { 认 = 1; break; }
    }
    if (!认) {
      char m[220];
      snprintf(m, sizeof m,
               "no such locale profile: '%s' (have: zh-CN.gbk, zh-CN.utf8, ja-JP.shift_jis, en-US.utf8)",
               文 ? 文 : "");
      free(文);
      fail("HMYR-R0205", m);
      return 1;
    }
    snprintf(g_locale, sizeof g_locale, "%s", 文);
    *out = ascii_text(g_locale);
    free(文);
    return 1;
  }
  if (name_is(name_idx, "locale_env")) {
    if (nargs != 0) { fail("HMYR-R0101", "locale_env takes no arguments"); return 1; }
    const char *l = 环境("LANG");
    if (!*l) l = 环境("LC_ALL");
    /* 只认那四套档案对应的三个语区；别的语区给空串（「不知道」）。 */
    const char *名 = "";
    if (strncmp(l, "zh_CN", 5) == 0 || strncmp(l, "zh-CN", 5) == 0) {
#ifdef _WIN32
      名 = (GetConsoleOutputCP() == 936) ? "zh-CN.gbk" : "zh-CN.utf8";
#else
      名 = "zh-CN.utf8";
#endif
    } else if (strncmp(l, "ja_JP", 5) == 0 || strncmp(l, "ja-JP", 5) == 0) {
      名 = "ja-JP.shift_jis";
    } else if (strncmp(l, "en_US", 5) == 0 || strncmp(l, "en-US", 5) == 0) {
      名 = "en-US.utf8";
    }
    *out = ascii_text(名);
    return 1;
  }
  if (name_is(name_idx, "console_codepage")) {
    if (nargs != 0) { fail("HMYR-R0101", "console_codepage takes no arguments"); return 1; }
#ifdef _WIN32
    {
      char num[16];
      snprintf(num, sizeof num, "%u", (unsigned)GetConsoleOutputCP());
      *out = ascii_text(num);
    }
#else
    *out = ascii_text("utf8");
#endif
    return 1;
  }
  /* ---- 输入：一条键队列 ----------------------------------------------
   * 套件往队列里塞键，真终端从 stdin 读键，两边共用同一条队列 ——
   * 于是「按一个键就停」这种程序可以在没有终端的地方被断言。
   * 队列有界（64 项）：满了就不收，交回当前长度。JS 那一侧是无界的，
   * 这一条差异写在契约里，而不是让板子在某个规模上悄悄变慢。 */
  if (name_is(name_idx, "key_push")) {
    if (nargs != 1) { fail("HMYR-R0101", "key_push wants one argument"); return 1; }
    Value s;
    value_to_text(args[0], &s);
    if (g_机->键数 < KEY_环) {
      uint16_t *p = 串存((size_t)(s.slen ? s.slen : 1));
      if (s.slen) memcpy(p, s.s, (size_t)s.slen * sizeof(uint16_t));
      键入队(v_str(p, s.slen));
    }
    *out = v_num((double)g_机->键数);
    return 1;
  }
  if (name_is(name_idx, "key_available")) {
    if (nargs != 0) { fail("HMYR-R0101", "key_available takes no arguments"); return 1; }
    *out = v_bool(g_机->键数 > 0);
    return 1;
  }
  if (name_is(name_idx, "key_read")) {
    if (nargs != 0) { fail("HMYR-R0101", "key_read takes no arguments"); return 1; }
    if (g_机->键数 > 0) { *out = 键出队(); return 1; }
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
    /* 板子上没有标准输入：没有键就是空串。 */
    *out = ascii_text("");
#else
    if (!_isatty(_fileno(stdin))) {
      /* 队列空而 stdin 不是终端：立即交回空串 —— 不阻塞，也没有键。 */
      *out = ascii_text("");
      return 1;
    }
    {
      char buf[64];
      size_t got = fread(buf, 1, sizeof buf, stdin);
      if (got == 0) { *out = ascii_text(""); return 1; }
      uint32_t 长 = 0;
      uint16_t *s = utf8_to_utf16(buf, got, &长);
      Value 们[64];
      int n = 拆码点(v_str(s, 长), 们, 64);
      for (int i = 1; i < n; i++) 键入队(们[i]);
      *out = n > 0 ? 们[0] : ascii_text("");
    }
#endif
    return 1;
  }
  if (name_is(name_idx, "key_start")) {
    if (nargs != 1) { fail("HMYR-R0101", "key_start wants one argument"); return 1; }
#ifdef _WIN32
    int 开 = truthy(args[0]);
    {
      HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
      DWORD 模 = 0;
      if (!h || h == INVALID_HANDLE_VALUE || !GetConsoleMode(h, &模)) {
        *out = v_bool(0);   /* 没有真终端：如实返回假，不装作支持。 */
        return 1;
      }
      if (开) {
        if (!g_有原模式) { g_原控制台模式 = 模; g_有原模式 = 1; }
        DWORD 新 = 模 & ~(DWORD)(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT);
        新 |= ENABLE_WINDOW_INPUT;
        *out = v_bool(SetConsoleMode(h, 新) ? 1 : 0);
      } else {
        *out = v_bool(g_有原模式 && SetConsoleMode(h, g_原控制台模式) ? 1 : 0);
        g_有原模式 = 0;
      }
    }
#else
    *out = v_bool(0);
#endif
    return 1;
  }
  /* ---- 进程：改工作目录 ----------------------------------------------
   * 成功就交回新的目录（与 JS 那侧同一条约定）；进不去报 R0209。
   * 板子上没有目录概念，于是这一条在那里一律报进不去 ——
   * 它不装作成功，因为「换了个地方」在板子上不成立。 */
  if (name_is(name_idx, "chdir")) {
    if (nargs != 1) { fail("HMYR-R0101", "chdir wants one argument"); return 1; }
    Value 路;
    value_to_text(args[0], &路);
    char *p = utf16_to_utf8(路.s, 路.slen);
    const char *目标 = p ? p : "";
    int 成 = 0;
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
    成 = 0;
#elif defined(_WIN32)
    {
      int 宽长 = MultiByteToWideChar(CP_UTF8, 0, 目标, -1, NULL, 0);
      if (宽长 > 0) {
        wchar_t *宽 = (wchar_t *)malloc((size_t)宽长 * sizeof(wchar_t));
        if (宽) {
          MultiByteToWideChar(CP_UTF8, 0, 目标, -1, 宽, 宽长);
          成 = (_wchdir(宽) == 0);
          free(宽);
        }
      }
    }
#else
    成 = (chdir(目标) == 0);
#endif
    if (!成) {
      char m[512];
      snprintf(m, sizeof m, "cannot enter '%s'", 目标);
      free(p);
      fail("HMYR-R0209", m);
      return 1;
    }
    free(p);
    {
      char *新 = 现在工作在();
      *out = 路径值(新);
      free(新);
    }
    return 1;
  }
  /* ---- 进程：跑一个程序 ---------------------------------------------- */
  if (name_is(name_idx, "run_program")) {
    if (nargs < 1 || nargs > 4) {
      fail("HMYR-R0101", "run_program wants one to four arguments");
      return 1;
    }
    Value 命令值;
    value_to_text(args[0], &命令值);
    char *命令 = utf16_to_utf8(命令值.s, 命令值.slen);
    if (!命令 || !*命令) {
      free(命令);
      fail("HMYR-R0213", "run_program needs a program name: an empty string names nothing");
      return 1;
    }
    char **参们 = NULL;
    int 参量 = 0;
    if (nargs >= 2 && args[1].tag == T_TUPLE) {
      参量 = (int)args[1].ilen;
      参们 = (char **)calloc((size_t)(参量 ? 参量 : 1), sizeof(char *));
      if (!参们) { fprintf(stderr, "hmyr: out of memory\n"); exit(70); }
      for (uint32_t i = 0; i < args[1].ilen; i++) {
        Value t;
        value_to_text(args[1].items[i], &t);
        参们[i] = utf16_to_utf8(t.s, t.slen);
      }
    }
    double 超时毫秒 = 10000;
    if (nargs >= 3 && args[2].tag != T_NULL) {
      int ok = 0;
      double x = as_num(args[2], &ok);
      if (!ok) {
        free(命令);
        for (int i = 0; i < 参量; i++) free(参们[i]);
        free(参们);
        fail("HMYR-R0130", "run_program's timeout must be a number");
        return 1;
      }
      超时毫秒 = x < 0 ? 0 : x;
    }
    const char *编码 = "utf8";
    char *编码们 = NULL;
    if (nargs >= 4) {
      Value e;
      value_to_text(args[3], &e);
      编码们 = utf16_to_utf8(e.s, e.slen);
      if (编码们) 编码 = 编码们;
    }
    字节串 出 = {0}, 错 = {0};
    long 码 = -1;
    int 超时了 = 0;
    const char *错误码 = NULL;
#if defined(_WIN32)
    {
      SECURITY_ATTRIBUTES sa;
      HANDLE oR = NULL, oW = NULL, eR = NULL, eW = NULL;
      sa.nLength = sizeof sa;
      sa.lpSecurityDescriptor = NULL;
      sa.bInheritHandle = TRUE;
      if (CreatePipe(&oR, &oW, &sa, 0) && CreatePipe(&eR, &eW, &sa, 0)) {
        SetHandleInformation(oR, HANDLE_FLAG_INHERIT, 0);
        SetHandleInformation(eR, HANDLE_FLAG_INHERIT, 0);
        wchar_t 行[8192];
        size_t at = 0;
        int 拼成 = 1;
        for (int k = -1; k < 参量 && 拼成; k++) {
          const char *源 = (k < 0) ? 命令 : 参们[k];
          int 宽长 = MultiByteToWideChar(CP_UTF8, 0, 源, -1, NULL, 0);
          if (宽长 <= 0) { 拼成 = 0; break; }
          wchar_t *宽 = (wchar_t *)malloc((size_t)宽长 * sizeof(wchar_t));
          if (!宽) { 拼成 = 0; break; }
          MultiByteToWideChar(CP_UTF8, 0, 源, -1, 宽, 宽长);
          宽拼参(行, 8192, &at, 宽);
          free(宽);
        }
        行[at] = 0;
        if (!拼成) {
          错误码 = "EINVAL";
        } else {
          STARTUPINFOW si;
          PROCESS_INFORMATION pi;
          ZeroMemory(&si, sizeof si);
          ZeroMemory(&pi, sizeof pi);
          si.cb = sizeof si;
          si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
          si.wShowWindow = SW_HIDE;
          si.hStdOutput = oW;
          si.hStdError = eW;
          si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
          /* 宽拼参 每次都先写一个空格，所以命令行从第二个字符开始。 */
          const wchar_t *命令行 = (行[0] == L' ') ? 行 + 1 : 行;
          if (CreateProcessW(NULL, (wchar_t *)命令行, NULL, NULL, TRUE, CREATE_NO_WINDOW,
                             NULL, NULL, &si, &pi)) {
            DWORD 起 = GetTickCount();
            for (;;) {
              DWORD 等 = WaitForSingleObject(pi.hProcess, 10);
              读管道(oR, &出);
              读管道(eR, &错);
              if (等 == WAIT_OBJECT_0) break;
              if (超时毫秒 > 0 && (double)(GetTickCount() - 起) >= 超时毫秒) {
                TerminateProcess(pi.hProcess, 1);
                超时了 = 1;
                break;
              }
            }
            读管道(oR, &出);
            读管道(eR, &错);
            if (超时了) {
              码 = -1;
            } else {
              DWORD c = 0;
              GetExitCodeProcess(pi.hProcess, &c);
              码 = (long)c;
            }
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
          } else {
            错误码 = "ENOENT";
          }
        }
      } else {
        错误码 = "EPIPE";
      }
      if (oW) CloseHandle(oW);
      if (eW) CloseHandle(eW);
      if (oR) CloseHandle(oR);
      if (eR) CloseHandle(eR);
    }
#else
    /* 别的平台还没有这一份实现。说清是哪一个平台没有，而不是装作跑成功了。 */
    (void)超时毫秒;
    错误码 = "ENOPROC";
#endif
    字节串去尾白(&出);
    字节串去尾白(&错);
    {
      Value 记 = v_null();
      记.tag = T_RECORD;
      记.rec.n = 5;
      记.rec.vals = alloc_values(5);
      记.rec.names = (const uint16_t **)calloc(5, sizeof(uint16_t *));
      记.rec.name_lens = (uint32_t *)calloc(5, sizeof(uint32_t));
      static const uint16_t 名码[] = {'c', 'o', 'd', 'e'};
      static const uint16_t 名出[] = {'s', 't', 'd', 'o', 'u', 't'};
      static const uint16_t 名错[] = {'s', 't', 'd', 'e', 'r', 'r'};
      static const uint16_t 名超[] = {'t', 'i', 'm', 'e', 'd', 'O', 'u', 't'};
      static const uint16_t 名误[] = {'e', 'r', 'r', 'o', 'r'};
      记.rec.names[0] = 名码; 记.rec.name_lens[0] = 4; 记.rec.vals[0] = v_num((double)码);
      记.rec.names[1] = 名出; 记.rec.name_lens[1] = 6; 记.rec.vals[1] = 解码输出(&出, 编码);
      记.rec.names[2] = 名错; 记.rec.name_lens[2] = 6; 记.rec.vals[2] = 解码输出(&错, 编码);
      记.rec.names[3] = 名超; 记.rec.name_lens[3] = 8; 记.rec.vals[3] = v_bool(超时了);
      记.rec.names[4] = 名误; 记.rec.name_lens[4] = 5; 记.rec.vals[4] = 错误码 ? ascii_text(错误码) : v_null();
      *out = 记;
    }
    free(出.p);
    free(错.p);
    free(命令);
    for (int i = 0; i < 参量; i++) free(参们[i]);
    free(参们);
    free(编码们);
    return 1;
  }
  /* ---- 线程：这一台没有 ----------------------------------------------
   * 跨核要一个独立的机器实例，而这台的执行状态还是文件级全局。
   * 如实说没有：spawn 交回 -1（无效句柄），join 与 cancel 报 R0221，
   * count 交回 0 —— 与 JS 那侧在「起不来」时的答案同一条路。 */
  if (name_is(name_idx, "thr_spawn")) {
    *out = v_num(-1);
    return 1;
  }
  if (name_is(name_idx, "thr_join") || name_is(name_idx, "thr_cancel")) {
    fail("HMYR-R0221", "no thread handle on this machine: this machine has no thread capability");
    return 1;
  }
  if (name_is(name_idx, "thr_count")) {
    *out = v_num(0);
    return 1;
  }
  /* arena：三区模型的桩，三个字段都是函数值，而这一台没有一等函数值。
   * 用 R0104（没有这个内置）而不是另开编号：它确实没有。 */
  if (name_is(name_idx, "arena")) {
    fail("HMYR-R0104",
         "arena is a stub for the zone model: its three fields are functions, and this machine has no first-class functions");
    return 1;
  }
  if (name_is(name_idx, "argv")) {
    if (nargs != 0) { fail("HMYR-R0101", "argv takes no arguments"); return 1; }
    *out = g_机->argv;
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
  记深度(f, g_机->当前函数);
  Value *slots = alloc_values(f->nslots);
  for (int i = 0; i < nargs && i < (int)f->nslots; i++) slots[i] = args[i];
  /* 帧链：GC 靠它看见递归中的槽；出口要还原，否则它指向一个已经没了的栈帧。 */
  帧记录 帧;
  帧.slots = slots;
  帧.槽数 = f->nslots;
  帧.上 = g_机->帧链;
  g_机->帧链 = &帧;
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
  if (g_gc开 && g_gc字节 > g_gc阈值) gc_收集();
#endif
#define FRAME_RET(x) do { g_机->帧链 = 帧.上; return (x); } while (0)
  uint32_t base = g_机->stack_n;
  /* 进帧时把基线交给 pop：从那以后弹栈不会越过它。
   * 退出时要还原 —— 否则回到调用者之后，它自己也弹不动自己压的东西了。 */
  uint32_t 外base = g_机->基址;
  g_机->基址 = base;
  Func *外函 = g_机->当前函数;
  g_机->当前函数 = f;
  int32_t pc = 0;
  for (;;) {
    if (g_failed) FRAME_RET(v_null());
    if (++g_机->步数 > g_机->步限) { fail("HMYR-R0102", "the program ran for too long"); FRAME_RET(v_null()); }
    if ((uint32_t)pc >= f->ncode) { fail("HMYR-R0110", "the instruction stream ran off its end"); FRAME_RET(v_null()); }
    Ins *in = &f->code[pc];
    if (g_trace_on) {
      Trace *t = &g_trace[g_trace_at];
      t->pc = pc;
      t->op = in->op;
      t->n = g_机->stack_n;
      g_trace_at = (g_trace_at + 1) % TRACE_N;
    }
    switch (in->op) {
      case OP_CONST: push(in->val); pc++; break;
      case OP_LOAD:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char m[160];
          snprintf(m, sizeof m, "load from slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-R0110", m);
          FRAME_RET(v_null());
        }
        push(slots[in->a]); pc++; break;
      case OP_STORE:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char m[160];
          snprintf(m, sizeof m, "store to slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-R0110", m);
          FRAME_RET(v_null());
        }
        slots[in->a] = pop(); pc++; break;
      case OP_ASSIGN:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char m[160];
          snprintf(m, sizeof m, "assign to slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-R0110", m);
          FRAME_RET(v_null());
        }
        slots[in->a] = pop(); pc++; break;
      case OP_POP: pop(); pc++; break;
      case OP_GLOBAL: { fail("HMYR-R0104", "globals are not in this machine yet"); FRAME_RET(v_null()); }
      case OP_BOOL: { Value v = pop(); push(v_bool(truthy(v))); pc++; break; }
      case OP_NEG: { Value v = pop(); int ok = 0; double d = as_num(v, &ok);
        if (!ok) { fail("HMYR-R0130", "expected a number"); FRAME_RET(v_null()); } push(v_num(-d)); pc++; break; }
      case OP_NOT: { Value v = pop(); push(v_bool(!truthy(v))); pc++; break; }
      case OP_ADD: {
        Value b = pop(), a = pop();
        if ((a.tag == T_TUPLE || a.tag == T_ARRAY) && (b.tag == T_TUPLE || b.tag == T_ARRAY)) {
          Value v = v_null(); v.tag = T_TUPLE; v.ilen = a.ilen + b.ilen;
          v.items = alloc_values(v.ilen);
          memcpy(v.items, a.items, a.ilen * sizeof(Value));
          memcpy(v.items + a.ilen, b.items, b.ilen * sizeof(Value));
          push(v);
        } else if (a.tag == T_STR || b.tag == T_STR) {
          Value sa, sb; value_to_text(a, &sa); value_to_text(b, &sb);
          uint16_t *p = 串存((size_t)(sa.slen + sb.slen));
          memcpy(p, sa.s, (size_t)sa.slen * sizeof(uint16_t));
          memcpy(p + sa.slen, sb.s, (size_t)sb.slen * sizeof(uint16_t));
          push(v_str(p, sa.slen + sb.slen));
        } else {
          int ok1 = 0, ok2 = 0;
          double x = as_num(a, &ok1), y = as_num(b, &ok2);
          if (!ok1 || !ok2) { fail("HMYR-R0130", "expected numbers"); FRAME_RET(v_null()); }
          push(v_num(x + y));
        }
        pc++; break;
      }
      case OP_SUB: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); FRAME_RET(v_null()); }
        push(v_num(x - y)); pc++; break; }
      case OP_MUL: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); FRAME_RET(v_null()); }
        push(v_num(x * y)); pc++; break; }
      case OP_DIV: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); FRAME_RET(v_null()); }
        if (y == 0) { fail("HMYR-R0120", "division by zero"); FRAME_RET(v_null()); }
        push(v_num(x / y)); pc++; break; }
      case OP_MOD: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-R0130", "expected numbers"); FRAME_RET(v_null()); }
        if (y == 0) { fail("HMYR-R0120", "division by zero"); FRAME_RET(v_null()); }
        double m = x - y * (double)(long long)(x / y);
        push(v_num(m)); pc++; break; }
      case OP_EQ: { Value b = pop(), a = pop(); push(v_bool(values_equal(a, b))); pc++; break; }
      case OP_NE: { Value b = pop(), a = pop(); push(v_bool(!values_equal(a, b))); pc++; break; }
      case OP_LT: case OP_LE: case OP_GT: case OP_GE: {
        Value b = pop(), a = pop();
        int c = 0;
        int 能比 = 1;
        if (a.tag == T_NUM && b.tag == T_NUM) {
          /* NaN 与任何东西都不可比，而下面那行会把不可比压成 0（等于）——
             于是 <= 与 >= 会成立。这条规矩在 src/numbers.mjs 的 有序 里也写着。 */
          if (a.num != a.num || b.num != b.num) 能比 = 0;
          c = (a.num < b.num) ? -1 : (a.num > b.num ? 1 : 0);
        }
        else if (a.tag == T_STR && b.tag == T_STR) c = str_cmp(a, b);
        else { fail("HMYR-R0131", "cannot compare those two values"); FRAME_RET(v_null()); }
        int r = 0;
        if (!能比) r = 0;
        else if (in->op == OP_LT) r = c < 0;
        else if (in->op == OP_LE) r = c <= 0;
        else if (in->op == OP_GT) r = c > 0;
        else r = c >= 0;
        push(v_bool(r)); pc++; break;
      }
      case OP_JMP: pc = (int32_t)in->a; break;
      case OP_JMPF: { Value v = pop(); if (!truthy(v)) pc = (int32_t)in->a; else pc++; break; }
      case OP_JMPT: { Value v = pop(); if (truthy(v)) pc = (int32_t)in->a; else pc++; break; }
      case OP_JMPF_KEEP: if (g_机->stack_n > base && !truthy(g_机->stack[g_机->stack_n - 1])) pc = (int32_t)in->a; else { pop(); pc++; } break;
      case OP_JMPT_KEEP: if (g_机->stack_n > base && truthy(g_机->stack[g_机->stack_n - 1])) pc = (int32_t)in->a; else { pop(); pc++; } break;
      case OP_TUPLE: {
        uint32_t n = (uint32_t)in->a;
        Value v = v_null(); v.tag = T_TUPLE; v.ilen = n;
        v.items = alloc_values(n);
        for (uint32_t i = 0; i < n; i++) v.items[i] = g_机->stack[g_机->stack_n - n + i];
        g_机->stack_n -= n;
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
        for (uint32_t i = 0; i < n; i++) v.rec.vals[i] = g_机->stack[g_机->stack_n - n + i];
        g_机->stack_n -= n;
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
          uint32_t fl3 = (g_机->当前函数 && g_机->当前函数->name_len < 47) ? g_机->当前函数->name_len : 0;
          for (uint32_t k = 0; k < fl3; k++) 函名[k] = (g_机->当前函数->name[k] < 128) ? (char)g_机->当前函数->name[k] : '?';
          函名[fl3] = 0;
          snprintf(m, sizeof m, "field '%s' read off a value that is not a record (tag=%d, %s pc=%u)",
                   名, (int)t.tag, 函名, (unsigned)pc);
          fail("HMYR-R0106", m);
          FRAME_RET(v_null());
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
        if (!found) { fail("HMYR-R0106", "no field with that name"); FRAME_RET(v_null()); }
        pc++; break;
      }
      case OP_INDEX: {
        Value i = pop(), t = pop();
        int ok = 0; double d = as_num(i, &ok);
        if (!ok) { fail("HMYR-R0130", "index must be a number"); FRAME_RET(v_null()); }
        /* 下标先取下整，与 slice 的起止、设()、chr() 同一条规矩（src/numbers.mjs 的 下整）。
           原来是 (long long) 直接转，对小数是朝零截断，而 JS 那三台用的是 floor —— 负数上不同。 */
        long long idx = (long long)floor(d);
        if (t.tag == T_STR) {
          if (idx < 0 || idx >= (long long)t.slen) { fail("HMYR-R0151", "index outside the value"); FRAME_RET(v_null()); }
          push(v_str(t.s + idx, 1));
        } else if (t.tag == T_TUPLE || t.tag == T_ARRAY) {
          if (idx < 0 || idx >= (long long)t.ilen) { fail("HMYR-R0151", "index outside the value"); FRAME_RET(v_null()); }
          push(t.items[idx]);
        } else { fail("HMYR-R0152", "cannot index that value"); FRAME_RET(v_null()); }
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
        if (g_机->stack_n < base || g_机->stack_n - base < n) {
          char m[160];
          snprintf(m, sizeof m, "a builtin call wants %u argument(s), the frame has %u",
                   (unsigned)n, (unsigned)(g_机->stack_n - base));
          fail("HMYR-R0110", m);
          FRAME_RET(v_null());
        }
        Value *args = (Value *)malloc((size_t)(n ? n : 1) * sizeof(Value));
        for (uint32_t i = 0; i < n; i++) args[i] = g_机->stack[g_机->stack_n - n + i];
        g_机->stack_n -= n;
        Value out = v_null();
        call_builtin(in->a, args, (int)n, &out);
        free(args);
        if (g_failed) FRAME_RET(v_null());
        push(out); pc++; break;
      }
      case OP_CALLF: {
        int64_t 位 = find_func_index(in->a);
        Func *callee = (位 >= 0) ? &g_机->函数们[位] : NULL;
        if (!callee) { fail("HMYR-R0104", "there is no such function"); FRAME_RET(v_null()); }
        if (g_calls_on && g_calls_n < 200000) {
          /* 对某一个函数，顺手把实参的种类打出来：调用序列只说明「调了它」，
           * 说不清「给了它什么」。求二元 就是被盯的那个（79 号）。 */
          if (位 == 79) {
            fprintf(stderr, "ARGS79 base=%u stackn=%u n=%u tags=", (unsigned)base, (unsigned)g_机->stack_n, (unsigned)in->b);
            for (uint32_t i = 0; i < (uint32_t)in->b; i++) fprintf(stderr, " %d", (int)g_机->stack[g_机->stack_n - (uint32_t)in->b + i].tag);
            fprintf(stderr, " lastfield=");
            if (g_last_field >= 0) { for (uint32_t k = 0; k < pool_len[g_last_field] && k < 8; k++) fprintf(stderr, "%04x", (unsigned)pool_p[g_last_field][k]); }
            fprintf(stderr, "\n");
          }
          /* 栈深要减掉本帧基线：C 这边所有帧共用一条栈，而 JS 那边每帧一条。
           * 不减的话两个数字根本不是一回事 —— 这一点白比过一轮。 */
          fprintf(stderr, "EV %ld CALL %lld sn=%u n=%u tags=", g_ev++, (long long)位,
                  (unsigned)(g_机->stack_n - base), (unsigned)in->b);
          for (uint32_t i = 0; i < (uint32_t)in->b; i++) fprintf(stderr, " %d", (int)g_机->stack[g_机->stack_n - (uint32_t)in->b + i].tag);
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
            FRAME_RET(v_null());
          }
        }
        if (g_机->stack_n < base || g_机->stack_n - base < n) {
          char fname[64];
          uint32_t fl = callee->name_len < 63 ? callee->name_len : 63;
          for (uint32_t k = 0; k < fl; k++) fname[k] = (callee->name[k] < 128) ? (char)callee->name[k] : '?';
          fname[fl] = 0;
          char m[260];
          snprintf(m, sizeof m, "calling %s (#%lld) wants %u argument(s), the frame has %u (pc=%u)",
                   fname, (long long)位, (unsigned)n, (unsigned)(g_机->stack_n - base), (unsigned)pc);
          fail("HMYR-R0110", m);
          FRAME_RET(v_null());
        }
        Value *args = (Value *)malloc((size_t)(n ? n : 1) * sizeof(Value));
        for (uint32_t i = 0; i < n; i++) args[i] = g_机->stack[g_机->stack_n - n + i];
        g_机->stack_n -= n;
        Value r = run_func(callee, args, (int)n);
        free(args);
        if (g_failed) FRAME_RET(v_null());
        push(r); pc++; break;
      }
      case OP_RET: { Value v = pop(); g_机->stack_n = base; g_机->基址 = 外base; g_机->当前函数 = 外函; if (g_深度) g_深度--; FRAME_RET(v); }
      default: {
        char msg[160];
        uint32_t k = in->op;
        const char *nm = (k < sizeof op_names / sizeof *op_names) ? op_names[k] : "?";
        snprintf(msg, sizeof msg, "cannot execute the instruction %s", nm);
        fail("HMYR-R0110", msg);
        FRAME_RET(v_null());
      }
    }
  }
}

/* 桌面那一份：文件系统 + 标准输出。板子不装平台口时也会走到这里，
 * 而板子上它读不到文件 —— 那不是错误，那是「还没装」。 */
static uint8_t *桌面读文件(const char *path, size_t *out_len) {
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

static uint8_t *read_file(const char *path, size_t *out_len) {
  if (g_平台.读) {
    uint8_t *p = NULL;
    size_t n = 0;
    if (!g_平台.读(path, &p, &n)) {
      fprintf(stderr, "hmyr: the platform could not read %s\n", path);
      exit(1);
    }
    *out_len = n;
    return p;
  }
  return 桌面读文件(path, out_len);
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
  g_机->函数们 = NULL;
  g_机->函数数 = 0;
  pool_p = NULL;
  pool_len = NULL;
  pool_n = 0;
  pool_cap = 0;
  g_机->stack_n = 0;
  g_机->基址 = 0;
  g_机->当前函数 = NULL;
  g_failed = 0;
  g_last_field = -1;
  g_trace_at = 0;
  g_机->步数 = 0;
  g_机->argv = v_null();
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
/* 内置种子写到哪儿：与编译产物分开一个名字，免得 cli_main 的清理删错文件。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
static char g_种子临时[1024];

static int 写种子临时(char *buf, size_t cap) {
  临时路径(buf, cap);
  size_t n = strlen(buf);
  if (n > 6 && strcmp(buf + n - 6, ".hmyrb") == 0) {
    snprintf(buf + n - 6, cap - (n - 6), ".seed.hmyrb");
  }
  FILE *f = 开文件(buf, "wb");
  if (!f) return 0;
  size_t 写 = fwrite(hmyr_pack_seed, 1, sizeof hmyr_pack_seed, f);
  fclose(f);
  return 写 == sizeof hmyr_pack_seed;
}
#endif


/* 种子在哪。内置优先：可执行文件带着编译器，拷到哪都能用，不依赖旁边的 bootstrap/。
 * 然后才是环境变量、可执行文件旁边、当前目录 —— 那三条给「想用另一份种子」的人留的。 */
static int 找种子(char *buf, size_t cap, const char *argv0) {
  const char *env = getenv("HMYR_SEED");
  if (env && *env) {
    snprintf(buf, cap, "%s", env);
    if (文件在(buf)) return 1;
    /* 给了却不在：明说，别悄悄落到内置那一份 —— 那会让人以为自己的种子生效了。 */
    return 0;
  }
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
  /* 没有明确指定时用内置那一份：可执行文件自带编译器。 */
  if (sizeof hmyr_pack_seed > 1 && 写种子临时(buf, cap)) {
    snprintf(g_种子临时, sizeof g_种子临时, "%s", buf);
    return 1;
  }
#endif
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
  g_机->步限 = 限;
  g_机->步数 = 0;
  g_failed = 0;

  /* 第一个槽位是脚本自己，之后才是参数 —— 与启动器那一层的约定一致。 */
  g_机->argv = v_null();
  g_机->argv.tag = T_TUPLE;
  g_机->argv.ilen = (uint32_t)(nrest + 1);
  g_机->argv.items = alloc_values(g_机->argv.ilen);
  {
    uint32_t n16 = 0;
    uint16_t *u = utf8_to_utf16(argv0, strlen(argv0), &n16);
    g_机->argv.items[0] = v_str(u, n16);
  }
  for (int i = 0; i < nrest; i++) {
    uint32_t n16 = 0;
    uint16_t *u = utf8_to_utf16(rest[i], strlen(rest[i]), &n16);
    g_机->argv.items[i + 1] = v_str(u, n16);
  }

  /* 入口：带参数时用 命令行入口，否则用 main。自举层两个都有 ——
   * main 是它自己的四行自测，命令行入口 是真的那个。 */
  Func *entry = NULL;
  Func *cli = NULL;
  {
    const uint16_t cli_name[] = { 0x547D, 0x4EE4, 0x884C, 0x5165, 0x53E3 };
    for (uint32_t i = 0; i < g_机->函数数; i++) {
      Func *f = &g_机->函数们[i];
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

/* 库入口：给没有 argv、也没有文件系统的地方用 —— 板子、别的语言的 FFI、
 * 以及任何「字节码已经在内存里」的宿主。
 *
 * 路径照样要传：它是平台口「读」的钥匙。板子上那个读是忽略路径的
 * （见 port/arm-port.c），桌面上那个读就是 fopen。于是同一个入口两边都成立。
 */
int hmyr_运行(const char *路径, int 参数量, char **参数) {
  int nrest = 参数量 > 0 ? 参数量 - 1 : 0;
  return run_bytecode(路径, 路径, nrest, 参数, 步限从环境());
}

#ifndef HMYR_LIB
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
  g_depth_on = getenv("HMYR_DEPTH") != NULL;
  {
    const char *md = getenv("HMYR_MAX_DEPTH");
    if (md) {
      long v = atol(md);
      if (v > 0) g_depth_cap = (uint32_t)v;
    }
  }
  for (int i = 0; i < TRACE_N; i++) g_trace[i].op = 255;
  if (getenv("HMYR_MEM")) atexit(堆账报一下);
  /* 回收：默认开，HMYR_GC=0 关掉。阈值默认三十二兆（HMYR_GC_BYTES 改）。
   * 为什么改默认：实测同一份自编译，关着峰值 279.3 兆、开着 151.2 兆，
   * 而耗时几乎一样（12.8 秒对 12.6 秒）。原来那句「一次运行很短，GC 是另一件工作」
   * 在峰值上已经站不住 —— 二百五十六兆的界线只剩四十兆余量。
   * 板子上不编这一块，那几个变量也不在 —— 所以这一段只给桌面。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
  { const char *gc = getenv("HMYR_GC"); g_gc开 = (gc == NULL) || !(gc[0] == 48 && gc[1] == 0); }
  g_gc日志 = getenv("HMYR_GC_LOG") != NULL;
  {
    const char *gb = getenv("HMYR_GC_BYTES");
    if (gb) {
      long v = atol(gb);
      if (v > 0) g_gc阈值 = (size_t)v;
    }
  }
#endif
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
    if (名长 > 5 && strcmp(argv[1] + 名长 - 5, ".hmyr") == 0) {
      int 码 = cli_main(argc, argv);
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
      if (g_种子临时[0]) remove(g_种子临时);
#endif
      return 码;
    }
  }
  return run_bytecode(argv[1], argv[1], argc - 2, argv + 2, 步限从环境());
}
#endif  /* HMYR_LIB：库那一侧不要 main，要的是 hmyr_运行 */
