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
 *     anything else reports HMYR-行-005 and stops
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

/* 线程局部：这一台机器里「每台一份」的那几样状态。
 *
 * 为什么不给每个函数加一个 Hmyr机器 * 参数：那要动十三个函数的签名与它们全部的
 * 调用点，而换来的只是「同一个东西换个写法」。让「哪一台机器」成为一个线程局部的
 * 全局指针，现有代码一行不发生改变，而每个线程看到的是自己那一份 ——
 * 那正是「实例」要的效果，也是这一步唯一需要的效果。
 *
 * 板子那一支不编线程，TLS 也就不必存在：裸机上 __thread 要一个 TLS 段，
 * Cortex-M 上没有，所以那边这个宏是空的（那台机器仍然只有一个实例，也只需要一个）。
 */
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
#define 线程局部
#elif defined(_MSC_VER)
#define 线程局部 __declspec(thread)
#else
#define 线程局部 __thread
#endif

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
static 线程局部 size_t g_mem_live = 0;
static 线程局部 size_t g_mem_peak = 0;

/* 分配上限。默认四吉字节 —— 这台机器没有回收，于是一个平方级的累积能把
 * 整台机器的内存吃满，而「没有 GC」不等于「可以吃满」。
 * 超过就明确退出（退出码 71），不让操作系统去收拾。
 * HMYR_MEM_LIMIT 改这个数（兆字节）；给 0 表示不限，只给查的人用。 */
static 线程局部 size_t g_mem_limit = (size_t)4 * 1024 * 1024 * 1024;

/* 让路：这台机器不只跑这一个程序。可用物理内存低于这道水位时先歇一下，
 * 等别人走完再分配；一直低就明确退出 —— 把内存吃满会触发系统那一层的内存压缩，
 * 整机跟着卡，那比这个程序失败严重得多。 */
#define 水位 ((size_t)1536 * 1024 * 1024)
#define 每查一次 ((size_t)1024 * 1024)

static 线程局部 size_t g_mem_since_check = 0;

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

/* 分配直方图：按大小分桶，看「哪一档分配最多」。
 *
 * 为什么要有这一条：同一个程序在 32 位宿主上是 75343 字节的堆峰值，
 * 而在 Cortex-M4 上是 39322 —— 两个都是 4 字节指针，差的那一半光靠读代码找不到。
 * 有了直方图，两边的差别会落在一个具体的档上（比如「96 字节那一档多分配了 2 倍」），
 * 而那种句子是可以去查的。
 *
 * 桶按 8 字节对齐分，因为两边都按 8 对齐 —— 对齐不在这一层，而在 memalign/结构布局。
 * 只在 HMYR_MALLOC_HIST=1 时统计，平常一个字节都不多花。 */
#define 桶数 24
static size_t g_桶[桶数];
/* 每档的字节总量（2026-10-31 补）。最后一档是「184 字节及以上」，
 * 而它只记次数的时候，「堆被谁吃掉」这个问题在那里断掉：六份跑完 heap 是一八七〇八二，
 * 而各档次数加起来只有一千五百多次、按档上限估不过四万多 —— 差的那一截就在这最后一档里
 * （一次操作数栈扩容就是上万字节）。记上字节之后，那一档自己会说话。 */
static size_t g_桶字节[桶数];
static int g_记直方 = 0;

static void 直方记一笔(size_t n) {
  if (!g_记直方) return;
  size_t 档 = n / 8;
  if (档 >= 桶数) 档 = 桶数 - 1;
  g_桶[档]++;
  g_桶字节[档] += n;
}

/* 行号证据的声明要在「报一下」之前：那个函数会把它们打出来。
 * 分工上它们属于同一组设施，所以摆在一起读更顺，而不是把打印拆成两处。 */
#define 行号桶数 32
static unsigned g_行号[行号桶数];
static unsigned g_行号次[行号桶数];
/* 每一行要走的字节总量（2026-10-31 补）。次数多不等于字节多 ——
 * 六份跑完时「184 字节及以上」那一档累计是二八九七五六字节，却只有 68 次，
 * 而次数最多的那几行都是几十字节的小分配。两个数要能对上看，才找得到大头。 */
static size_t g_行号字节[行号桶数];
static int g_行号用 = 0;

/* GC 块按种类记数（0 值槽、1 字符串、2 索引项、3 索引）。声明放在这里，
 * 因为报数的那一段在下面，而它要读这两张表。 */
static unsigned g_种次[4];
static size_t g_种字节[4];
/* 再按档分开：种类 × 大小。这一张表是为「95 个字符串块到底落进哪一档」准备的 ——
 * 只有种类与只有档位都对不上时，交叉一下就能看出是「没分配」还是「落错了档」。 */
static unsigned g_种档[4][24];

static void 直方报一下(void) {
  fprintf(stderr, "hist:");
  for (int i = 0; i < 桶数; i++) {
    if (g_桶[i] == 0) continue;
    fprintf(stderr, " %d:%llu", (int)(i * 8), (unsigned long long)g_桶[i]);
  }
  fprintf(stderr, "\n");
  /* 行号证据另起一行：与 hist 的分工是「哪一档」对「谁在要它」。
   * 两行都要，因为一个说尺寸、一个说来源，而对不上就说明两边算的不是同一件事。 */
  fprintf(stderr, "lines:");
  for (int i = 0; i < g_行号用; i++) fprintf(stderr, " %u:%llu", g_行号[i], (unsigned long long)g_行号次[i]);
  fprintf(stderr, "\n");
  /* GC 块按种类分开：第三个答案，也是最能对上的那个 —— 行号说「哪一行」，
   * 种类说「哪一类东西」，而「少 22 个块对不上少 51 次」这种矛盾要在这一行里解。 */
  fprintf(stderr, "kinds:");
  for (int i = 0; i < 4; i++) {
    if (g_种次[i] == 0) continue;
    fprintf(stderr, " %d:%llu/%lluB", i, (unsigned long long)g_种次[i], (unsigned long long)g_种字节[i]);
  }
  fprintf(stderr, "\n");
  /* 种类 × 档：最后一层证据。它一次回答「95 个字符串块到底落进哪一档」——
   * 而只有这一层能把「种类的数」与「档位的数」对上。 */
  for (int i = 0; i < 4; i++) {
    int 有 = 0;
    for (int j = 0; j < 24; j++) if (g_种档[i][j]) 有 = 1;
    if (!有) continue;
    fprintf(stderr, "kindband %d:", i);
    for (int j = 0; j < 24; j++) if (g_种档[i][j]) fprintf(stderr, " %d:%u", j * 8, g_种档[i][j]);
    fprintf(stderr, "\n");
  }
}

static void 直方开(void) {
  g_记直方 = 1;
  atexit(直方报一下);
}

/* 调用点证据：哪一行的分配最多。
 *
 * 为什么要有这一条：直方图把「差一半」落到 24 到 31 字节那一档之后，下一个问题
 * 就是「谁在要那个尺寸」。板子上没有 backtrace，也没有好的办法去拿返回地址，
 * 但有一个更好也更便宜的东西：__LINE__。它是编译期常数，传一次是一个立即数，
 * 而这个宏在关了统计时编出来与原来那一次调用没有区别。
 *
 * 只在 HMYR_MALLOC_HIST=1 时记录，桶按行号存（一张小表，满了就记进「其它」）。 */

static void 行号记一笔(unsigned 行, size_t n) {
  if (!g_记直方) return;
  for (int i = 0; i < g_行号用; i++) {
    if (g_行号[i] == 行) { g_行号次[i]++; g_行号字节[i] += n; return; }
  }
  if (g_行号用 < 行号桶数) {
    g_行号[g_行号用] = 行;
    g_行号次[g_行号用] = 1;
    g_行号字节[g_行号用] = n;
    g_行号用++;
  }
}

/* 分配失败要说出去（定义在下面，与平台口那一段放在一起）。
 * 声明在这里，因为失败点在十几个地方，而它们大多在平台口之前。 */
static void 分配失败(void);

/* 失败时要说清三件事：这次要多少、当时用了多少、一共分了多少块。
 *
 * 为什么块数也算一件：统计的 live 只是「请求量之和」，而真实堆里还有每块四字节的头
 * 与分配器的元数据。同样是 50 多 KB 的请求量，块数多一倍，真实占用就差一截 ——
 * 板子上那两次装载的失败点（53796 与 66936）互不相容，就是因为这个差。
 * 三个数并排，才分得清「请求太大」与「块太碎」。 */
static 线程局部 size_t g_失败请求 = 0;
static 线程局部 unsigned g_失败行 = 0;
static 线程局部 size_t g_块数 = 0;

static void *hm_malloc_at(size_t n, unsigned 行) {
  unsigned char *p = (unsigned char *)原malloc(n + sizeof(size_t));
  if (!p) { g_失败请求 = n; g_失败行 = 行; 分配失败(); }
  g_块数++;
  *(size_t *)p = n;
  记一笔(n);
  直方记一笔(n);
  行号记一笔(行, n);
  return p + sizeof(size_t);
}

static void *hm_calloc_at(size_t a, size_t b, unsigned 行) {
  size_t n = a * b;
  void *p = hm_malloc_at(n, 行);
  memset(p, 0, n);
  return p;
}

/* 三个宏把行号钉在每个调用点上。名字与原来的函数一样，所以下面的代码一行都不用改。 */
#define hm_malloc(n)      hm_malloc_at((n), __LINE__)
#define hm_calloc(a, b)   hm_calloc_at((a), (b), __LINE__)
#define hm_realloc(p, n)  hm_realloc_at((p), (n), __LINE__)

/* realloc 失败时也记下要量与行号。
 *
 * 为什么补这一条（2026-10-30）：板子上 50 块那一档报的是
 * 「want 0 live 81768 peak 81800 bytes at line 0」—— 零与零说明失败落在这个函数的
 * 原地扩容分支上，而那里以前既不记要量也不记行号。读者看到 want 0 只会以为
 * 「堆满了」，看不出「这一次它想扩到多大」。 */
static void *hm_realloc_at(void *q, size_t n, unsigned 行) {
  if (!q) return hm_malloc_at(n, 行);
  unsigned char *真 = (unsigned char *)q - sizeof(size_t);
  size_t 旧 = *(size_t *)真;
  真 = (unsigned char *)原realloc(真, n + sizeof(size_t));
  if (!真) { g_失败请求 = n; g_失败行 = 行; 分配失败(); }
  *(size_t *)真 = n;
  g_mem_live -= 旧;
  记一笔(n);
  /* realloc 也进直方与行号表（2026-10-31 补）。
   * 为什么：六份跑完时 heap 是一八七〇八二，而直方各档加起来只有三万多 ——
   * 差的一百五十多 KB 全在这条路上（操作数栈的扩容就是一次一次 realloc），
   * 于是「堆被谁吃掉」这个问题在表里永远差一块。 */
  直方记一笔(n);
  行号记一笔(行, n);
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

/* 堆峰值，给「跑在别处」的那一侧读（板子上没有 stderr，所以打印这条路不通）。
 *
 * 为什么这个数值得一个正式接口：g_mem_peak 一直是**无条件**记录的
 * （每次分配后都更新），而 HMYR_MEM 只控制打印。也就是说这个数在任何一台机器上
 * 都已经有了，只是裸机上没有地方念出来 —— 于是 design/BOARD.txt 第九节那张表
 * 只能拿 HMYR_MEM 的输出当依据，而那个输出带着诊断自己的分配。
 *
 * 有了这个接口，板侧可以在程序跑完之后把真数吐出来，而那个数里没有诊断开销。 */
size_t hmyr_堆峰值(void) { return g_mem_peak; }

/* 装载分步跟踪：开一次，装载的每一步之后把「到这一步为止的堆峰值」报出去。
 *
 * 为什么需要它，而不是在桌面上算：同一个改动在两个平台上省下的量差了两个数量级
 * —— code_at 压成两字节，32 位桌面上省 22802 字节，板子上只省 482。
 * 那说明两个平台不是卡在同一处，而看代码看不出来。
 *
 * 为什么不用环境变量：板子上 getenv 返回 0，那一条开不起来。所以它是一条接口，
 * 板侧自己决定要不要开（board-main.c 在 HMYR_LOAD_TRACE 编译期开关下开）。 */
static int g_装载跟踪 = 0;

void hmyr_开装载跟踪(void) { g_装载跟踪 = 1; }

/* 一路送到平台口（板子上是串口），因为板子上 stderr 是空的 —— 与 分配失败
 * 走同一条路。桌面上的 报错出去 会退回 fprintf(stderr)。 */
static void 报错出去(const char *话, size_t 长);

/* 把 size_t 写成十进制追加到缓冲里（板子上没有 snprintf，而这一行只有数字）。 */
static int 追加数(char *话, int 位, size_t 值);

/* 执行期的一行诊断走平台口。
 *
 * 为什么补这一条（2026-10-30）：六份自举层在板子上装载成功、执行却一个字节都没有 ——
 * 因为执行期的失败信息走 fprintf(stderr)，而板子上 stderr 是空的。
 * 装载期的失败早就走平台口（分配失败），执行期这一条是漏的。
 * 桌面上的行为不变：报错出去 没有平台口时退回 fprintf(stderr)。 */
static void 报一行(const char *话) {
  size_t n = strlen(话);
  报错出去(话, n);
  报错出去("\n", 1);
}

static void 报装载步(const char *步) {
  if (!g_装载跟踪) return;
  char 话[128];
  int 位 = 0;
  const char *头 = "loadstep ";
  while (*头 && 位 < 20) 话[位++] = *头++;
  while (*步 && 位 < 40) 话[位++] = *步++;
  话[位++] = '=';
  /* 峰值与块数并排：峰值只说「请求了多少」，块数说「切成了几块」——
   * 而板子上真正先耗尽的常常是后者（见 分配失败 那段注释）。
   * 一行两个数，装载的每一步都能读出「还差多少」是差在字节还是差在块。 */
  位 = 追加数(话, 位, g_mem_peak);
  {
    const char *中 = " blocks ";
    while (*中 && 位 < 100) 话[位++] = *中++;
  }
  位 = 追加数(话, 位, g_块数);
  话[位++] = '\n';
  报错出去(话, (size_t)位);
}

/* 分配直方图的第 i 档（按 8 字节一档，24 档）。给裸机那一侧读 ——
 * 那边没有 stderr，所以「打出来看」这条路不通，只能让板侧自己把数字取走再吐。
 *
 * 为什么这件事值得一个接口：同一个程序在 32 位宿主上是 75347 字节、
 * 在 Cortex-M4 上是 39322，两个都是 4 字节指针。差的那一半靠读代码找不到，
 * 而直方图能把它落在一个具体的档上。 */
size_t hmyr_分配档(int i) { return (i >= 0 && i < 桶数) ? g_桶[i] : 0; }
size_t hmyr_档字节(int i) { return (i >= 0 && i < 桶数) ? g_桶字节[i] : 0; }
int hmyr_分配档数(void) { return 桶数; }
void hmyr_开直方(void) { g_记直方 = 1; }

/* 行号证据：第 i 个记下来的调用点在哪一行、分配了多少次。
 *
 * 与 size_t hmyr_分配档(int) 那一对的分工：那个说「哪一档最多」，这个说「谁在要它」。
 * 板子上两样都要，因为没有别的地方能把这两件事对上。 */
unsigned hmyr_分配行(int i) { return (i >= 0 && i < g_行号用) ? g_行号[i] : 0; }
size_t hmyr_分配行次(int i) { return (i >= 0 && i < g_行号用) ? g_行号次[i] : 0; }
/* 第 i 个行号的字节总量 —— 与次数的分工是「多」对「大」，两者都要看。 */
size_t hmyr_分配行字节(int i) { return (i >= 0 && i < g_行号用) ? g_行号字节[i] : 0; }
int hmyr_分配行数(void) { return g_行号用; }

/* GC 块按种类分开：0 值槽、1 字符串、2 索引项、3 索引。
 * 这一组是「谁在要那些块」的第二个答案 —— 第一个是行号，而它只说明「在哪一行」，
 * 种类说明「哪一类东西」。两者合起来，「板子为什么少分配」才有落点。 */
size_t hmyr_种次(int i) { return (i >= 0 && i < 4) ? g_种次[i] : 0; }
size_t hmyr_种字节(int i) { return (i >= 0 && i < 4) ? g_种字节[i] : 0; }
int hmyr_种数(void) { return 4; }

/* 种类 × 档：种类 i 有多少块落在第 j 档（每档 8 字节）。
 * 这一张表是最后那一层证据 —— 它一次回答「95 个字符串块到底落进哪一档」。 */
size_t hmyr_种档次(int 种, int 档) {
  if (种 < 0 || 种 >= 4 || 档 < 0 || 档 >= 24) return 0;
  return g_种档[种][档];
}

/* HMYR_HEAP_ONLY=1：只报峰值，不开诊断。
 *
 * 它与 HMYR_MEM 的差别只有一处，而那一处正是要量准的东西：诊断（记录每次分配）
 * 自己要占堆，而这里只读那个一直在记的数。板子上读到的 zone-ledger 是 39322 字节，
 * 而同一个程序在 HMYR_MEM 下报 131745 —— 差 3.3 倍，那一截就是诊断自己。
 *
 * 格式刻意简单（一行 heap=<十进制>），因为读它的是工具，不是人。 */
static void 堆峰值报一下(void) {
  fprintf(stderr, "heap=%llu\n", (unsigned long long)g_mem_peak);
}

#define malloc(n) hm_malloc(n)
#define calloc(a, b) hm_calloc(a, b)
#define realloc(p, n) hm_realloc_at((p), (n), __LINE__)
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
    if (!b->p) { 分配失败(); }
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
  /* 2026-11-01：下面这几个字段互斥 —— 一个值在任一时刻只能是这几种之一，
   * 所以它们共用一个 union。板子上量出来的五十六字节（design/BOARD.txt
   * 第三十九节）说明每一份 Value 都在为「它可能是什么」付全部字段的钱：
   * 一个整数也在为一个字符串指针、一个元组数组、一张索引表留位置。
   *
   * 为什么字段名一个字都不改：匿名 union 包里再放匿名 struct，于是
   * .num / .s / .slen / .items / .ilen / .rec / .idx 全都照旧 ——
   * 那五百多处调用点一行都不用动，而这一次改的只是布局。
   *
   * 而匿名成员是 C11 的（MSVC 从 2015 起也支持）。老编译器那一支退回旧布局：
   * 字段名一模一样，所以调用点两边都成立，只是不再省那三十二字节
   * （design/BOARD.txt 第四十二节记着这条界线与它的价码）。 */
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L) \
  || (defined(_MSC_VER) && _MSC_VER >= 1900)
  union {
    double num;
    int boolean;
    struct { const uint16_t *s; uint32_t slen; };
    struct { Value *items; uint32_t ilen; };
    Record rec;
    索引 *idx;
  };
#else
  double num;
  int boolean;
  const uint16_t *s;
  uint32_t slen;
  Value *items;
  uint32_t ilen;
  Record rec;
  索引 *idx;
#endif
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
static 线程局部 Hmyr机器 *g_机 = &主机;

/* ---- 线程的形状（定义在文件更靠后的位置） -----------------------------
 *
 * 放在这里而不是内置表旁边：内置表在 call_builtin 的函数体里，而结构体与函数声明
 * 不能在函数体内定义。定义（线程体、线程起、找线程、清线程）放在 run_bytecode
 * 之后，因为它们要用种子、装载与执行那一批函数。
 *
 * 一个线程一个独立的 Hmyr机器 —— 分开的机制是上面那个线程局部的 g_机：
 * 线程入口把它指向自己那一台，于是所有读它的代码在那一个线程里看到自己那一份。
 */
#if defined(_WIN32)
typedef struct 线程上下文 {
  int 号;
  HANDLE 手;
  char 源码路径[1024];
  /* 比源码路径宽八个字节：它是「源码路径 + .hmyrb」，同宽会让 snprintf 报可能截断，
   * 而那个警告是真的（截断之后编出来的产物名与要读的那个对不上）。 */
  char 产物路径[1032];
  char 入口[256];
  char 结果[4096];
  volatile int 完;
  int 码;
  char 话[256];
} 线程上下文;

#define 线程上限 16
static 线程上下文 *g_线程们[线程上限];
static int g_下一个线程号 = 1;

static int 线程起(const char *源码, const char *入口);
static 线程上下文 *找线程(int 号);
static void 清线程(线程上下文 *c);
#endif

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
static 线程局部 int g_gc开 = 0;
static void *gc_分配(size_t 字节, int 种类);
static uint16_t *gc_串分配(size_t 码元数);

/* 一段 UTF-16 的存储：回收开着就交给回收，否则照旧走堆。 */
static uint16_t *串存(size_t 码元数) {
  if (g_gc开) return gc_串分配(码元数);
  {
    uint16_t *p = (uint16_t *)malloc((码元数 ? 码元数 : 1) * sizeof(uint16_t));
    if (!p) { 分配失败(); }
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
  if (!p) { 分配失败(); }
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
    if (!b->p) { 分配失败(); }
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
    /* 判空要在 memset 之前：写成「先 memset 再统一判空」时，裸机那一份的 -Wnonnull
     * 会说「argument 1 null where non-null expected」，而它说的是实情。 */
    if (!t) { 分配失败(); }
    memset(t, 0, sizeof(索引));
  } else {
    t = (索引 *)hm_calloc(1, sizeof(索引));
    if (!t) { 分配失败(); }
  }
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
  if (!项) { 分配失败(); }
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
    if (!拷贝) { 分配失败(); }
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
  if (!p) { 分配失败(); }
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
  if (!p) { 分配失败(); }
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

/* 字符串是「u16 长度 + 若干 UTF-16LE 码元」，而它本来就在文件映像里 ——
 * 映像整份常驻（板子上在 Flash，可直接寻址），所以这里只交回偏移，一个字节都不复制。
 *
 * 为什么 2026-10-30 改成偏移：板子上装五份自举层时，三千次 rd_str 就是三千个块，
 * 而每块还有四字节的头与分配器的元数据 —— 光那些就四十 KB 上下，比载荷还大。
 * 名字池按需解码之后，这三千次分配整个不存在。
 *
 * 交回的是「码元数据的起点」与码元数；取第 k 个码元用 池码，
 * 要 uint16_t* 的旧接口用 池取到 解到栈上，而记录字面量那种要长期持有的用 名复制。 */
static uint32_t rd_str(Reader *r, uint32_t *out_len) {
  uint16_t n = rd_u16(r);
  need(r, (size_t)n * 2);
  uint32_t off = (uint32_t)r->at;
  r->at += (size_t)n * 2;
  *out_len = n;
  return off;
}

/* ---- program --------------------------------------------------------- */

enum {
  OP_ADD, OP_ASSIGN, OP_BOOL, OP_CALLB, OP_CALLF, OP_CONST, OP_DIV, OP_EQ,
  OP_FIELD, OP_GE, OP_GLOBAL, OP_GT, OP_INDEX, OP_JMP, OP_JMPF, OP_JMPF_KEEP,
  OP_JMPT, OP_JMPT_KEEP, OP_LE, OP_LOAD, OP_LT, OP_MOD, OP_MUL, OP_NE,
  OP_NEG, OP_NOT, OP_POP, OP_RECORD, OP_RET, OP_STORE, OP_SUB, OP_TUPLE,
  /* 新指令追加在末尾，旧号不动 —— 与 src/code-file.mjs 的 操作码表 同一规矩。
   * 插在中间的样子不是「读不懂」，而是整段错位（offset 27185 那次就是它）。 */
  OP_CALLM, OP_SETGLOBAL
};

static const char *op_names[] = {
  "ADD", "ASSIGN", "BOOL", "CALLB", "CALLF", "CONST", "DIV", "EQ",
  "FIELD", "GE", "GLOBAL", "GT", "INDEX", "JMP", "JMPF", "JMPF_KEEP",
  "JMPT", "JMPT_KEEP", "LE", "LOAD", "LT", "MOD", "MUL", "NE",
  "NEG", "NOT", "POP", "RECORD", "RET", "STORE", "SUB", "TUPLE",
  "CALLM", "SETGLOBAL"
};

typedef struct {
  uint8_t op;
  int64_t a;       /* slot, jump target, pool index, or count */
  int64_t b;       /* second immediate (argument count, record arity) */
  Value val;       /* CONST payload */
} Ins;

typedef struct Func {
  /* 名字与效果名都是「字节流里的偏移 + 码元数」，不复制 —— 见 rd_str 那段注释。
   * 取码元用 名码，要 uint16_t* 的接口用 池取到 解到栈上。 */
  uint32_t name_off;
  uint32_t name_len;
  uint16_t nargs;
  uint16_t nslots;
  uint16_t neffects;
  uint32_t *effect_offs;
  uint32_t *effect_lens;
  uint32_t ncode;
  /* 指令不预先解成 Ins 数组，只记每条在这份字节码里的位置。
   *
   * 为什么：装载占整个 footprint 的 96%（32 位桌面上 1075474 字节，其中
   * 执行只占 49430），而 Ins 每条约四十字节、一份五份自举层有一万多条。
   * 改成「偏移表 + 现场解一条」之后，那四十字节换成两字节。
   *
   * 为什么是段内偏移而不是绝对偏移：一张一万四千项的表，四字节是 56 KB，
   * 两字节是 28 KB —— 而板子上 RAM 只有 128 KB，28 KB 不是小数。
   * 段内偏移能放进两字节，是因为一个函数的指令流在一个文件里不会跨过 64 KB
   * （最大的那一个约 30 KB，见 design/BOARD.txt 第十二节那次量测）。
   * 装载时若真的越了线，会在那里停下并说出来 —— 悄悄截断比停下坏得多。
   *
   * 为什么保留指令序号而不是全改成字节偏移：pc 与所有跳转目标都是序号，
   * 而改成字节偏移会动字节码格式 —— 那是另一件事，且它会让两台机器之间
   * 的字节码不再通用。 */
  /* 分段表：每 码段宽 条指令记一个段内偏移（四字节）。
   *
   * 为什么还要这一步：两字节一条、一万四千项仍然是 28 KB，而板子上一次装载
   * 能拿到的全部约 75 KB —— 它一个人占了近四成。分段之后约 1 KB，
   * 而顺序执行那一部分不受影响：执行循环里有一条「下一条的起点」缓存，
   * 只有跳转才需要从段头扫过去（见 跑函数 里那段）。
   *
   * 为什么段宽是 64：跳转时最多扫 63 条字节流，而顺序执行命中缓存。
   * 段再窄省不了多少内存（表本身已经很小），段再宽就变成每次跳转都扫很久。 */
  uint32_t code_base;
  uint32_t seg_n;
  uint32_t *seg_at;
} Func;

/* 一条指令占几项分段表 —— 见 Func 里 seg_at 的注释。 */
#define 码段宽 64

/* A name pool: every string a caller might need to compare by name.
 *
 * 2026-10-31 起，池本身也没有了。它以前记「名字在字节流里的起点与码元数」，
 * 而这两样都能从字节流当场取出来（名长 读长度那两字节，名码 读第 k 个码元），
 * 于是指令里只留一个偏移就够 —— 池的两张表（一万六千项，各六十四 KB）省掉了。
 * 那块板子一共一百二十八 KB，这一刀拿掉的正好一半。见 design/BOARD.txt 第二十二节。 */

/* 字节流的起点与长度：名字要从这里读。定义在装载那一段，声明提到这儿。
 *
 * 线程局部（2026-11-02 修的真 bug）：这两样是「我现在跑的是哪一份字节码」，
 * 而一个线程一个独立的 Hmyr机器 —— 它们属于那个「现在」，不属于整个进程。
 * 原来是普通全局，于是子线程 load_program 一设就把主线程的映像换掉了：
 * 症状是主线程执行到某条指令时按子线程的长度去读，报
 * 「the file ends in the middle of something (offset 278)」而那个偏移落在
 * 主程序自己的长度里 —— 线程读的明明是 116 字节的产物。 */
static 线程局部 const uint8_t *g_码起;
static 线程局部 size_t g_码长;

/* 偏移 off 处第 k 个码元（UTF-16LE，与 rd_str 读的是同一份字节）。 */
static uint16_t 名码(uint32_t off, uint32_t k) {
  size_t 位 = (size_t)off + (size_t)k * 2;
  return (uint16_t)(g_码起[位] | ((uint16_t)g_码起[位 + 1] << 8));
}

/* 名字的长度就在它的码元前面两字节 —— rd_str 读的就是它。
 *
 * 有了它，指令里只存一个偏移就够：长度、码元都能从字节流当场取出来。
 * 而这就是「名字池可以整个去掉」的依据（design/BOARD.txt 第二十二节）。 */
static uint32_t 名长(uint32_t off) {
  return (uint32_t)(g_码起[off - 2] | ((uint16_t)g_码起[off - 1] << 8));
}

/* 按 UTF-16 码元比名字。参数是字节流里的偏移，不再是池索引。 */
static int name_is16(uint32_t off, const uint16_t *u, uint32_t n) {
  if (名长(off) != n) return 0;
  for (uint32_t i = 0; i < n; i++) if (名码(off, i) != u[i]) return 0;
  return 1;
}

/* 按 ASCII 字节比名字。name_is 用的是字节，而中文名字（数组、设）
 * 在名字表里是码元 —— 拿字节去比永远不相等。 */
static int name_is(uint32_t off, const char *ascii) {
  uint32_t n = 名长(off);
  if (n != strlen(ascii)) return 0;
  for (uint32_t i = 0; i < n; i++) if (名码(off, i) != (uint16_t)(unsigned char)ascii[i]) return 0;
  return 1;
}

/* 把一段名字解到调用方给的缓冲里，交回写进去的码元数。 */
static uint32_t 名解到(uint32_t off, uint16_t *buf, uint32_t cap) {
  uint32_t n = 名长(off);
  uint32_t k = n < cap ? n : cap;
  for (uint32_t i = 0; i < k; i++) buf[i] = 名码(off, i);
  return k;
}

/* 这个名字与 名码 是同一件事。它保留旧名字，是因为调用点有二十多处，
 * 而它们现在传的东西已经从「池索引」换成了「字节流里的偏移」——
 * 语义的变更写在 design/BOARD.txt 第二十二节，函数签名一个字没动。 */
static uint16_t 池码(uint32_t off, uint32_t k) { return 名码(off, k); }

/* 把一段名字解到调用方给的缓冲里，交回写进去的码元数。
 * 名字比缓冲长时截断，而截断不会造成静默的错误相等：长度比较用的是 名长，
 * 两边长度相等才进逐码元比较，所以一个超长名字只可能与另一个同样超长、且前 cap
 * 个码元相同的名字误配 —— 标识符不会有那么长。 */
static uint32_t 池取到(uint32_t off, uint16_t *buf, uint32_t cap) {
  return 名解到(off, buf, cap);
}

/* 复制一份出来，给「必须长期持有」的地方（记录字面量的字段名）。
 * 主路是 池码 那条不分配的路，这一条只服务那几处。
 *
 * 2026-10-31 起按偏移缓存：同一个偏移只复制一次。
 *
 * 为什么要缓存（板子上量出来的数）：六份自举层跑完时这一行被调用 1196 次，
 * 而 56 字节档有 1127 块 —— 它们复制的其实是同一小批名字（每一条记录字面量的
 * 字段名，执行到那条指令就复制一次）。板子上没有 GC，那六十三 KB 只增不减。
 *
 * 缓存有个上界；满了就退回逐次分配 —— 那种情况说明名字种类比这个数还多，
 * 而它不该发生。发生了也不会错，只是不再省。 */
#define 名缓存数 128
static 线程局部 uint32_t 名缓存偏[名缓存数];
static 线程局部 uint32_t 名缓存长[名缓存数];
static 线程局部 uint16_t *名缓存指[名缓存数];
static 线程局部 int 名缓存用 = 0;

static uint16_t *名复制(uint32_t off, uint32_t len) {
  for (int i = 0; i < 名缓存用; i++) {
    if (名缓存偏[i] == off && 名缓存长[i] == len) return 名缓存指[i];
  }
  uint16_t *buf = (uint16_t *)malloc((size_t)(len ? len : 1) * sizeof(uint16_t));
  if (!buf) { 分配失败(); }
  for (uint32_t i = 0; i < len; i++) buf[i] = 名码(off, i);
  if (名缓存用 < 名缓存数) {
    名缓存偏[名缓存用] = off;
    名缓存长[名缓存用] = len;
    名缓存指[名缓存用] = buf;
    名缓存用++;
  }
  return buf;
}

static int64_t read_value(Reader *r, Value *out);

/* 解一个值。out 为 NULL 时只把字节流扫过去，一个值都不构造 —— 装载那一步
 * 就是这样扫指令的（见 读一条 的注释）。
 *
 * 为什么这一条值得单独说（2026-10-30）：以前 out 为 NULL 时照样构造，
 * 于是一条 CONST 里的字符串常量会复制一份、然后丢掉 —— 五份自举层里有八百个，
 * 而它们全都算进装载的块数。装载期块数从 1248 降到四百多，靠的就是这一条：
 * 「扫过」与「造出来」是两件事，而装载只要前者。 */
static int64_t read_value(Reader *r, Value *out) {
  uint8_t t = rd_u8(r);
  if (t == 0x00) { if (out) *out = v_null(); return 0; }
  if (t == 0x01) { double d = rd_f64(r); if (out) *out = v_num(d); return 0; }
  if (t == 0x02) {
    uint32_t n;
    uint32_t off = rd_str(r, &n);
    /* 字符串常量要长期持有（它进 Value，跟着值走），所以这里有一份复制。
     * 而 out 为 NULL 的那条路上它一份都不该有。 */
    if (out) *out = v_str(名复制(off, n), n);
    return 0;
  }
  if (t == 0x03) { uint8_t b = rd_u8(r); if (out) *out = v_bool(b); return 0; }
  if (t == 0x04) {
    uint16_t n = rd_u16(r);
    if (!out) {
      for (uint16_t i = 0; i < n; i++) read_value(r, NULL);
      return 0;
    }
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
    if (!out) {
      for (uint16_t i = 0; i < n; i++) { uint32_t len = 0; rd_str(r, &len); read_value(r, NULL); }
      return 0;
    }
    Value *vals = alloc_values(n);
    const uint16_t **names = (const uint16_t **)calloc(n ? n : 1, sizeof(uint16_t *));
    uint32_t *lens = (uint32_t *)calloc(n ? n : 1, sizeof(uint32_t));
    for (uint16_t i = 0; i < n; i++) {
      uint32_t len = 0;
      uint32_t off = rd_str(r, &len);
      /* 记录字段名要跟着值走（值会被搬来搬去），所以这里复制一份。 */
      names[i] = 名复制(off, len);
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

/* 从字节流里解出一条指令。out 为 NULL 时只扫过、不落任何东西 —— 装载那一步
 * 就是靠这个「只扫不建」的形态省掉整个 Ins 数组的。
 *
 * 为什么这条抽得出来：装载与执行要解的是同一串字节，而它们做的 switch 一模一样。
 * 抽出来之后「不整份驻留」才有可能 —— 装载只记每条指令在流里的偏移，
 * 执行时按那个偏移现场解一条。
 *
 * 名字池照旧在这一层收：out 为 NULL 时也要收，因为池是整份文件共享的，
 * 与「这条指令有没有被存下来」无关。 */
static void 读一条(Reader *r, Ins *out) {
  Ins 本地;
  Ins *in = out ? out : &本地;
  in->op = rd_u8(r);
  in->a = 0;
  in->b = 0;
  in->val = v_null();
  switch (in->op) {
    /* out 为 NULL 时连值都不构造：装载扫一遍只需要知道它有多长。
     * 这一句与 read_value 里那条「out 为 NULL 就不造」是一对。 */
    case OP_CONST: read_value(r, out ? &in->val : NULL); break;
    case OP_LOAD: case OP_ASSIGN: in->a = rd_u16(r); break;
    case OP_STORE: in->a = rd_u16(r); in->b = rd_u8(r); break;
    case OP_GLOBAL: case OP_FIELD: case OP_SETGLOBAL: {
      /* 名字只留偏移：长度与码元都能从字节流当场取（名长 读的就是长度那两字节）。 */
      uint32_t n; uint32_t off = rd_str(r, &n); (void)n; in->a = off; break;
    }
    case OP_JMP: case OP_JMPF: case OP_JMPT: case OP_JMPF_KEEP: case OP_JMPT_KEEP:
      in->a = rd_u32(r); break;
    case OP_TUPLE: in->a = rd_u16(r); break;
    case OP_RECORD: {
      uint16_t n = rd_u16(r);
      /* 字段名只留第一个的偏移：执行期从那里顺着字节流读 n 段
       * （每段是「u16 长度 + 码元」，所以下一个的偏移能算出来）。
       * 2026-10-31 之前这里存的是一段连续的池索引 —— 池去掉之后改成这个样子，
       * 那个「必须连续」的坑也跟着消失了。 */
      uint32_t off0 = 0;
      for (uint16_t k = 0; k < n; k++) {
        uint32_t len; uint32_t off = rd_str(r, &len);
        if (k == 0) off0 = off;
      }
      in->a = (int64_t)off0;
      in->b = n;
      break;
    }
    case OP_CALLB: case OP_CALLF: case OP_CALLM: {
      uint32_t n; uint32_t off = rd_str(r, &n); (void)n;
      in->a = off;
      in->b = rd_u16(r);
      break;
    }
    default: break;
  }
}

/* 整份字节码的起点与长度（它们的定义在名字池那一段 —— 取名码要从这里读）。
 * 装载不复制它，执行时按 seg_at 里的偏移去现场解一条 —— 于是「贴着字节流读」
 * 这件事在桌面上是贴着内存里的那一份，在板子上可以贴着 Flash（0x08000000 可直接寻址）。
 * 那一份的生命周期与这台机器一样长，所以不必释放。 */

static void load_program(const uint8_t *bytes, size_t len) {
  Reader r = { bytes, len, 0 };
  g_码起 = bytes;
  g_码长 = len;
  const char *magic = "HMYRB";
  for (int i = 0; i < 5; i++) {
    if (rd_u8(&r) != (uint8_t)magic[i]) { fprintf(stderr, "hmyr: not a .hmyrb file\n"); exit(2); }
  }
  uint16_t ver = rd_u16(&r);
  if (ver != 1) { fprintf(stderr, "hmyr: file version %u, this reader knows 1\n", ver); exit(2); }

  g_机->函数数 = rd_u16(&r);
  g_机->函数们 = (Func *)calloc(g_机->函数数 ? g_机->函数数 : 1, sizeof(Func));
  报装载步("函数表");
  for (uint32_t i = 0; i < g_机->函数数; i++) {
    Func *f = &g_机->函数们[i];
    f->name_off = rd_str(&r, &f->name_len);
    f->nargs = rd_u16(&r);
    f->nslots = rd_u16(&r);
    f->neffects = rd_u16(&r);
    f->effect_offs = (uint32_t *)calloc(f->neffects ? f->neffects : 1, sizeof(uint32_t));
    f->effect_lens = (uint32_t *)calloc(f->neffects ? f->neffects : 1, sizeof(uint32_t));
    for (uint16_t e = 0; e < f->neffects; e++) f->effect_offs[e] = rd_str(&r, &f->effect_lens[e]);
    f->ncode = rd_u32(&r);
/* 指令只记偏移，不建 Ins 数组 —— 现场解一条（读一条 的第二参数传 NULL）。
     * 这一句是「不整份驻留」的全部：把两字节的段内偏移换掉几十万字节的指令数组。 */
    f->code_base = (uint32_t)r.at;
    /* 每 码段宽 条指令记一个段内偏移 —— 见 Func 里 seg_at 那段注释。
     *
     * 表项是四字节而不是两字节：段内偏移本来能放进两字节（一个函数的指令流
     * 不会跨过 64 KB），但一张几百项的表用四字节只多几百字节，而
     * 两字节版本要带一条越界检查 —— 那条检查现在不必有了，因为四字节的
     * 段内偏移在这个程序里不会溢出。少一条错误路径就是少一处将来会骗人的地方。 */
    f->seg_n = f->ncode ? (f->ncode + 码段宽 - 1) / 码段宽 : 1;
    f->seg_at = (uint32_t *)calloc(f->seg_n, sizeof(uint32_t));
    for (uint32_t c = 0; c < f->ncode; c++) {
      if (c % 码段宽 == 0) f->seg_at[c / 码段宽] = (uint32_t)(r.at - (size_t)f->code_base);
      读一条(&r, NULL);
    }
  }
  报装载步("函数们");
  uint16_t nglob = rd_u16(&r);
  for (uint16_t i = 0; i < nglob; i++) { uint32_t n; rd_str(&r, &n); }
  报装载步("全局名");
  /* HMYR_POOL 那一段随名字池一起去掉了（2026-10-31）。
   * 它当年干的事是「把池按索引打出来与 JS 侧对拍」，而池现在不存在了 ——
   * 名字只剩下偏移，对拍的对象换成了字节流本身，那一条已经由 装载步步 与
   * 两台机器同一个答案的套件覆盖。 */
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

static Hmyr平台 g_平台 = { NULL, NULL, NULL };

void hmyr_装平台(const Hmyr平台 *p) {
  if (p) g_平台 = *p;
}

/* 要命的事说出去：先给平台口那一份（板子上把它写进串口），
 * 没有平台口才退回 stderr（桌面上一直是这样）。
 *
 * 为什么顺序是这个：板子上 stderr 是空的，而桌面上平台口通常是空的 ——
 * 谁装着谁说话，两边都不会两遍。 */
static void 报错出去(const char *话, size_t 长) {
  if (g_平台.错误) { g_平台.错误(话, 长); return; }
  fwrite(话, 1, 长, stderr);
}

/* 分配失败：说清当时堆已经用了多少、峰值到过哪里，然后停。
 *
 * 为什么报「已经用了多少」而不是「这次要多少」：失败点在十几处，每处的要量变量名
 * 都不同，逐个传参会让这一条改动散到十几个函数里；而「堆已经用了多少」是同一件事，
 * 且它比单次的要量更能说明「这个程序超出了这块板子多少」。
 *
 * 为什么这一行的数越加越多：每一次都是上一个数分不出两种情形。
 *
 *   2026-10-28  只有 peak。板子上「装不下」从一片空白变成一句话。
 *   2026-10-30  加 live。分段表那一轮，板子两次装载给出的失败点是 53796（分段表）
 *               与 66936（每条两字节的偏移表），而后者明明占的内存更多 ——
 *               两个数互不相容，需要「失败那一刻」与「历史最高」并排看。
 *   2026-10-30  再加 want 与 blocks。live 与 peak 相等时分不出「一次大请求把剩下的
 *               要光」与「总量到头」，因为失败的那次请求没成功、不进 live。
 *               want 是那一次的请求量（分配器里记下来的，不必逐个调用点传参），
 *               blocks 是一共分了多少块 —— 而块数正是统计学缺的那一项：
 *               live 只算请求量之和，每块四字节的头与分配器元数据都不在里面。
 *
 * 为什么这一条值得单独一个函数：原来的写法是 fprintf(stderr, ...) 之后 exit(70)，
 * 而那在板子上等于「什么也没说就停了」—— 串口一片空白，与「程序根本没跑」
 * 看起来一模一样。design/BOARD.txt 第十一节那张边界表里，40 与 50 块两格
 * 就是这种空白。现在它们会说自己是谁。 */
static int 追加数(char *话, int 位, size_t 值) {
  char 数[24];
  int 数位 = 0;
  if (值 == 0) 数[数位++] = '0';
  while (值 > 0) { 数[数位++] = (char)('0' + (值 % 10)); 值 /= 10; }
  while (数位 > 0) 话[位++] = 数[--数位];
  return 位;
}

static void 分配失败(void) {
  char 话[160];
  int 位 = 0;
  const char *头 = "hmyr: out of memory, want ";
  while (*头) 话[位++] = *头++;
  位 = 追加数(话, 位, g_失败请求);
  {
    const char *甲 = " live ";
    while (*甲) 话[位++] = *甲++;
  }
  位 = 追加数(话, 位, g_mem_live);
  {
    const char *乙 = " peak ";
    while (*乙) 话[位++] = *乙++;
  }
  位 = 追加数(话, 位, g_mem_peak);
  {
    const char *丙 = " blocks ";
    while (*丙) 话[位++] = *丙++;
  }
  位 = 追加数(话, 位, g_块数);
  {
    const char *丁 = " bytes at line ";
    while (*丁) 话[位++] = *丁++;
  }
  位 = 追加数(话, 位, g_失败行);
  {
    const char *尾 = "\n";
    while (*尾) 话[位++] = *尾++;
  }
  报错出去(话, (size_t)位);
  exit(70);
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
  if (!out) { 分配失败(); }
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
  if (!out) { 分配失败(); }
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
static 线程局部 uint32_t g_深度 = 0;
static 线程局部 uint32_t g_最深 = 0;
static int g_depth_on = 0;
static uint32_t g_depth_cap = 0;

/* 栈的证据：最深与最浅的帧地址，差就是这一趟递归真正用掉的栈。
 *
 * 为什么不用「深度乘估算的帧大小」：一个 run_func 的帧里有四十个 Value 的槽栈
 * （五十六字节一个），再加上被调用者的保存寄存器与返回地址 —— 估出来的数与
 * 真实的差一截，而这一整条线已经因为「估」错过一次（载荷与块头）。
 *
 * 帧地址由调用者取：__builtin_frame_address(0) 只有在 run_func 里取才是那一帧。
 * 这个内建在四台机器上都由 gcc 给同一个意思，而读 MSP 要平台口的接口，
 * 桌面那一侧没有可以对照的东西。 */
static 线程局部 void *g_栈高 = 0;
static 线程局部 void *g_栈低 = 0;

/* 栈预算：桌面上的「像板子那样只有这么点栈」。
 *
 * 为什么要在桌面上有它（2026-10-30）：那块板子的栈与堆共享剩下的一百二十八 KB 减去
 * 静态段，而「六份跑不跑得动」这件事以前只有插上板子才知道。有了这个数，同一份程序
 * 在桌面上带 HMYR_STACK_LIMIT=... 就能复现那次失败，不必等硬件。
 *
 * 尺子与板子上那两行 depth=/stack= 是同一把：最深帧地址减最浅帧地址。 */
static 线程局部 size_t g_栈限 = 0;

static Value fail(const char *code, const char *msg);

static void 记栈(void *帧) {
  if (!g_栈高 || 帧 > g_栈高) g_栈高 = 帧;
  if (!g_栈低 || 帧 < g_栈低) g_栈低 = 帧;
  if (g_栈限) {
    size_t 用 = (size_t)((const char *)g_栈高 - (const char *)帧);
    if (用 > g_栈限) {
      char 话[160];
      snprintf(话, sizeof 话, "the stack budget is %llu bytes and this call is %llu bytes into it",
               (unsigned long long)g_栈限, (unsigned long long)用);
      /* 码用 HMYR-行-009：语义是「层次太深」，而栈预算是它的字节版本 ——
       * 平台给不了那么多栈，与深度超限是同一件事的两种量法。 */
      fail("HMYR-行-009", 话);
    }
  }
}

/* 给板侧读的两个数：最深的调用层数，与这一趟递归用掉的栈字节。
 * 两个都无条件记录 —— 板子上没有环境变量，开关只能编译期给。 */
int hmyr_最深(void) { return (int)g_最深; }
int hmyr_栈字节(void) {
  if (!g_栈高 || !g_栈低) return 0;
  return (int)((const char *)g_栈高 - (const char *)g_栈低);
}

/* 深度阶梯：每到一个 2 的幂，在「正常栈」上打一行。
 *
 * 为什么不能等硬错误那一刻再打（2026-10-30 试过）：栈溢出之后，HardFault 处理
 * 里再调用任何函数都会立刻再进一次 HardFault —— 串口上于是只剩半行
 * 「hmyr: hard fault, depth=」被无限重复。崩溃前的输出才是安全的证据。
 *
 * 每个档只打一次（g_深度档上 记着已经打到哪儿），所以递归上来又下去不会重复灌串口。 */
static int g_深度档 = 0;
static uint32_t g_深度档上 = 0;

void hmyr_开深度档(void) { g_深度档 = 1; }

static void 函数名(Func *f, char *out, size_t cap) {
  size_t n = 0;
  if (f && cap > 1) {
    n = f->name_len < cap - 1 ? f->name_len : cap - 1;
    for (size_t i = 0; i < n; i++) {
      uint16_t 码 = 名码(f->name_off, (uint32_t)i);
      out[i] = (码 < 128) ? (char)码 : '?';
    }
  }
  if (cap) out[n] = 0;
}

/* 名字转成 UTF-8，给诊断用（分配一份，调用方 free）。
 * 走一次栈缓冲：名字现在只是一段偏移，而 utf16_to_utf8 要的是连续码元。 */
static char *名字成文(Func *f) {
  uint16_t 缓[128];
  uint32_t n = f->name_len < 128 ? f->name_len : 128;
  for (uint32_t k = 0; k < n; k++) 缓[k] = 名码(f->name_off, k);
  return utf16_to_utf8(缓, n);
}

static void 记深度(Func *f, Func *父) {
  g_深度++;
  /* 深度阶梯：把一个 2 的幂上的深度与当时的栈字节打出去。
   * 这一路用的是还没坏的栈 —— 硬错误处理里不能再调用函数（见 hmyr_开深度档）。 */
  if (g_深度档 && g_深度 > g_深度档上 &&
      (g_深度 == 8 || g_深度 == 16 || g_深度 == 32 || g_深度 == 64 ||
       g_深度 == 128 || g_深度 == 256 || g_深度 == 512)) {
    g_深度档上 = g_深度;
    char 话[88];
    snprintf(话, sizeof 话, "depth=%u stack=%d\n", (unsigned)g_深度, hmyr_栈字节());
    报一行(话);
  }
  if (g_深度 > g_最深) {
    g_最深 = g_深度;
    if (g_depth_on && (g_深度 < 8 || g_深度 % 64 == 0)) {
      char 子名[64], 父名[48];
      函数名(f, 子名, sizeof 子名);
      函数名(父, 父名, sizeof 父名);
      char *名 = 名字成文(f);
      fprintf(stderr, "DEPTH %u #%ld %s (from %s) %s\n", (unsigned)g_深度,
              (long)(f - g_机->函数们), 子名, 父名, 名 ? 名 : "?");
      free(名);
    }
  }
  if (g_depth_cap && g_深度 > g_depth_cap) {
    char *名 = 名字成文(f);
    fprintf(stderr, "hmyr: calls went %u deep, past the ceiling %u (at %s)\n",
            (unsigned)g_深度, (unsigned)g_depth_cap, 名 ? 名 : "?");
    free(名);
    exit(72);
  }
}

/* 操作数栈的峰值与容量。
 *
 * 为什么量它（2026-11-01）：board-spec 那七行程序在板子上的 heap 是 64524，
 * 而其中 59136 全来自操作数栈那一次扩容到一千零二十四项的 realloc。
 * 于是要回答一个问题：那七行程序真的需要一千多个槽，还是初始容量太小、翻倍太粗。
 * 峰值是前一半的答案，容量是后一半 —— 两个数并排一看就知道。
 */
static 线程局部 uint32_t g_操作数峰值 = 0;

size_t hmyr_操作数峰值(void) { return (size_t)g_操作数峰值; }
size_t hmyr_操作数容量(void) { return (size_t)g_机->stack_cap; }

/* sizeof，给板子读（2026-11-01）。
 *
 * 为什么量它：自编译在板子上差六万七，而回收收不回来（第三十九节）——
 * 那就只剩「压表示」这一条，而压之前要知道每个值多大。
 * Value 五十六字节是这一份一直以来的事实，但它是推算出来的，不是读出来的。
 *
 * 只留 Value 这一个：索引 与 帧记录 的定义都在这段代码之后，sizeof 它们
 * 会撞上「不完整类型」—— 真要量它们，把函数挪到定义之后。 */
size_t hmyr_值字节(void) { return sizeof(Value); }

static void push(Value v) {
  if (g_机->stack_n == g_机->stack_cap) {
    /* 初始容量看平台：桌面上 256 一次到位，板子上 64。
     *
     * 为什么板子要小：Value 是五十六字节，256 个就是 14336 字节 —— 而板子在
     * 装完五份自举层之后只剩八 KB 上下。第一次 push 就要那一块，于是装载明明
     * 成功了，程序却在第一条指令处停下（2026-10-30 的读数：want 14336）。
     * 64 个是 3584 字节，够跑起来；真需要更深时下面的翻倍照旧，而那一步在
     * 板子上会短暂要「新旧两份」，所以起点小一些反而更容易过。 */
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
    g_机->stack_cap = g_机->stack_cap ? g_机->stack_cap * 2 : 64;
#else
    g_机->stack_cap = g_机->stack_cap ? g_机->stack_cap * 2 : 256;
#endif
    g_机->stack = (Value *)realloc(g_机->stack, g_机->stack_cap * sizeof(Value));
    if (!g_机->stack) { 分配失败(); }
  }
  g_机->stack[g_机->stack_n++] = v;
  if (g_机->stack_n > g_操作数峰值) g_操作数峰值 = g_机->stack_n;
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

static 线程局部 int g_failed = 0;
static 线程局部 char g_fail_msg[512];

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
static 线程局部 int64_t g_last_field = -1;

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
/* 一帧里最多登记这么多个 owned 持有格。超出的话不登记（那一格就退回到「要自己关」）。
 * 32 是这一层愿意付的上界：登记表是栈上的固定数组，不分配 —— 这条路径不该为它分配。 */
#define 帧持有格上限 32

typedef struct 帧记录 {
  Value *slots;
  uint32_t 槽数;
  struct 帧记录 *上;
  /* 槽数组是从堆上取的（GC 的块），还是这一帧栈上的那一块。
   * 根扫描要分开走：堆上的标它自己，栈上的标它里面的值 —— 混着来会去查一张
   * 栈地址不在其中的表，那是一次访问违规，而它只在递归深、刚好走到 GC 时才现形。 */
  int 槽在堆;
  /* 作用域结束释放（design/MEMORY.txt 第 2 节）：这一帧里建的持有格，栈退出时一律关掉。
   * 交出去的会在「放」那一步从这里移走 —— 转移的第二层意思。
   *
   * 2026-11-01 起按需分配：这里以前是内嵌的 Value[32]，而 Value 是五十六字节 ——
   * 每一帧固定一千七百九十二字节。板子上帧池一开就是三十二帧，光这一项五万七，
   * 而规范程序根本不碰 owned。改成指针之后，不用它的程序一个字节也不付。
   * 这是「规范不是扩展」这条边界在数据结构上的落点（design/BOARD.txt 第二十八节）。 */
  Value *持有格们;
  uint32_t 持有格数;
} 帧记录;


#if 0
/* 2026-11-01：这两个桩停用，板子上也要回收。
 *
 * 原地的理由是「板子上不编回收」—— 而它让每一次分配都只增不减：
 * 六份自编译一段新程序要一四六八三〇字节，而板子只给 79552（design/BOARD.txt
 * 第三十九节）。而板子上的 malloc/free 早在第五百五十四行就映射到
 * hm_malloc/hm_free/realloc，所以下面那一份在裸机上照样编得过、跑得动。 */
static void *gc_分配(size_t 字节, int 种类) { (void)字节; (void)种类; return NULL; }
static uint16_t *gc_串分配(size_t 码元数) { (void)码元数; return NULL; }
#else
/* 这三个只在桌面那一支里用：板子上不编回收，也就没有账可记。 */
static size_t g_gc字节 = 0, g_gc数 = 0, g_gc阈值 = 32 * 1024 * 1024;
static int g_gc日志 = 0;

/* 板子上开回收（2026-11-01）。
 *
 * 裸机没有 getenv，所以回收的那一档设置到不了这里 —— 由板侧直接说：开，阈值多少。
 * 阈值必须小：桌面默认三十二兆，而板子的堆只有八万字节，用那个数等于永不回收。 */
void hmyr_开回收(size_t 阈值) {
  g_gc开 = 1;
  g_gc阈值 = 阈值 ? 阈值 : (size_t)48 * 1024;
  g_gc日志 = 0;
}
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

/* 按种类记数：gc_分配 本来就有种类这个参数（0 值槽、1 字符串、2 索引项、3 索引），
 * 所以「谁在要那些 24 到 31 字节的块」不需要再编一套编号 —— 现成的分类就够。
 *
 * 这一组存在的理由与行号那一组相同：光知道「GC 块少了 22 个」不能解释
 * 「24 到 31 那一档少了 51 次」，而按种类分开之后，两边的差会落到某一类上。 */
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
  if (种类 >= 0 && 种类 < 4) {
    g_种次[种类]++;
    g_种字节[种类] += 字节;
    /* 这一块的总大小是头加载荷 —— 与 hm_malloc 那一次拿到的 n 完全一样。
     * 记的是那个和，因为档是按它们分的。 */
    {
      size_t 总 = sizeof(Gc块) + 字节;
      size_t 档2 = 总 / 8;
      if (档2 >= 24) 档2 = 23;
      if (g_记直方) g_种档[种类][档2]++;
    }
  }
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
    /* 堆上的槽数组是 alloc_values 的块，要标它自己 —— 只标槽里的值会让清扫把它收掉。
     * 栈上的那一块不在块表里：标它里面的每个值，别去查表（查了就是访问违规）。 */
    if (f->槽在堆) {
      gc_压标(gc_查(f->slots));
    } else {
      for (uint32_t i = 0; i < f->槽数; i++) gc_标值(f->slots[i]);
    }
  }
  /* 指令里的常量值不再需要标：2026-10-28 起装载不把 Ins 数组建出来，于是那些
   * 值不在这台机器的堆上 —— 它们留在字节流里，执行到 CONST 时现场解。
   *
   * 代价写在这里，免得下一个人去找：字符串常量仍然进名字池（池是整份文件共享的），
   * 而元组与记录常量会每次执行 CONST 都解一次。空元组走 0x00（这门语言里它就是
   * 「没有值」），所以不分配；非空的元组常量在这里会每执行一次泄漏一份。
   * 现有语料里没有那种常量，所以这一条先这样 —— 若哪天有了，要加一张常量表
   * （偏移 → 值），而不是回到 Ins 数组。 */
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
    /* nil 与空元组在这门语言里是同一个东西（design/MEMORY.txt 第 2 节），
     * 所以它写成 [] —— 与自举层那一台一致，也与这一台对空元组的写法一致。
     * 早先这里写 "nil"，于是同一个值在四台上写法不同，而那种差异只会在
     * 拼字符串的时候冒出来。 */
    uint16_t *p = 串存(2);
    p[0] = '['; p[1] = ']';
    *out = v_str(p, 2);
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

/* ---- 全局：顶层 const 的落地 ----
 *
 * 数量很少（一个模块几条常量），所以用线性数组加名字比较，不做哈希。
 * 名字指向常量池，而池在程序生命周期里不释放 —— 所以这里存指针是安全的。
 *
 * 只有一条指令写它：SETGLOBAL，而那条指令只由顶层段发出。用户代码的赋值
 * （ASSIGN）只碰槽，所以这一份没有打开「全局可变」这件事。 */
typedef struct {
  const uint16_t *名;
  uint32_t 名长;
  Value 值;
} 全局项;

static 全局项 *g_全局项 = NULL;
static int g_全局数 = 0, g_全局容 = 0;

static void 全局放(const uint16_t *名, uint32_t 名长, Value 值) {
  for (int i = 0; i < g_全局数; i++) {
    if (g_全局项[i].名长 != 名长) continue;
    uint32_t 同 = 1;
    for (uint32_t k = 0; k < 名长; k++) if (g_全局项[i].名[k] != 名[k]) { 同 = 0; break; }
    if (同) { g_全局项[i].值 = 值; return; }
  }
  if (g_全局数 + 1 > g_全局容) {
    g_全局容 = g_全局容 ? g_全局容 * 2 : 16;
    g_全局项 = (全局项 *)realloc(g_全局项, sizeof(全局项) * (size_t)g_全局容);
    if (!g_全局项) { 分配失败(); }
  }
  g_全局项[g_全局数].名 = 名;
  g_全局项[g_全局数].名长 = 名长;
  g_全局项[g_全局数].值 = 值;
  g_全局数++;
}

static int 全局取(const uint16_t *名, uint32_t 名长, Value *出) {
  for (int i = 0; i < g_全局数; i++) {
    if (g_全局项[i].名长 != 名长) continue;
    uint32_t 同 = 1;
    for (uint32_t k = 0; k < 名长; k++) if (g_全局项[i].名[k] != 名[k]) { 同 = 0; break; }
    if (同) { *出 = g_全局项[i].值; return 1; }
  }
  return 0;
}

/* 按名字找函数，交回它在表里的位置；找不到交回 -1。
 * 交回位置而不是指针，是因为调用序列要跨机器对齐，而函数名多是中文 ——
 * 两台机器都打「第几个」，那个数字是共同的。 */
static int64_t find_func_index(uint32_t 名off) {
  uint32_t 长 = 名长(名off);
  for (uint32_t i = 0; i < g_机->函数数; i++) {
    if (g_机->函数们[i].name_len != 长) continue;
    uint32_t same = 1;
    for (uint32_t k = 0; k < 长; k++) {
      if (名码(g_机->函数们[i].name_off, k) != 名码(名off, k)) { same = 0; break; }
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

/* 一个函数声明过某个效果没有。效果名按 UTF-16 码元比 ——
 * 参数现在是「字节流里的偏移」，与 Func.effect_offs 装的是同一种东西。 */
static int has_effect(Func *f, uint32_t 名off, uint32_t 长) {
  for (uint32_t i = 0; i < f->neffects; i++) {
    if (f->effect_lens[i] != 长) continue;
    uint32_t same = 1;
    for (uint32_t k = 0; k < 长; k++) if (名码(f->effect_offs[i], k) != 名码(名off, k)) { same = 0; break; }
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
static 线程局部 int g_compile_quiet = 0;

/* 诊断缓冲：从栈上移到线程局部静态（2026-11-01，显式帧的第二步）。
 *
 * 为什么：run_func 的栈帧里这些数组加起来约一千四百字节，而板子上十六层就是两万多。
 * 它们只在出错那一条路上用，而那时机器马上就要停 —— 所以不值得每层各备一份。
 * 线程局部：多线程各一份，互不影响（与 记深度 那些计数同一种做法）。
 * 位置放在这里而不是 run_func 旁边：装载那一段（read_value 与 跑函数 之前）也要用 m，
 * 而它在这条线更前面。 */
static 线程局部 char g_诊m[520];   /* 各类 m[]：最大的一处是 512 */
static 线程局部 char g_诊n[64];    /* 名[] */
static 线程局部 char g_诊f[64];    /* 函名[]、fname[]、bn[] */
static 线程局部 char g_诊g[64];    /* 效[] */
static 线程局部 char g_诊s[288];   /* msg[]：最大的一处是 256 */

static Value run_func(Func *f, Value *args, int nargs);

/* Builtins. Each returns 1 on success and stores into *out; 0 means "not a
 * builtin I know", and the failure is already recorded. */
/* ---- 区：三区模型在 C 这一台的记账 ----
 *
 * 表示与另外两台同构：区是一条索引，块也是一条索引。内部键用 ASCII —— 而程序可见的
 * 是三个字段（zone / size / live）与五个方法；内部键不是契约（自举层与字节码那台
 * 用中文键，这一台用 ASCII）。三台的可观察行为相同就够了。
 *
 * 为什么索引而不是记录：记录不可变，而 close 要改状态 —— 那是这件事的全部理由。 */

static uint32_t 宽化(const char *s, uint16_t *buf, uint32_t cap) {
  uint32_t i = 0;
  while (s[i] && i + 1 < cap) { buf[i] = (uint16_t)(unsigned char)s[i]; i++; }
  buf[i] = 0;
  return i;
}

static void 区放键(索引 *t, const char *键, Value 值) {
  uint16_t b[32];
  索引放(t, b, 宽化(键, b, 32), 值);
}

static int 区取键(索引 *t, const char *键, Value *out) {
  uint16_t b[32];
  int 处 = 索引找(t, b, 宽化(键, b, 32));
  if (处 < 0) return 0;
  *out = t->项[处].值;
  return 1;
}

/* 一个 T_STR 是不是那串 ASCII。 */
static int 串是字(Value v, const char *字) {  uint32_t n = 0;
  if (v.tag != T_STR || !v.s) return 0;
  while (字[n]) n++;
  if (v.slen != n) return 0;
  for (uint32_t i = 0; i < n; i++) if (v.s[i] != (uint16_t)(unsigned char)字[i]) return 0;
  return 1;
}

/* 池里那段方法名是不是那串 ASCII。 */
static int 名是字(const uint16_t *p, uint32_t n, const char *字) {
  uint32_t m = 0;
  while (字[m]) m++;
  if (n != m || !p) return 0;
  for (uint32_t i = 0; i < n; i++) if (p[i] != (uint16_t)(unsigned char)字[i]) return 0;
  return 1;
}

static Value 区新建(void) {
  Value v = v_null();
  v.tag = T_INDEX;
  v.idx = 索引造();
  区放键(v.idx, "kind", ascii_text("zone"));
  区放键(v.idx, "closed", v_num(0));
  区放键(v.idx, "next", v_num(1));
  区放键(v.idx, "alive", v_num(0));
  return v;
}

/* 方法名是中文（存 / 取 / 放 / 有 / 关），而 名是字 只比 ASCII —— 所以这些按码点比。
 * 存 = U+5B58，取 = U+53D6，放 = U+653E，有 = U+6709，关 = U+5173。 */
static int 是存(const uint16_t *p, uint32_t n) { return n == 1 && p && p[0] == 0x5B58; }
static int 是取(const uint16_t *p, uint32_t n) { return n == 1 && p && p[0] == 0x53D6; }
static int 是放(const uint16_t *p, uint32_t n) { return n == 1 && p && p[0] == 0x653E; }
static int 是有字(const uint16_t *p, uint32_t n) { return n == 1 && p && p[0] == 0x6709; }
static int 是关字(const uint16_t *p, uint32_t n) { return n == 1 && p && p[0] == 0x5173; }

/* 一个持有格：只装零个或一个值（design/MEMORY.txt 第 2 节）。
 * 内部键用 ASCII —— 与这一台其他内部键同一条规矩。 */
static Value 持有格新建(void) {
  Value v = v_null();
  v.tag = T_INDEX;
  v.idx = 索引造();
  区放键(v.idx, "kind", ascii_text("owner"));
  区放键(v.idx, "holds", v_num(0));
  区放键(v.idx, "closed", v_num(0));
  return v;
}

/* 把这一帧登记的持有格一个不留地关掉（design/MEMORY.txt 第 2 节）。
 * 已经关了的不再碰 —— 外面显式关过是正常的。 */
static void 关本帧持有格(帧记录 *帧) {
  if (!帧->持有格们) { 帧->持有格数 = 0; return; }
  for (uint32_t i = 0; i < 帧->持有格数; i++) {
    Value 格 = 帧->持有格们[i];
    if (格.tag != T_INDEX || !格.idx) continue;
    Value 关值;
    if (区取键(格.idx, "closed", &关值) && 关值.tag == T_NUM && 关值.num != 0) continue;
    区放键(格.idx, "holds", v_num(0));
    区放键(格.idx, "val", v_null());
    区放键(格.idx, "closed", v_num(1));
  }
  帧->持有格数 = 0;
}

/* 从当前帧的登记表里移走一条（交出去的时候用）。 */
static void 移出本帧持有格(Value 格) {
  帧记录 *帧 = g_机->帧链;
  if (!帧 || !帧->持有格们) return;
  for (uint32_t i = 0; i < 帧->持有格数; i++) {
    Value 候选 = 帧->持有格们[i];
    if (候选.tag == T_INDEX && 候选.idx && 格.tag == T_INDEX && 候选.idx == 格.idx) {
      for (uint32_t k = i; k + 1 < 帧->持有格数; k++) 帧->持有格们[k] = 帧->持有格们[k + 1];
      帧->持有格数--;
      return;
    }
  }
}

/* 区与块上的方法。交回 1 表示 out 可以用，0 表示已经 fail 过。 */
static int 调区方法(Value 主, const uint16_t *名, uint32_t 名长, Value *args, int nargs, Value *out) {
  Value 类;
  /* 块上的方法：存与取。块的上下文只有它自己，所以这两支必须挂在块上。 */
  if (主.tag == T_INDEX && 主.idx && 区取键(主.idx, "kind", &类) && 串是字(类, "block")) {
    Value 容量值, 格;
    double 容量 = 0;
    if (!区取键(主.idx, "size", &容量值) || 容量值.tag != T_NUM) 容量 = 0;
    else 容量 = 容量值.num;
    if (!区取键(主.idx, "slots", &格) || 格.tag != T_INDEX || !格.idx) {
      fail("HMYR-行-010", "this block has no slots");
      return 0;
    }
    if (是存(名, 名长)) {
      char 键[24];
      if (nargs != 2) { fail("HMYR-行-002", "存 wants (slot, value)"); return 0; }
      if (args[0].tag != T_NUM || args[0].num < 0 || args[0].num >= 容量) {
        fail("HMYR-行-018", "that slot is outside this block");
        return 0;
      }
      snprintf(键, sizeof 键, "s%.0f", args[0].num);
      区放键(格.idx, 键, args[1]);
      *out = 主;
      return 1;
    }
    if (是取(名, 名长)) {
      char 键[24];
      if (nargs != 1) { fail("HMYR-行-002", "取 wants (slot)"); return 0; }
      if (args[0].tag != T_NUM || args[0].num < 0 || args[0].num >= 容量) {
        fail("HMYR-行-018", "that slot is outside this block");
        return 0;
      }
      snprintf(键, sizeof 键, "s%.0f", args[0].num);
      if (!区取键(格.idx, 键, out)) *out = v_null();
      return 1;
    }
    fail("HMYR-碼-002", "there is no such method on a block");
    return 0;
  }
  /* 持有格上的四个动作（owned）。取出即转移：取走之后 holds 变回 0。 */
  if (主.tag == T_INDEX && 主.idx && 区取键(主.idx, "kind", &类) && 串是字(类, "owner")) {
    Value 关值, 装值;
    int 关了 = 0;
    if (区取键(主.idx, "closed", &关值) && 关值.tag == T_NUM && 关值.num != 0) 关了 = 1;
    if (是放(名, 名长)) {
      if (nargs != 1) { fail("HMYR-行-002", "放 wants one value"); return 0; }
      if (关了) { fail("HMYR-碼-005", "owned.放: this holder is already closed"); return 0; }
      if (区取键(主.idx, "holds", &装值) && 装值.tag == T_NUM && 装值.num != 0) {
        fail("HMYR-碼-005", "owned.放: this holder already owns a value; take it out first");
        return 0;
      }
      区放键(主.idx, "val", args[0]);
      区放键(主.idx, "holds", v_num(1));
      /* 放进去的若是一条持有格，它就从本帧的登记表里移走 ——
       * 「转移」的第二层意思，与另三台同形（design/MEMORY.txt 第 2 节）。 */
      移出本帧持有格(args[0]);
      *out = 主;
      return 1;
    }
    if (是取(名, 名长)) {
      if (nargs != 0) { fail("HMYR-行-002", "取 wants no arguments"); return 0; }
      if (关了) { fail("HMYR-碼-005", "owned.取: this holder is already closed"); return 0; }
      if (!区取键(主.idx, "holds", &装值) || 装值.tag != T_NUM || 装值.num == 0) {
        fail("HMYR-碼-006", "owned.取: this holder is empty");
        return 0;
      }
      if (!区取键(主.idx, "val", out)) *out = v_null();
      区放键(主.idx, "holds", v_num(0));
      return 1;
    }
    if (是有字(名, 名长)) {
      *out = v_num(0);
      if (区取键(主.idx, "holds", &装值) && 装值.tag == T_NUM) *out = 装值;
      return 1;
    }
    if (是关字(名, 名长)) {
      区放键(主.idx, "holds", v_num(0));
      区放键(主.idx, "closed", v_num(1));
      *out = v_null();
      return 1;
    }
    fail("HMYR-碼-002", "there is no such method on an owned holder");
    return 0;
  }
  if (主.tag != T_INDEX || !主.idx || !区取键(主.idx, "kind", &类) || !串是字(类, "zone")) {
    fail("HMYR-碼-002", "this machine only accepts method calls on a zone or a block");
    return 0;
  }
  if (名是字(名, 名长, "held")) {
    Value 活;
    if (!区取键(主.idx, "alive", &活)) 活 = v_num(0);
    *out = 活;
    return 1;
  }
  if (名是字(名, 名长, "alloc")) {
    Value 关, 下一个, 活;
    if (nargs != 1) { fail("HMYR-行-002", "arena.alloc wants one argument"); return 0; }
    if (!区取键(主.idx, "closed", &关) || 关.tag != T_NUM || 关.num != 0) {
      fail("HMYR-碼-002", "arena.alloc: that arena is already closed");
      return 0;
    }
    if (!区取键(主.idx, "next", &下一个)) 下一个 = v_num(1);
    {
      double 号 = 下一个.num;
      char 键[16];
      Value 块 = v_null();
      块.tag = T_INDEX;
      块.idx = 索引造();
      区放键(块.idx, "kind", ascii_text("block"));
      区放键(块.idx, "zone", ascii_text("arena"));
      区放键(块.idx, "size", args[0]);
      区放键(块.idx, "live", v_num(1));
      区放键(块.idx, "id", v_num(号));
      /* 块的格子：按下标的可变内容。没有它块只有大小，于是「把值放进区里」写不出来。 */
      {
        Value 格 = v_null();
        格.tag = T_INDEX;
        格.idx = 索引造();
        区放键(块.idx, "slots", 格);
      }
      snprintf(键, sizeof 键, "b%.0f", 号);
      区放键(主.idx, 键, 块);
      区放键(主.idx, "next", v_num(号 + 1));
      if (!区取键(主.idx, "alive", &活)) 活 = v_num(0);
      区放键(主.idx, "alive", v_num(活.num + 1));
      *out = 块;
      return 1;
    }
  }
  if (名是字(名, 名长, "close")) {
    /* 交出去的那些归托管，close 不带它们走 —— 那正是 freeze 的全部意义。 */
    Value 下一个;
    int 总 = 1;
    if (区取键(主.idx, "next", &下一个)) 总 = (int)下一个.num;
    for (int i = 1; i < 总; i++) {
      char 键[16];
      Value 块, zone;
      snprintf(键, sizeof 键, "b%d", i);
      if (!区取键(主.idx, 键, &块) || 块.tag != T_INDEX || !块.idx) continue;
      if (区取键(块.idx, "zone", &zone) && 串是字(zone, "arena")) 区放键(块.idx, "live", v_num(0));
    }
    区放键(主.idx, "closed", v_num(1));
    区放键(主.idx, "alive", v_num(0));
    *out = v_num(0);
    return 1;
  }
  if (名是字(名, 名长, "freeze") || 名是字(名, 名长, "adopt")) {
    int 是交出 = 名是字(名, 名长, "freeze");
    Value 关, 块, zone, 活;
    if (nargs != 1) { fail("HMYR-行-002", 是交出 ? "arena.freeze wants one argument" : "arena.adopt wants one argument"); return 0; }
    if (!区取键(主.idx, "closed", &关) || 关.tag != T_NUM || 关.num != 0) {
      fail("HMYR-碼-002", 是交出 ? "arena.freeze: that arena is already closed" : "arena.adopt: that arena is already closed");
      return 0;
    }
    块 = args[0];
    if (块.tag != T_INDEX || !块.idx || !区取键(块.idx, "zone", &zone)) {
      fail(是交出 ? "HMYR-碼-002" : "HMYR-碼-003",
           是交出 ? "arena.freeze was given a block this arena does not own"
                  : "arena.adopt: that block was not handed to the managed zone");
      return 0;
    }
    if (是交出 && !串是字(zone, "arena")) {
      fail("HMYR-碼-002", "arena.freeze was given a block this arena does not own");
      return 0;
    }
    if (!是交出 && !串是字(zone, "managed")) {
      fail("HMYR-碼-003", "arena.adopt: that block was not handed to the managed zone");
      return 0;
    }
    区放键(块.idx, "zone", ascii_text(是交出 ? "managed" : "arena"));
    区放键(块.idx, "live", v_num(1));
    if (!区取键(主.idx, "alive", &活)) 活 = v_num(0);
    区放键(主.idx, "alive", v_num(活.num + (是交出 ? -1 : 1)));
    *out = 块;
    return 1;
  }
  fail("HMYR-碼-002", "there is no such method on a zone");
  return 0;
}

static int call_builtin(uint32_t 名off, Value *args, int nargs, Value *out) {
  if (name_is(名off, "print") || name_is(名off, "print_err")) {
    /* 编译那一段的 print 改道到标准错误：启动器编源码时种子会打印「N 个字节」，
     * 那不该落在用户程序的输出里。改道而不是丢弃 —— 编译失败时那几行就是诊断。 */
    FILE *to = (name_is(名off, "print") && !g_compile_quiet) ? stdout : stderr;
    for (int i = 0; i < nargs; i++) {
      Value t;
      value_to_text(args[i], &t);
      write_utf8(t.s, t.slen, to);
    }
    *out = v_null();
    return 1;
  }
  if (name_is(名off, "str")) {
    if (nargs != 1) { fail("HMYR-行-002", "str wants one argument"); return 1; }
    value_to_text(args[0], out);
    return 1;
  }
  // 32 位位运算：与 JS 那三份同一套语义（无符号 32 位，移位按 31 取模）。
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x4E0E}, 2)) {      /* 位与 */
    if (nargs != 2) { fail("HMYR-行-020", "位与 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num & (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x6216}, 2)) {      /* 位或 */
    if (nargs != 2) { fail("HMYR-行-020", "位或 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num | (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x5F02, 0x6216}, 3)) { /* 位异或 */
    if (nargs != 2) { fail("HMYR-行-020", "位异或 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num ^ (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x975E}, 2)) {      /* 位非 */
    if (nargs != 1) { fail("HMYR-行-020", "位非 wants one argument"); return 1; }
    *out = v_num((double)(uint32_t)(~(uint32_t)args[0].num));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x53F3, 0x79FB}, 3)) { /* 位右移 */
    if (nargs != 2) { fail("HMYR-行-020", "位右移 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num >> ((uint32_t)args[1].num & 31u)));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x52A0}, 2)) {      /* 位加 */
    if (nargs != 2) { fail("HMYR-行-020", "位加 wants two arguments"); return 1; }
    *out = v_num((double)(uint32_t)((uint32_t)args[0].num + (uint32_t)args[1].num));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x5FAA, 0x73AF, 0x53F3, 0x79FB}, 5)) { /* 位循环右移 */
    if (nargs != 2) { fail("HMYR-行-020", "位循环右移 wants two arguments"); return 1; }
    uint32_t x = (uint32_t)args[0].num, n = (uint32_t)args[1].num & 31u;
    *out = v_num((double)(n == 0 ? x : ((x >> n) | (x << (32 - n)))));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x4F4D, 0x5FAA, 0x73AF, 0x5DE6, 0x79FB}, 5)) { /* 位循环左移 */
    if (nargs != 2) { fail("HMYR-行-020", "位循环左移 wants two arguments"); return 1; }
    uint32_t x = (uint32_t)args[0].num, n = (uint32_t)args[1].num & 31u;
    *out = v_num((double)(n == 0 ? x : ((x << n) | (x >> (32 - n)))));
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x6570, 0x7EC4}, 2)) {
    if (nargs != 1) { fail("HMYR-行-017", "数组 wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE) { fail("HMYR-行-017", "数组 wants a tuple"); return 1; }
    Value v = v_null(); v.tag = T_ARRAY; v.ilen = args[0].ilen;
    v.items = alloc_values(v.ilen);
    for (uint32_t i = 0; i < v.ilen; i++) v.items[i] = args[0].items[i];
    *out = v;
    return 1;
  }
  if (name_is16(名off, (const uint16_t[]){0x8BBE}, 1)) {
    if (nargs != 3) { fail("HMYR-行-018", "设 wants three arguments"); return 1; }
    if (args[0].tag != T_ARRAY) { fail("HMYR-行-018", "设 wants an array built by 数组"); return 1; }
    int64_t i = (int64_t)args[1].num;
    if (i < 0 || i >= (int64_t)args[0].ilen) { fail("HMYR-行-019", "index outside the array"); return 1; }
    args[0].items[i] = args[2];
    *out = args[0];
    return 1;
  }
  if (name_is(名off, "len")) {
    if (nargs != 1) { fail("HMYR-行-002", "len wants one argument"); return 1; }
    if (args[0].tag == T_STR) { *out = v_num((double)args[0].slen); return 1; }
    if (args[0].tag == T_TUPLE || args[0].tag == T_ARRAY) { *out = v_num((double)args[0].ilen); return 1; }
    fail("HMYR-行-008", "len wants a string or a tuple");
    return 1;
  }
  if (name_is(名off, "chr")) {
    if (nargs != 1) { fail("HMYR-行-002", "chr wants one argument"); return 1; }
    int ok = 0; double cp = as_num(args[0], &ok);
    if (!ok) { fail("HMYR-行-013", "chr wants a number"); return 1; }
    long long 码 = (long long)floor(cp);
    if (码 < 0 || 码 > 0x10FFFF) { fail("HMYR-內-007", "not a code point"); return 1; }
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
  if (name_is(名off, "ord")) {
    if (nargs != 1) { fail("HMYR-行-002", "ord wants one argument"); return 1; }
    if (args[0].tag != T_STR || args[0].slen == 0) { fail("HMYR-內-006", "ord of an empty string"); return 1; }
    /* 一个「字符」是一个码点，不是一个单元：基本平面之外的字符要连着它后面
     * 那个低位代理一起读。JS 那三台用的都是 codePointAt(0)，这里跟上它。 */
    uint32_t cp = 0;
    cp_at(args[0].s, args[0].slen, 0, &cp);
    *out = v_num((double)cp);
    return 1;
  }
  if (name_is(名off, "to_int")) {
    if (nargs != 1) { fail("HMYR-行-002", "to_int wants one argument"); return 1; }
    if (args[0].tag == T_NUM) { *out = args[0]; return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "to_int wants a number or a string"); return 1; }
    /* decimal only: digits with an optional leading minus */
    uint32_t i = 0; int neg = 0; long long v = 0; int any = 0;
    if (i < args[0].slen && args[0].s[i] == '-') { neg = 1; i++; }
    for (; i < args[0].slen; i++) {
      uint16_t ch = args[0].s[i];
      if (ch < '0' || ch > '9') { fail("HMYR-行-013", "to_int wants a decimal integer"); return 1; }
      v = v * 10 + (ch - '0');
      any = 1;
    }
    if (!any) { fail("HMYR-行-013", "to_int wants a decimal integer"); return 1; }
    *out = v_num((double)(neg ? -v : v));
    return 1;
  }
  /* 算术那一组：纯函数，不碰世界。两台机器对这五个该给出同一个数，
   * 所以它们进了字节码内置表 —— 以前只在宿主求值器里有，编成字节码就找不着。 */
  if (name_is(名off, "abs") || name_is(名off, "floor") || name_is(名off, "int")) {
    if (nargs != 1) { fail("HMYR-行-002", "that builtin wants one argument"); return 1; }
    int ok = 0;
    double x = as_num(args[0], &ok);
    if (!ok) { fail("HMYR-行-013", "that builtin wants a number"); return 1; }
    if (name_is(名off, "abs")) *out = v_num(x < 0 ? -x : x);
    else if (name_is(名off, "floor")) *out = v_num(floor(x));
    else *out = v_num(trunc(x));
    return 1;
  }
  if (name_is(名off, "min") || name_is(名off, "max")) {
    if (nargs < 1) { fail("HMYR-行-002", "that builtin wants at least one argument"); return 1; }
    int 取大 = name_is(名off, "max");
    double 佳 = 0;
    for (int i = 0; i < nargs; i++) {
      int ok = 0;
      double x = as_num(args[i], &ok);
      if (!ok) { fail("HMYR-行-013", "min and max want numbers"); return 1; }
      if (i == 0 || (取大 ? x > 佳 : x < 佳)) 佳 = x;
    }
    *out = v_num(佳);
    return 1;
  }
  if (name_is(名off, "slice")) {
    if (nargs != 3) { fail("HMYR-行-002", "slice wants three arguments"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "slice wants a string"); return 1; }
    int ok1 = 0, ok2 = 0;
    double a = as_num(args[1], &ok1), b = as_num(args[2], &ok2);
    if (!ok1 || !ok2) { fail("HMYR-行-013", "slice bounds must be numbers"); return 1; }
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
  if (name_is(名off, "split")) {
    if (nargs != 2) { fail("HMYR-行-002", "split wants two arguments"); return 1; }
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
  if (name_is(名off, "is_letter") || name_is(名off, "is_mark")) {
    if (nargs != 1) { fail("HMYR-行-002", "that builtin wants one argument"); return 1; }
    if (args[0].tag != T_STR || args[0].slen == 0) { *out = v_bool(0); return 1; }
    uint32_t cp = args[0].s[0];
    if (name_is(名off, "is_letter")) *out = v_bool(in_ranges(ucd_letter_ranges, ucd_letter_count, cp));
    else *out = v_bool(in_ranges(ucd_mark_ranges, ucd_mark_count, cp));
    return 1;
  }
  /* 归一化：以前这里是「把文本原样交回」，理由是真表是十七兆语料。
   * 那说的是测试语料；生成一张表只要分解、组合类、组合对三样小东西，
   * 而三样都在仓库里 —— 于是这台机器也真的归一化了。 */
  if (name_is(名off, "nfc")) {
    if (nargs != 1) { fail("HMYR-行-002", "nfc wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "nfc wants a string"); return 1; }
    *out = normalize_nfc(args[0]);
    return 1;
  }
  if (name_is(名off, "to_upper") || name_is(名off, "to_lower")) {
    if (nargs != 1) { fail("HMYR-行-002", "that builtin wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "that builtin wants a string"); return 1; }
    *out = case_fold(args[0], name_is(名off, "to_upper"));
    return 1;
  }
  /* ---- 索引 ---- */
  /* 一个按键查的东西，约定在 design/INDEX.txt。这一台以前在这里答一句具体的拒绝
   * （「键是运行时的字符串，那要一张真正的哈希表」）—— 现在做出来了，
   * 用的是排序数组加二分，理由写在 索引造 那一节的头注释里。 */
  if (name_is(名off, "index_new")) {
    if (nargs != 0) { fail("HMYR-行-002", "index_new wants no arguments"); return 1; }
    *out = v_null();
    out->tag = T_INDEX;
    out->idx = 索引造();
    return 1;
  }
  if (name_is(名off, "index_set")) {
    if (nargs != 3) { fail("HMYR-行-002", "index_set wants (index, key, value)"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-內-019", "index_set wants an index"); return 1; }
    if (args[1].tag != T_STR) { fail("HMYR-行-013", "index_set wants a string key, found "); return 1; }
    索引放(args[0].idx, args[1].s, args[1].slen, args[2]);
    /* 交回同一个索引：INDEX.txt 第一条约定，于是可以链着写。 */
    *out = args[0];
    return 1;
  }
  if (name_is(名off, "index_get")) {
    int 处;
    if (nargs != 2) { fail("HMYR-行-002", "index_get wants (index, key)"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-內-019", "index_get wants an index"); return 1; }
    if (args[1].tag != T_STR) { fail("HMYR-行-013", "index_get wants a string key"); return 1; }
    处 = 索引找(args[0].idx, args[1].s, args[1].slen);
    if (处 < 0) { fail("HMYR-內-018", "no such key in that index"); return 1; }
    *out = args[0].idx->项[处].值;
    return 1;
  }
  /* index_has 是纯函数：给错东西也交回 false，不抛 —— 问「有没有」不是失败。 */
  if (name_is(名off, "index_has")) {
    if (nargs != 2) { fail("HMYR-行-002", "index_has wants (index, key)"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx || args[1].tag != T_STR) { *out = v_bool(0); return 1; }
    *out = v_bool(索引找(args[0].idx, args[1].s, args[1].slen) >= 0);
    return 1;
  }
  if (name_is(名off, "index_len")) {
    if (nargs != 1) { fail("HMYR-行-002", "index_len wants one argument"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-內-019", "index_len wants an index"); return 1; }
    *out = v_num((double)args[0].idx->n);
    return 1;
  }
  if (name_is(名off, "index_keys")) {
    索引 *t;
    Value v;
    uint32_t *序;
    if (nargs != 1) { fail("HMYR-行-002", "index_keys wants one argument"); return 1; }
    if (args[0].tag != T_INDEX || !args[0].idx) { fail("HMYR-內-019", "index_keys wants an index"); return 1; }
    t = args[0].idx;
    v = v_null();
    v.tag = T_TUPLE;
    v.ilen = t->n;
    v.items = alloc_values(t->n ? t->n : 1);
    /* 键序是「第一次放进去的顺序」。表若被二分过，物理顺序已经不是那个了 ——
     * 所以按序号另排一份下标。插入排序够用：这一支的键数是几千这个量级。 */
    序 = (uint32_t *)hm_calloc(t->n ? t->n : 1, sizeof(uint32_t));
    if (!序) { 分配失败(); }
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
  if (name_is(名off, "record_new")) {
    if (nargs != 1) { fail("HMYR-行-002", "record_new wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE) { fail("HMYR-內-014", "record_new wants a tuple of (name, value) pairs"); return 1; }
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
        fail("HMYR-內-014", "every item must be a (name, value) pair with a string name");
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
  if (name_is(名off, "field_get") || name_is(名off, "field_has")) {
    if (nargs != 2) { fail("HMYR-行-002", "that builtin wants two arguments"); return 1; }
    if (args[0].tag != T_RECORD) {
      if (name_is(名off, "field_has")) { *out = v_bool(0); return 1; }
      fail("HMYR-內-015", "field_get wants a record");
      return 1;
    }
    if (args[1].tag != T_STR) { fail("HMYR-行-013", "a field name must be a string"); return 1; }
    for (uint32_t i = 0; i < args[0].rec.n; i++) {
      if (args[0].rec.name_lens[i] != args[1].slen) continue;
      uint32_t same = 1;
      for (uint32_t k = 0; k < args[1].slen; k++) {
        if (args[0].rec.names[i][k] != args[1].s[k]) { same = 0; break; }
      }
      if (same) {
        if (name_is(名off, "field_has")) { *out = v_bool(1); return 1; }
        *out = args[0].rec.vals[i];
        return 1;
      }
    }
    if (name_is(名off, "field_has")) { *out = v_bool(0); return 1; }
    fail("HMYR-內-016", "no field with that name on that record");
    return 1;
  }
  if (name_is(名off, "field_names")) {
    if (nargs != 1) { fail("HMYR-行-002", "field_names wants one argument"); return 1; }
    if (args[0].tag != T_RECORD) { fail("HMYR-內-017", "field_names wants a record"); return 1; }
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
  if (name_is(名off, "file_exists")) {
    if (nargs != 1) { fail("HMYR-行-002", "file_exists wants one argument"); return 1; }
    if (args[0].tag != T_STR) { *out = v_bool(0); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "rb");
    if (f) fclose(f);
    *out = v_bool(f != NULL);
    free(p);
    return 1;
  }
  /* 列目录：顺序已经由 列目录 排好，这里只把名字搬成语言的值。
   * 打不开是 HMYR-內-011（与 read_text 同一类：文件系统没给），空目录不是错。 */
  if (name_is(名off, "read_dir")) {
    if (nargs != 1) { fail("HMYR-行-002", "read_dir wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "read_dir wants a path string"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    uint32_t n = 0;
    char **名们 = 列目录(p, &n);
    free(p);
    if (!名们) { fail("HMYR-內-011", "cannot list that directory"); return 1; }
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
  if (name_is(名off, "is_dir")) {
    if (nargs != 1) { fail("HMYR-行-002", "is_dir wants one argument"); return 1; }
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
  if (name_is16(名off, (const uint16_t[]){0x6821, 0x9A8C, 0x548C}, 3)) {  /* 校验和 */
    if (nargs != 1) { fail("HMYR-行-002", "校验和 wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE && args[0].tag != T_ARRAY) { fail("HMYR-行-013", "校验和 wants a tuple of bytes"); return 1; }
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
          if (x.items[k].tag != T_NUM) { fail("HMYR-行-013", "校验和 wants bytes"); return 1; }
          uint32_t b = (uint32_t)((long long)x.items[k].num) & 0xffu;
          c = (c >> 8) ^ 校验表[(c ^ b) & 0xffu];
        }
      } else {
        if (x.tag != T_NUM) { fail("HMYR-行-013", "校验和 wants bytes"); return 1; }
        uint32_t b = (uint32_t)((long long)x.num) & 0xffu;
        c = (c >> 8) ^ 校验表[(c ^ b) & 0xffu];
      }
    }
    *out = v_num((double)(c ^ 0xFFFFFFFFu));
    return 1;
  }
  if (name_is(名off, "read_text")) {
    if (nargs < 1) { fail("HMYR-行-002", "read_text wants at least one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "read_text wants a path string"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "rb");
    if (!f) { free(p); fail("HMYR-內-011", "cannot read that file"); return 1; }
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
  if (name_is(名off, "read_bytes")) {
    if (nargs != 1) { fail("HMYR-行-002", "read_bytes wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "read_bytes wants a path string"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "rb");
    if (!f) { free(p); fail("HMYR-內-011", "cannot read that file"); return 1; }
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
  if (name_is(名off, "write_text")) {
    if (nargs != 2) { fail("HMYR-行-002", "write_text wants two arguments"); return 1; }
    if (args[0].tag != T_STR || args[1].tag != T_STR) { fail("HMYR-行-013", "write_text wants two strings"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    char *t = utf16_to_utf8(args[1].s, args[1].slen);
    FILE *f = 开文件(p, "wb");
    if (!f) { free(p); free(t); fail("HMYR-內-012", "cannot write that file"); return 1; }
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
  if (name_is(名off, "write_bytes")) {
    if (nargs != 2) { fail("HMYR-行-002", "write_bytes wants two arguments"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "write_bytes wants a path string"); return 1; }
    if (args[1].tag != T_TUPLE) { fail("HMYR-行-013", "write_bytes wants a tuple of bytes"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(p, "wb");
    free(p);
    if (!f) { fail("HMYR-內-012", "cannot write that file"); return 1; }
    /* 元素可以是字节，也可以是一块字节（语言那边按块累积，省掉平方复制）。 */
    double 写 = 0;
    for (uint32_t i = 0; i < args[1].ilen; i++) {
      Value 项 = args[1].items[i];
      if (项.tag == T_TUPLE) {
        for (uint32_t k = 0; k < 项.ilen; k++) {
          int ok = 0;
          double d = as_num(项.items[k], &ok);
          if (!ok) { fclose(f); fail("HMYR-行-013", "every byte must be a number"); return 1; }
          unsigned char b = (unsigned char)(((long long)d) & 0xff);
          fwrite(&b, 1, 1, f);
          写 += 1;
        }
      } else {
        int ok = 0;
        double d = as_num(项, &ok);
        if (!ok) { fclose(f); fail("HMYR-行-013", "every byte must be a number"); return 1; }
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
  if (name_is(名off, "pack_value")) {
    if (nargs != 1) { fail("HMYR-行-002", "pack_value wants one argument"); return 1; }
    uint8_t *段 = NULL;
    size_t 长 = 0, 容 = 0;
    int 好 = pack_value(args[0], &段, &长, &容);
    if (!好) { free(段); fail("HMYR-內-014", "cannot encode this value"); return 1; }
    Value v = v_null();
    v.tag = T_TUPLE;
    v.ilen = (uint32_t)长;
    v.items = alloc_values((uint32_t)长);
    for (uint32_t i = 0; i < (uint32_t)长; i++) v.items[i] = v_num((double)段[i]);
    free(段);
    *out = v;
    return 1;
  }
  if (name_is(名off, "f64_bytes")) {
    if (nargs != 1) { fail("HMYR-行-002", "f64_bytes wants one argument"); return 1; }
    int ok0 = 0;
    double d = as_num(args[0], &ok0);
    if (!ok0) { fail("HMYR-行-013", "f64_bytes wants a number"); return 1; }
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
  if (name_is(名off, "read_line")) {
    if (nargs != 2) { fail("HMYR-行-002", "read_line wants two arguments"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "read_line wants a path string"); return 1; }
    int ok = 0;
    double 起 = as_num(args[1], &ok);
    if (!ok) { fail("HMYR-行-013", "read_line wants a number offset"); return 1; }
    char *路 = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(路, "rb");
    free(路);
    if (!f) { fail("HMYR-內-011", "cannot read that file"); return 1; }
    if (fseek(f, (long)起, SEEK_SET) != 0) { fclose(f); fail("HMYR-內-011", "cannot seek in that file"); return 1; }
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
  if (name_is(名off, "read_stdin_line")) {
    if (nargs != 0) { fail("HMYR-行-002", "read_stdin_line takes no arguments"); return 1; }
    uint16_t *行 = NULL;
    uint32_t 行长 = 0;
    int 结束 = 1;
#if defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
    行 = 串存(1);
#else
    {
      size_t cap = 256, n = 0;
      char *buf = (char *)malloc(cap);
      if (!buf) { 分配失败(); }
      int c = 0;
      for (;;) {
        c = fgetc(stdin);
        if (c == EOF || c == '\n') break;
        if (n + 1 >= cap) {
          cap *= 2;
          buf = (char *)realloc(buf, cap);
          if (!buf) { 分配失败(); }
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
  if (name_is(名off, "read_stdin_bytes")) {
    if (nargs != 1) { fail("HMYR-行-002", "read_stdin_bytes wants one argument"); return 1; }
    {
      int ok = 0;
      double nn = as_num(args[0], &ok);
      if (!ok) { fail("HMYR-行-013", "read_stdin_bytes wants a number"); return 1; }
      long want = (long)floor(nn);
      if (want < 0) want = 0;
      size_t 得 = 0;
      int 结束 = 1;
      unsigned char *buf = (unsigned char *)malloc((size_t)(want ? want : 1));
      if (!buf) { 分配失败(); }
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
  if (name_is(名off, "bytes_to_text")) {
    if (nargs != 1) { fail("HMYR-行-002", "bytes_to_text wants one argument"); return 1; }
    if (args[0].tag != T_TUPLE) { fail("HMYR-行-013", "bytes_to_text wants a tuple of bytes"); return 1; }
    {
      uint32_t 数 = args[0].ilen;
      unsigned char *buf = (unsigned char *)malloc((size_t)(数 ? 数 : 1));
      if (!buf) { 分配失败(); }
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
  if (name_is(名off, "read_lines")) {
    if (nargs != 1) { fail("HMYR-行-002", "read_lines wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-行-013", "read_lines wants a path string"); return 1; }
    char *路 = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = 开文件(路, "rb");
    free(路);
    if (!f) { fail("HMYR-內-011", "cannot read that file"); return 1; }
    fseek(f, 0, SEEK_END);
    long 大小 = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (大小 < 0) { fclose(f); fail("HMYR-內-011", "cannot read that file"); return 1; }
    char *文 = (char *)malloc((size_t)大小 + 1);
    if (!文) { fclose(f); fail("HMYR-內-011", "cannot read that file"); return 1; }
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
  if (name_is(名off, "term_size")) {
    if (nargs != 0) { fail("HMYR-行-002", "term_size takes no arguments"); return 1; }
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
  if (name_is(名off, "term_clear")) {
    if (nargs != 0) { fail("HMYR-行-002", "term_clear takes no arguments"); return 1; }
    *out = ascii_text("\x1b[2J");
    return 1;
  }
  if (name_is(名off, "term_hide")) {
    if (nargs != 0) { fail("HMYR-行-002", "term_hide takes no arguments"); return 1; }
    *out = ascii_text("\x1b[?25l");
    return 1;
  }
  if (name_is(名off, "term_show")) {
    if (nargs != 0) { fail("HMYR-行-002", "term_show takes no arguments"); return 1; }
    *out = ascii_text("\x1b[?25h");
    return 1;
  }
  if (name_is(名off, "term_escape")) {
    if (nargs != 2) { fail("HMYR-行-002", "term_escape wants two arguments"); return 1; }
    int o1 = 0, o2 = 0;
    double r = as_num(args[0], &o1), c = as_num(args[1], &o2);
    if (!o1 || !o2) { fail("HMYR-行-013", "term_escape wants two numbers"); return 1; }
    long rr = (long)floor(r), cc = (long)floor(c);
    if (rr < 1) rr = 1;
    if (cc < 1) cc = 1;
    char buf[64];
    snprintf(buf, sizeof buf, "\x1b[%ld;%ldH", rr, cc);
    *out = ascii_text(buf);
    return 1;
  }
  if (name_is(名off, "term_color")) {
    if (nargs < 1 || nargs > 2) { fail("HMYR-行-002", "term_color wants one or two arguments"); return 1; }
    int o1 = 0;
    double fg = as_num(args[0], &o1);
    if (!o1) { fail("HMYR-行-013", "term_color wants a number"); return 1; }
    long f = (long)floor(fg);
    if (f < 0) { *out = ascii_text("\x1b[0m"); return 1; }
    long b = -1;
    if (nargs == 2) {
      int o2 = 0;
      double bg = as_num(args[1], &o2);
      if (!o2) { fail("HMYR-行-013", "term_color's second argument must be a number"); return 1; }
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
  if (name_is(名off, "now_ms")) {
    if (nargs != 0) { fail("HMYR-行-002", "now_ms takes no arguments"); return 1; }
    *out = v_num(现在毫秒());
    return 1;
  }
  if (name_is(名off, "sleep_ms")) {
    if (nargs != 1) { fail("HMYR-行-002", "sleep_ms wants one argument"); return 1; }
    int o1 = 0;
    double ms = as_num(args[0], &o1);
    if (!o1) { fail("HMYR-行-013", "sleep_ms wants a number"); return 1; }
    long m = (long)floor(ms);
    if (m < 0) m = 0;
    睡多久(m);
    *out = v_num((double)m);
    return 1;
  }
  /* ---- 环境与路径：读这台机器在哪儿 ---------------------------------- */
  if (name_is(名off, "cwd")) {
    if (nargs != 0) { fail("HMYR-行-002", "cwd takes no arguments"); return 1; }
    char *p = 现在工作在();
    *out = 路径值(p);
    free(p);
    return 1;
  }
  if (name_is(名off, "home_dir")) {
    if (nargs != 0) { fail("HMYR-行-002", "home_dir takes no arguments"); return 1; }
    const char *h = 环境("USERPROFILE");
    if (!*h) h = 环境("HOME");
    *out = 路径值(h);
    return 1;
  }
  if (name_is(名off, "temp_path")) {
    if (nargs != 1) { fail("HMYR-行-002", "temp_path wants one argument"); return 1; }
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
  if (name_is(名off, "repo_path")) {
    if (nargs != 1) { fail("HMYR-行-002", "repo_path wants one argument"); return 1; }
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
  if (name_is(名off, "python_path")) {
    if (nargs != 0) { fail("HMYR-行-002", "python_path takes no arguments"); return 1; }
    const char *p = 环境("HMYR_PYTHON");
    *out = ascii_text(*p ? p : "python");
    return 1;
  }
  if (name_is(名off, "locale_current")) {
    if (nargs != 0) { fail("HMYR-行-002", "locale_current takes no arguments"); return 1; }
    *out = ascii_text(g_locale);
    return 1;
  }
  if (name_is(名off, "locale_set")) {
    if (nargs != 1) { fail("HMYR-行-002", "locale_set wants one argument"); return 1; }
    Value 名;
    value_to_text(args[0], &名);
    char *文 = utf16_to_utf8(名.s, 名.slen);
    int 认 = 0;
    for (size_t i = 0; i < sizeof locale_名字们 / sizeof *locale_名字们; i++) {
      if (文 && strcmp(文, locale_名字们[i]) == 0) { 认 = 1; break; }
    }
    if (!认) {
      char *m = g_诊m;
      snprintf(m, sizeof g_诊m,
               "no such locale profile: '%s' (have: zh-CN.gbk, zh-CN.utf8, ja-JP.shift_jis, en-US.utf8)",
               文 ? 文 : "");
      free(文);
      fail("HMYR-內-005", m);
      return 1;
    }
    snprintf(g_locale, sizeof g_locale, "%s", 文);
    *out = ascii_text(g_locale);
    free(文);
    return 1;
  }
  if (name_is(名off, "locale_env")) {
    if (nargs != 0) { fail("HMYR-行-002", "locale_env takes no arguments"); return 1; }
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
  if (name_is(名off, "console_codepage")) {
    if (nargs != 0) { fail("HMYR-行-002", "console_codepage takes no arguments"); return 1; }
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
  if (name_is(名off, "key_push")) {
    if (nargs != 1) { fail("HMYR-行-002", "key_push wants one argument"); return 1; }
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
  if (name_is(名off, "key_available")) {
    if (nargs != 0) { fail("HMYR-行-002", "key_available takes no arguments"); return 1; }
    *out = v_bool(g_机->键数 > 0);
    return 1;
  }
  if (name_is(名off, "key_read")) {
    if (nargs != 0) { fail("HMYR-行-002", "key_read takes no arguments"); return 1; }
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
  if (name_is(名off, "key_start")) {
    if (nargs != 1) { fail("HMYR-行-002", "key_start wants one argument"); return 1; }
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
   * 成功就交回新的目录（与 JS 那侧同一条约定）；进不去报 HMYR-內-009。
   * 板子上没有目录概念，于是这一条在那里一律报进不去 ——
   * 它不装作成功，因为「换了个地方」在板子上不成立。 */
  if (name_is(名off, "chdir")) {
    if (nargs != 1) { fail("HMYR-行-002", "chdir wants one argument"); return 1; }
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
      char *m = g_诊m;
      snprintf(m, sizeof g_诊m, "cannot enter '%s'", 目标);
      free(p);
      fail("HMYR-內-009", m);
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
  if (name_is(名off, "run_program")) {
    if (nargs < 1 || nargs > 4) {
      fail("HMYR-行-002", "run_program wants one to four arguments");
      return 1;
    }
    Value 命令值;
    value_to_text(args[0], &命令值);
    char *命令 = utf16_to_utf8(命令值.s, 命令值.slen);
    if (!命令 || !*命令) {
      free(命令);
      fail("HMYR-內-013", "run_program needs a program name: an empty string names nothing");
      return 1;
    }
    char **参们 = NULL;
    int 参量 = 0;
    if (nargs >= 2 && args[1].tag == T_TUPLE) {
      参量 = (int)args[1].ilen;
      参们 = (char **)calloc((size_t)(参量 ? 参量 : 1), sizeof(char *));
      if (!参们) { 分配失败(); }
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
        fail("HMYR-行-013", "run_program's timeout must be a number");
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
  /* ---- 线程：桌面那一支真做，板子那一支如实说没有 ----------------------
   * 桌面：一个线程 = 一个独立的 Hmyr机器（线程局部的 g_机 让每个线程看到自己那一台）。
   * 板子：那台没有线程（也没有种子），所以仍是「spawn 交回 -1、join 与 cancel 报 HMYR-內-020、
   *      count 交回 0」—— 与 JS 那侧「起不来」时同一条路。
   *
   * 上下文、线程表与三个辅助函数的声明在文件头部（g_机 那一段之后），
   * 它们的定义在 run_bytecode 之后 —— 那批函数在文件更靠后的位置。 */
#if defined(_WIN32)
  if (name_is(名off, "thr_spawn")) {
    if (nargs != 2) { fail("HMYR-行-002", "thr_spawn wants (source, entry)"); return 1; }
    {
      Value s = v_null(), e = v_null();
      char *源码, *入口;
      int 号;
      value_to_text(args[0], &s);
      value_to_text(args[1], &e);
      源码 = utf16_to_utf8(s.s, s.slen);
      入口 = utf16_to_utf8(e.s, e.slen);
      号 = 线程起(源码 ? 源码 : "", 入口 ? 入口 : "");
      free(源码);
      free(入口);
      *out = v_num((double)号);
    }
    return 1;
  }
  if (name_is(名off, "thr_join")) {
    线程上下文 *c;
    int 号;
    DWORD 到;
    if (nargs < 1) { fail("HMYR-行-002", "thr_join wants (handle [, timeout_ms])"); return 1; }
    号 = (int)args[0].num;
    c = 找线程(号);
    if (!c) { fail("HMYR-內-020", "no such thread handle"); return 1; }
    到 = (nargs >= 2 && args[1].tag == T_NUM && args[1].num > 0) ? (DWORD)args[1].num : 30000;
    if (WaitForSingleObject(c->手, 到) != WAIT_OBJECT_0) {
      fail("HMYR-內-021", "the thread did not finish within that time");
      return 1;
    }
    if (c->码 == 0) {
      uint32_t 长16 = 0;
      uint16_t *u = utf8_to_utf16(c->结果, strlen(c->结果), &长16);
      *out = v_str(u, 长16);
    } else {
      /* 线程里失败：交回空串，与 JS 那一侧同一个选择 —— 失败不是这一门语言的值。
       * 但失败的理由要能看见：不写出来，症状只是「结果少了」，而那种症状要查很久。 */
      fprintf(stderr, "[thread %d failed at step %d] %s\n", c->号, c->码, c->话);
      *out = v_str(串存(1), 0);
    }
    清线程(c);
    return 1;
  }
  if (name_is(名off, "thr_cancel")) {
    线程上下文 *c;
    int 号;
    if (nargs != 1) { fail("HMYR-行-002", "thr_cancel wants one argument"); return 1; }
    号 = (int)args[0].num;
    c = 找线程(号);
    if (!c) { fail("HMYR-內-020", "no such thread handle"); return 1; }
    TerminateThread(c->手, 1);
    清线程(c);
    *out = v_num((double)号);
    return 1;
  }
  if (name_is(名off, "thr_count")) {
    int n = 0;
    for (int i = 0; i < 线程上限; i++) if (g_线程们[i] && !g_线程们[i]->完) n++;
    *out = v_num((double)n);
    return 1;
  }
#else
  if (name_is(名off, "thr_spawn")) {
    *out = v_num(-1);
    return 1;
  }
  if (name_is(名off, "thr_join") || name_is(名off, "thr_cancel")) {
    fail("HMYR-內-020", "no thread handle on this machine: this machine has no thread capability");
    return 1;
  }
  if (name_is(名off, "thr_count")) {
    *out = v_num(0);
    return 1;
  }
#endif
  /* arena：区在这一台也是真的了（2026-10-27）。交回的是一条索引；
   * 五个方法由 OP_CALLM 分派到 调区方法 —— 与另外两台同一套判词。 */
  if (name_is(名off, "arena")) {
    if (nargs != 0) { fail("HMYR-行-002", "arena takes no arguments"); return 1; }
    *out = 区新建();
    return 1;
  }
  /* FFI 的最小形状（design/FFI.txt 第四节）：一段不拷贝的窗口。
   * 用索引表示：kind = view，三个字段 src / start / len —— 与另三台同一套判词，
   * 内部键照这一台的规矩用 ASCII。 */
  if (name_is(名off, "bytes_view")) {
    if (nargs != 3) { fail("HMYR-行-002", "bytes_view wants three arguments"); return 1; }
    Value 源 = args[0];
    if (源.tag != T_TUPLE && 源.tag != T_ARRAY) {
      fail("HMYR-行-019", "bytes_view wants bytes (a tuple or an array)");
      return 1;
    }
    if (args[1].tag != T_NUM || args[2].tag != T_NUM) {
      fail("HMYR-行-002", "bytes_view wants numbers for the start and the length");
      return 1;
    }
    long 总 = (long)源.ilen, 起 = (long)args[1].num, 长 = (long)args[2].num;
    if (起 < 0 || 长 < 0 || 起 + 长 > 总) {
      fail("HMYR-行-018", "bytes_view: the range is outside the bytes");
      return 1;
    }
    Value v = v_null();
    v.tag = T_INDEX;
    v.idx = 索引造();
    区放键(v.idx, "kind", ascii_text("view"));
    区放键(v.idx, "src", 源);
    区放键(v.idx, "start", v_num((double)起));
    区放键(v.idx, "len", v_num((double)长));
    *out = v;
    return 1;
  }
  if (name_is(名off, "view_len")) {
    if (nargs != 1) { fail("HMYR-行-002", "view_len wants one argument"); return 1; }
    Value 类值, 长值;
    if (args[0].tag != T_INDEX || !区取键(args[0].idx, "kind", &类值) || !串是字(类值, "view")) {
      fail("HMYR-行-019", "view_len wants a window");
      return 1;
    }
    if (!区取键(args[0].idx, "len", &长值)) { fail("HMYR-行-019", "view_len wants a window"); return 1; }
    *out = 长值;
    return 1;
  }
  if (name_is(名off, "view_get")) {
    if (nargs != 2) { fail("HMYR-行-002", "view_get wants two arguments"); return 1; }
    Value 类值, 源值, 起值, 长值;
    if (args[0].tag != T_INDEX || !区取键(args[0].idx, "kind", &类值) || !串是字(类值, "view")) {
      fail("HMYR-行-019", "view_get wants a window");
      return 1;
    }
    if (args[1].tag != T_NUM) { fail("HMYR-行-002", "view_get wants a number"); return 1; }
    if (!区取键(args[0].idx, "src", &源值) || !区取键(args[0].idx, "start", &起值) || !区取键(args[0].idx, "len", &长值)) {
      fail("HMYR-行-019", "view_get wants a window");
      return 1;
    }
    long i = (long)args[1].num, 长 = (long)长值.num;
    if (i < 0 || i >= 长) {
      fail("HMYR-行-018", "view_get: outside the window");
      return 1;
    }
    long 位 = (long)起值.num + i;
    if (位 < 0 || 位 >= (long)源值.ilen) {
      fail("HMYR-行-018", "view_get: outside the window");
      return 1;
    }
    *out = 源值.items[位];
    return 1;
  }
  if (name_is(名off, "view_set")) {
    if (nargs != 3) { fail("HMYR-行-002", "view_set wants three arguments"); return 1; }
    Value 类值, 源值, 起值, 长值;
    if (args[0].tag != T_INDEX || !区取键(args[0].idx, "kind", &类值) || !串是字(类值, "view")) {
      fail("HMYR-行-019", "view_set wants a window");
      return 1;
    }
    if (args[1].tag != T_NUM) { fail("HMYR-行-002", "view_set wants a number"); return 1; }
    if (!区取键(args[0].idx, "src", &源值) || !区取键(args[0].idx, "start", &起值) || !区取键(args[0].idx, "len", &长值)) {
      fail("HMYR-行-019", "view_set wants a window");
      return 1;
    }
    long i = (long)args[1].num, 长 = (long)长值.num;
    if (i < 0 || i >= 长) {
      fail("HMYR-行-019", "view_set: outside the window");
      return 1;
    }
    /* 只有数组能写 —— 元组是不可变值，与另三台同一条判据、同一套码。 */
    if (源值.tag != T_ARRAY) {
      fail("HMYR-行-018", "view_set: the window was opened on bytes that cannot be written");
      return 1;
    }
    long 位 = (long)起值.num + i;
    if (位 < 0 || 位 >= (long)源值.ilen) {
      fail("HMYR-行-019", "view_set: outside the window");
      return 1;
    }
    源值.items[位] = args[2];
    *out = args[2];
    return 1;
  }
  /* fmt_number(值, 档案)：按档案格式化数字（design/LOCALES.txt 那一节）。
   * 中文按四位分组（万进位），其余按三位；小数点是句点、负号前置 —— 所以只动
   * 整数部分的分隔符。这一台也不转发，自己拼：四台各写一份，才有「四台一致」可验。 */
  if (name_is(名off, "fmt_number")) {
    if (nargs != 2) { fail("HMYR-行-002", "fmt_number wants two arguments"); return 1; }
    if (args[0].tag != T_NUM || args[1].tag != T_STR) {
      fail("HMYR-行-002", "fmt_number wants a number and a profile name");
      return 1;
    }
    static const char *前缀 = "zh-CN.";
    int 四位 = 0;
    if (args[1].slen >= 6) {
      四位 = 1;
      for (int k = 0; k < 6; k++) {
        if (args[1].s[k] != (uint16_t)(unsigned char)前缀[k]) { 四位 = 0; break; }
      }
    }
    char 文[64];
    数字成文(args[0].num, 文, sizeof 文);
    char 出[96];
    int 长 = (int)strlen(文), j = 0;
    int 负 = (长 > 0 && 文[0] == '-') ? 1 : 0;
    int 点 = 长;
    for (int k = 负; k < 长; k++) if (文[k] == '.') { 点 = k; break; }
    if (负) 出[j++] = '-';
    for (int k = 负; k < 点; k++) {
      if (k > 负 && (点 - k) % (四位 ? 4 : 3) == 0) 出[j++] = ',';
      出[j++] = 文[k];
    }
    for (int k = 点; k < 长; k++) 出[j++] = 文[k];
    出[j] = 0;
    uint16_t *p = 串存((size_t)(j ? j : 1));
    for (int k = 0; k < j; k++) p[k] = (uint16_t)(unsigned char)出[k];
    *out = v_str(p, (uint32_t)j);
    return 1;
  }
  /* owned：单一所有者的持有格（design/MEMORY.txt 第 2 节）。 */
  if (name_is(名off, "owned")) {
    if (nargs != 0) { fail("HMYR-行-002", "owned takes no arguments"); return 1; }
    Value 格 = 持有格新建();
    帧记录 *帧 = g_机->帧链;
    if (帧) {
      /* 第一次真的用 owned 时才分配这张表 —— 规范程序不走这条路，
       * 于是每个帧记录只有两个指针大（见 design/BOARD.txt 第二十八节）。 */
      if (!帧->持有格们) {
        帧->持有格们 = (Value *)calloc(帧持有格上限, sizeof(Value));
        if (!帧->持有格们) { 分配失败(); }
        帧->持有格数 = 0;
      }
      if (帧->持有格数 < 帧持有格上限) 帧->持有格们[帧->持有格数++] = 格;
    }
    *out = 格;
    return 1;
  }
  if (name_is(名off, "argv")) {
    if (nargs != 0) { fail("HMYR-行-002", "argv takes no arguments"); return 1; }
    *out = g_机->argv;
    return 1;
  }
  {
    /* Say which builtin is missing. A machine that only says "no" makes the
     * gap a guessing game; the name is the whole diagnostic. */
    char *msg = g_诊s;
    uint32_t n = 名长(名off);
    if (n > 200) n = 200;
    for (uint32_t i = 0; i < n; i++) {
      uint16_t ch = 名码(名off, i);
      msg[i] = (ch < 128) ? (char)ch : '?';
    }
    msg[n] = 0;
    char full[320];
    snprintf(full, sizeof full, "this machine does not have the builtin '%s'", msg);
    fail("HMYR-行-005", full);
    return 1;
  }
}

/* 实时档位的那一半（design/MEMORY.txt 第 3 节）：一个函数的槽数组不再一律从托管堆取。
 * 槽数不超过这个上界时，用栈上的那一块 —— 那条路径一次分配都不做，
 * 于是「实时回调里不经过托管」在机器这一层成立，而不只是写在文档里。
 * 超界的函数照旧走堆：那说明它太大，而静默截断比慢更糟。
 * 40 这个数来自自举层的实测（单帧最大 34 槽），留了一点余量。 */
#define 帧槽上限 40

/* 实参数组在哪：n 不超过这个数就用栈上的那一份。
 *
 * 为什么（2026-10-31 板子上量出来的）：六份跑一次，CALLF 分配了 897 次、
 * CALLB 873 次，而堆里 168 与 184 两档大半就是它们。那些分配都有 free，
 * 但递归时同时活着好几层，峰值因此上去。八个 Value 是四百四十八字节的栈，
 * 换掉每一次一次堆分配 —— 而栈那一侧每层只要多这四百多字节。
 *
 * 代价要说清：run_func 的帧会因此变大，栈每层的数要重量（design/BOARD.txt 第二十节）。 */
#define 小参上限 8

/* ---- 显式帧：求值器不再靠 C 递归（2026-11-01，design/BOARD.txt 第二十五节）----
 *
 * 为什么：每层六点九 KB 的栈里，槽数组与诊断缓冲搬走之后还剩四千多 —— 那是
 * C 调用本身的成本（返回地址、被保存的寄存器、那个大 switch 的临时区）。
 * 搬不走，只能不递归。改成帧池之后，每帧只是这块内存里的一个结构，
 * 而 CALLF 压一帧、RET 弹一帧，C 栈不再随 HMYR 的调用深度增长。
 */
typedef struct 活帧 {
  Func *f;
  Value *slots;
  uint32_t base;
  Func *外函;
  int32_t pc;
  int32_t 缓存条;
  size_t 缓存位;
  帧记录 记录;
} 活帧;

static 线程局部 活帧 *g_活帧池 = NULL;
static 线程局部 int g_活帧容量 = 0;
static 线程局部 int g_活帧深 = 0;

/* 压一帧。交回 0 表示这一帧没建起来（参数不对或栈预算超了），调用方负责清池。 */
static int 压帧(Func *f, Value *args, int nargs) {
  if (nargs != (int)f->nargs) {
    fail("HMYR-行-002", "that function got the wrong number of arguments");
    return 0;
  }
  if (g_活帧深 == g_活帧容量) {
    int 新 = g_活帧容量 ? g_活帧容量 * 2 : 32;
    活帧 *再 = (活帧 *)realloc(g_活帧池, (size_t)新 * sizeof(活帧));
    if (!再) { 分配失败(); }
    g_活帧池 = 再;
    g_活帧容量 = 新;
    /* realloc 之后每一帧的地址都变了，而 记录.上 与 g_机->帧链 存的是绝对指针 ——
     * 不重建的话，下一次 GC 标记会走到旧地址上（症状是访问违例，实测过）。 */
    for (int i = 1; i < g_活帧深; i++) {
      g_活帧池[i].记录.上 = &g_活帧池[i - 1].记录;
    }
    if (g_活帧深 > 0) {
      g_活帧池[0].记录.上 = NULL;
      g_机->帧链 = &g_活帧池[g_活帧深 - 1].记录;
    }
  }
  活帧 *fr = &g_活帧池[g_活帧深];
  fr->f = f;
  fr->slots = alloc_values(f->nslots ? f->nslots : 1);
  fr->base = g_机->stack_n;
  fr->外函 = g_机->当前函数;
  fr->pc = 0;
  fr->缓存条 = 0;
  fr->缓存位 = f->code_base;
  for (int i = 0; i < nargs && i < (int)f->nslots; i++) fr->slots[i] = args[i];
  fr->记录.slots = fr->slots;
  fr->记录.槽数 = f->nslots;
  fr->记录.上 = g_机->帧链;
  fr->记录.持有格们 = NULL;
  fr->记录.持有格数 = 0;
  fr->记录.槽在堆 = 1;
  g_机->帧链 = &fr->记录;
  g_机->基址 = fr->base;
  g_机->当前函数 = f;
  记深度(f, fr->外函);
  记栈(__builtin_frame_address(0));
  g_活帧深++;
  if (g_failed) return 0;
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
  if (g_gc开 && g_gc字节 > g_gc阈值) gc_收集();
#endif
  return 1;
}

/* 弹一帧：关掉它的持有格、还原帧链、还槽数组、恢复调用者的当前函数与基址。 */
static void 弹帧(void) {
  活帧 *fr = &g_活帧池[g_活帧深 - 1];
  /* 用副本关格：关的是同一批持有格对象，而 持有格数 这一栏不必写回。 */
  帧记录 副本 = fr->记录;
  关本帧持有格(&副本);
  /* 这张表是 owned 用的时候才分配的（hm_calloc 来的），弹帧就还回去。 */
  if (fr->记录.持有格们) { free(fr->记录.持有格们); fr->记录.持有格们 = NULL; }
  g_机->帧链 = fr->记录.上;
  fr->记录.slots = NULL;
  if (!g_gc开) free(fr->slots);
  fr->slots = NULL;
  if (g_深度) g_深度--;
  g_机->当前函数 = fr->外函;
  g_活帧深--;
  g_机->基址 = (g_活帧深 > 0) ? g_活帧池[g_活帧深 - 1].base : 0;
}

/* 清空整个帧池：出错路径用它，语义是「整机停」。 */
static void 清帧池(void) {
  while (g_活帧深 > 0) 弹帧();
  g_机->帧链 = NULL;
  g_机->当前函数 = NULL;
  g_机->基址 = 0;
}

/* 帧池的两个数：用到的深度与容量。
 * 与 操作数栈 那一对同一种用法 —— 两个并排才知道扩容是必须的，还是泄漏。 */
size_t hmyr_帧深(void) { return (size_t)g_活帧深; }
size_t hmyr_帧容量(void) { return (size_t)g_活帧容量; }

static Value run_func(Func *f, Value *args, int nargs) {
  /* 顶层调用从零开始：线程体与两处入口都走这里。 */
  g_活帧深 = 0;
  if (!压帧(f, args, nargs)) { 清帧池(); return v_null(); }
/* 出错路径：整机停 —— 那几十处 FRAME_RET 用的都是这个语义。 */
#define FRAME_RET(x) do { 清帧池(); return (x); } while (0)
  for (;;) {
    if (g_failed) FRAME_RET(v_null());
    /* 每轮从帧池里取出状态：CALLF 与 RET 都会换帧，所以不能只取一次。
     * 名字仍用原来那套（f、slots、base、外函、pc、缓存条、缓存位），
     * 于是 switch 那八百行一个字都不用改。 */
    活帧 *fr = &g_活帧池[g_活帧深 - 1];
    f = fr->f;
    Value *slots = fr->slots;
    uint32_t base = fr->base;
    int32_t pc = fr->pc;
    int32_t 缓存条 = fr->缓存条;
    size_t 缓存位 = fr->缓存位;
    if (++g_机->步数 > g_机->步限) { fail("HMYR-行-003", "the program ran for too long"); FRAME_RET(v_null()); }
    if ((uint32_t)pc >= f->ncode) { fail("HMYR-行-010", "the instruction stream ran off its end"); FRAME_RET(v_null()); }
    /* 现场解一条：不预先建 Ins 数组（见 Func 里 seg_at 那段注释）。
     * 解出来的这一份活在栈上，只够这一轮用 —— 而这一轮的其余部分照旧读 *in。 */
    Ins 本条;
    size_t 本条位;
    if (缓存条 == pc) {
      本条位 = 缓存位;
    } else {
      /* 跳转到了别处：从所在段的起点顺着字节流扫到这一条。 */
      Reader 扫 = { g_码起, g_码长, (size_t)f->code_base + f->seg_at[(uint32_t)pc / 码段宽] };
      for (uint32_t k = (uint32_t)pc % 码段宽; k > 0; k--) 读一条(&扫, NULL);
      本条位 = 扫.at;
    }
    {
      Reader rr = { g_码起, g_码长, 本条位 };
      读一条(&rr, &本条);
      缓存条 = pc + 1;
      缓存位 = rr.at;
    }
    Ins *in = &本条;
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
          char *m = g_诊m;
          snprintf(m, sizeof g_诊m, "load from slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-行-010", m);
          FRAME_RET(v_null());
        }
        push(slots[in->a]); pc++; break;
      case OP_STORE:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char *m = g_诊m;
          snprintf(m, sizeof g_诊m, "store to slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-行-010", m);
          FRAME_RET(v_null());
        }
        slots[in->a] = pop(); pc++; break;
      case OP_ASSIGN:
        if (in->a < 0 || (uint32_t)in->a >= f->nslots) {
          char *m = g_诊m;
          snprintf(m, sizeof g_诊m, "assign to slot %lld, but this function has %u", (long long)in->a, (unsigned)f->nslots);
          fail("HMYR-行-010", m);
          FRAME_RET(v_null());
        }
        slots[in->a] = pop(); pc++; break;
      case OP_POP: pop(); pc++; break;
      case OP_GLOBAL: {
        Value 值;
        uint16_t 名缓[256];
        uint32_t 名长 = 池取到((uint32_t)in->a, 名缓, 256);
        if (!全局取(名缓, 名长, &值)) {
          fail("HMYR-行-005", "there is no such global name in scope");
          FRAME_RET(v_null());
        }
        push(值); pc++; break;
      }
      /* 顶层常量的登记：值在栈顶，名字是立即数。只有顶层段发这一条。 */
      case OP_SETGLOBAL: {
        Value 值 = pop();
        uint16_t 名缓[256];
        uint32_t 名长 = 池取到((uint32_t)in->a, 名缓, 256);
        全局放(名缓, 名长, 值);
        pc++; break;
      }
      case OP_BOOL: { Value v = pop(); push(v_bool(truthy(v))); pc++; break; }
      case OP_NEG: { Value v = pop(); int ok = 0; double d = as_num(v, &ok);
        if (!ok) { fail("HMYR-行-013", "expected a number"); FRAME_RET(v_null()); } push(v_num(-d)); pc++; break; }
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
          if (!ok1 || !ok2) { fail("HMYR-行-013", "expected numbers"); FRAME_RET(v_null()); }
          push(v_num(x + y));
        }
        pc++; break;
      }
      case OP_SUB: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-行-013", "expected numbers"); FRAME_RET(v_null()); }
        push(v_num(x - y)); pc++; break; }
      case OP_MUL: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-行-013", "expected numbers"); FRAME_RET(v_null()); }
        push(v_num(x * y)); pc++; break; }
      case OP_DIV: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-行-013", "expected numbers"); FRAME_RET(v_null()); }
        if (y == 0) { fail("HMYR-行-012", "division by zero"); FRAME_RET(v_null()); }
        push(v_num(x / y)); pc++; break; }
      case OP_MOD: { Value b = pop(), a = pop(); int o1 = 0, o2 = 0;
        double x = as_num(a, &o1), y = as_num(b, &o2);
        if (!o1 || !o2) { fail("HMYR-行-013", "expected numbers"); FRAME_RET(v_null()); }
        if (y == 0) { fail("HMYR-行-012", "division by zero"); FRAME_RET(v_null()); }
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
        else { fail("HMYR-行-014", "cannot compare those two values"); FRAME_RET(v_null()); }
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
        /* 字段名从 in->a 那个偏移起顺着字节流读：每一段是「u16 长度 + 码元」，
         * 所以下一个的码元起点是 本段起点 加 长度乘二 再加二（跳过下一个长度字段）。
         * 2026-10-31 之前这里按「连续的一段池索引」取，池去掉之后改成这个样子。 */
        uint32_t off = (uint32_t)in->a;
        for (uint32_t i = 0; i < n; i++) {
          lens[i] = 名长(off);
          names[i] = 名复制(off, lens[i]);
          off += 2 + lens[i] * 2;
        }
        for (uint32_t i = 0; i < n; i++) v.rec.vals[i] = g_机->stack[g_机->stack_n - n + i];
        g_机->stack_n -= n;
        v.rec.name_lens = lens;
        v.rec.names = names;
        push(v); pc++; break;
      }
      case OP_FIELD: {
        Value t = pop();
        /* 区与块是索引，它们的字段也要能读（b.zone / b.size / b.live）。
         * 记录先问、索引后问：同名时记录赢，与另外两台同一顺序。 */
        if (t.tag == T_INDEX && t.idx) {
          uint16_t 名缓[256];
          uint32_t 名长 = 池取到((uint32_t)in->a, 名缓, 256);
          int 处 = 索引找(t.idx, 名缓, 名长);
          if (处 >= 0) { push(t.idx->项[处].值); pc++; break; }
        }
        if (t.tag != T_RECORD) {
          /* 说清楚是哪个字段、哪条指令、拿到的是什么 —— 「no field on that value」
           * 只说了一半，而查的时候要的是另一半。 */
          char *名 = g_诊n;
          uint32_t nl = 名长((uint32_t)in->a) < 63 ? 名长((uint32_t)in->a) : 63;
          for (uint32_t k = 0; k < nl; k++) { uint16_t 码 = 池码((uint32_t)in->a, k); 名[k] = (码 < 128) ? (char)码 : '?'; }
          名[nl] = 0;
          char *m = g_诊m;
          char *函名 = g_诊f;
          uint32_t fl3 = (g_机->当前函数 && g_机->当前函数->name_len < 47) ? g_机->当前函数->name_len : 0;
          for (uint32_t k = 0; k < fl3; k++) { uint16_t 码 = 名码(g_机->当前函数->name_off, k); 函名[k] = (码 < 128) ? (char)码 : '?'; }
          函名[fl3] = 0;
          snprintf(m, sizeof g_诊m, "field '%s' read off a value that is not a record (tag=%d, %s pc=%u)",
                   名, (int)t.tag, 函名, (unsigned)pc);
          fail("HMYR-行-007", m);
          FRAME_RET(v_null());
        }
        /* find the field by name */
        int found = 0;
        int 位 = -1;
        for (uint32_t i = 0; i < t.rec.n; i++) {
          if (t.rec.name_lens[i] != 名长((uint32_t)in->a)) continue;
          uint32_t same = 1;
          for (uint32_t k = 0; k < t.rec.name_lens[i]; k++) {
            if (t.rec.names[i][k] != 池码((uint32_t)in->a, k)) { same = 0; break; }
          }
          if (same) { push(t.rec.vals[i]); found = 1; 位 = (int)i; break; }
        }
        /* 影子输出：这条读到的字段在这个记录里排第几。两台机器对着 diff，
         * 就能看出是「记录造错了」还是「找错了」。 */
        g_last_field = in->a;
        if (g_fields_on) {
          fprintf(stderr, "EV %ld ", g_ev++);
          fprintf(stderr, "FIELD pc=%u n=%u i=%d name=", (unsigned)pc, (unsigned)t.rec.n, 位);
          for (uint32_t k = 0; k < 名长((uint32_t)in->a) && k < 8; k++) fprintf(stderr, "%04x", (unsigned)池码((uint32_t)in->a, k));
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
        if (!found) { fail("HMYR-行-007", "no field with that name"); FRAME_RET(v_null()); }
        pc++; break;
      }
      case OP_INDEX: {
        Value i = pop(), t = pop();
        int ok = 0; double d = as_num(i, &ok);
        if (!ok) { fail("HMYR-行-013", "index must be a number"); FRAME_RET(v_null()); }
        /* 下标先取下整，与 slice 的起止、设()、chr() 同一条规矩（src/numbers.mjs 的 下整）。
           原来是 (long long) 直接转，对小数是朝零截断，而 JS 那三台用的是 floor —— 负数上不同。 */
        long long idx = (long long)floor(d);
        if (t.tag == T_STR) {
          if (idx < 0 || idx >= (long long)t.slen) { fail("HMYR-行-018", "index outside the value"); FRAME_RET(v_null()); }
          push(v_str(t.s + idx, 1));
        } else if (t.tag == T_TUPLE || t.tag == T_ARRAY) {
          if (idx < 0 || idx >= (long long)t.ilen) { fail("HMYR-行-018", "index outside the value"); FRAME_RET(v_null()); }
          push(t.items[idx]);
        } else { fail("HMYR-行-019", "cannot index that value"); FRAME_RET(v_null()); }
        pc++; break;
      }
      case OP_CALLB: {
        uint32_t n = (uint32_t)in->b;
        if (g_calls_on && g_calls_n < 200000) {
          char *bn = g_诊f;
          uint32_t bl = 名长((uint32_t)in->a) < 63 ? 名长((uint32_t)in->a) : 63;
          for (uint32_t k = 0; k < bl; k++) { uint16_t 码 = 池码((uint32_t)in->a, k); bn[k] = (码 < 128) ? (char)码 : '?'; }
          bn[bl] = 0;
          fprintf(stderr, "EV %ld CALLB %s n=%u\n", g_ev++, bn, (unsigned)n);
          g_calls_n++;
        }
        if (g_机->stack_n < base || g_机->stack_n - base < n) {
          char *m = g_诊m;
          snprintf(m, sizeof g_诊m, "a builtin call wants %u argument(s), the frame has %u",
                   (unsigned)n, (unsigned)(g_机->stack_n - base));
          fail("HMYR-行-010", m);
          FRAME_RET(v_null());
        }
        Value 小参[小参上限];
        Value *args = n <= 小参上限 ? 小参 : (Value *)malloc((size_t)n * sizeof(Value));
        for (uint32_t i = 0; i < n; i++) args[i] = g_机->stack[g_机->stack_n - n + i];
        g_机->stack_n -= n;
        Value out = v_null();
        call_builtin(in->a, args, (int)n, &out);
        if (args != 小参) free(args);
        if (g_failed) FRAME_RET(v_null());
        push(out); pc++; break;
      }
      case OP_CALLM: {
        /* 方法调用：主在参数之下。分派交给 调区方法 —— 与另外两台同一套判词，
         * 因为「三台机器同一个答案」靠的是判词相同，不是实现相同。 */
        uint32_t n = (uint32_t)in->b;
        if (g_机->stack_n < base + (uint32_t)n + 1) {
          fail("HMYR-行-010", "a method call wants a receiver and its arguments");
          FRAME_RET(v_null());
        }
        {
          Value 主 = g_机->stack[g_机->stack_n - n - 1];
          Value *args = (Value *)malloc((size_t)(n ? n : 1) * sizeof(Value));
          for (uint32_t i = 0; i < n; i++) args[i] = g_机->stack[g_机->stack_n - n + i];
          g_机->stack_n -= (n + 1);
          Value out = v_null();
          uint16_t 名缓[256];
          uint32_t 名长 = 池取到((uint32_t)in->a, 名缓, 256);
          调区方法(主, 名缓, 名长, args, (int)n, &out);
          free(args);
          if (g_failed) FRAME_RET(v_null());
          push(out); pc++; break;
        }
      }
      case OP_CALLF: {
        int64_t 位 = find_func_index(in->a);
        Func *callee = (位 >= 0) ? &g_机->函数们[位] : NULL;
        if (!callee) { fail("HMYR-行-005", "there is no such function"); FRAME_RET(v_null()); }
        if (g_calls_on && g_calls_n < 200000) {
          /* 对某一个函数，顺手把实参的种类打出来：调用序列只说明「调了它」，
           * 说不清「给了它什么」。求二元 就是被盯的那个（79 号）。 */
          if (位 == 79) {
            fprintf(stderr, "ARGS79 base=%u stackn=%u n=%u tags=", (unsigned)base, (unsigned)g_机->stack_n, (unsigned)in->b);
            for (uint32_t i = 0; i < (uint32_t)in->b; i++) fprintf(stderr, " %d", (int)g_机->stack[g_机->stack_n - (uint32_t)in->b + i].tag);
            fprintf(stderr, " lastfield=");
            if (g_last_field >= 0) { for (uint32_t k = 0; k < 名长((uint32_t)g_last_field) && k < 8; k++) fprintf(stderr, "%04x", (unsigned)池码((uint32_t)g_last_field, k)); }
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
            /* realtime 是档位，不是权限 —— 它不沿调用链传（design/MEMORY.txt 第 3 节）。 */
            {
              const char *字 = "realtime";
              uint32_t 字长 = 8;
              if (callee->effect_lens[e] == 字长) {
                uint32_t 同 = 1;
                for (uint32_t k = 0; k < 字长; k++) {
                  if (名码(callee->effect_offs[e], k) != (uint16_t)(unsigned char)字[k]) { 同 = 0; break; }
                }
                if (同) continue;
              }
            }
            if (has_effect(f, callee->effect_offs[e], callee->effect_lens[e])) continue;
            char *效 = g_诊g;
            uint32_t el = callee->effect_lens[e] < 31 ? callee->effect_lens[e] : 31;
            for (uint32_t k = 0; k < el; k++) { uint16_t 码 = 名码(callee->effect_offs[e], k); 效[k] = (码 < 128) ? (char)码 : '?'; }
            效[el] = 0;
            char *名 = g_诊n;
            uint32_t fl2 = callee->name_len < 63 ? callee->name_len : 63;
            for (uint32_t k = 0; k < fl2; k++) { uint16_t 码 = 名码(callee->name_off, k); 名[k] = (码 < 128) ? (char)码 : '?'; }
            名[fl2] = 0;
            char *m = g_诊m;
            snprintf(m, sizeof g_诊m, "%s uses effect '%s', which the caller did not declare", 名, 效);
            fail("HMYR-內-001", m);
            FRAME_RET(v_null());
          }
        }
        if (g_机->stack_n < base || g_机->stack_n - base < n) {
          char *fname = g_诊f;
          uint32_t fl = callee->name_len < 63 ? callee->name_len : 63;
          for (uint32_t k = 0; k < fl; k++) { uint16_t 码 = 名码(callee->name_off, k); fname[k] = (码 < 128) ? (char)码 : '?'; }
          fname[fl] = 0;
          char *m = g_诊m;
          snprintf(m, sizeof g_诊m, "calling %s (#%lld) wants %u argument(s), the frame has %u (pc=%u)",
                   fname, (long long)位, (unsigned)n, (unsigned)(g_机->stack_n - base), (unsigned)pc);
          fail("HMYR-行-010", m);
          FRAME_RET(v_null());
        }
        Value 小参[小参上限];
        Value *args = n <= 小参上限 ? 小参 : (Value *)malloc((size_t)n * sizeof(Value));
        for (uint32_t i = 0; i < n; i++) args[i] = g_机->stack[g_机->stack_n - n + i];
        g_机->stack_n -= n;
        /* 显式帧：先把当前帧的状态写回（pc 停在 CALL 上，等 RET 之后前进），
         * 再压一帧回到主循环 —— 这里不再递归。 */
        fr->pc = pc; fr->缓存条 = 缓存条; fr->缓存位 = 缓存位;
        int 压上 = 压帧(callee, args, (int)n);
        if (args != 小参) free(args);
        if (!压上) FRAME_RET(v_null());
        continue;
      }
      case OP_RET: {
        Value v = pop();
        /* 清掉本帧留在操作数栈上的东西，然后弹帧。弹帧会恢复调用者的
         * 当前函数与基址（见 弹帧），所以这里不再手动还原那三样。 */
        g_机->stack_n = base;
        弹帧();
        if (g_活帧深 == 0) return v;
        /* 调用者停在 CALL 上：返回值压回它的栈，然后它前进一条。 */
        g_活帧池[g_活帧深 - 1].pc++;
        push(v);
        continue;
      }
      default: {
        char *msg = g_诊s;
        uint32_t k = in->op;
        const char *nm = (k < sizeof op_names / sizeof *op_names) ? op_names[k] : "?";
        snprintf(msg, sizeof g_诊s, "cannot execute the instruction %s", nm);
        fail("HMYR-行-010", msg);
        FRAME_RET(v_null());
      }
    }
    /* 每条指令跑完之后把状态写回帧里 —— 下一轮从帧里取，所以 CALLF 与 RET
     * 换了帧之后，接着跑的自然是新的那一帧。 */
    fr->pc = pc; fr->缓存条 = 缓存条; fr->缓存位 = 缓存位;
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
  if (!buf) { 分配失败(); }
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

/* 把装载过的那一份放下，好装下一份。不清的话第二份的槽位会接在第一份后面，
 * 症状是「程序跑起来了，但用的是别人的常数」—— 那种错比崩溃难查。
 * 名字池没了（2026-10-31），这里要清的只剩名字缓存 —— 它存的是偏移，
 * 换了程序那些偏移就没有意义了。 */
static void unload_program(void) {
  g_机->函数们 = NULL;
  g_机->函数数 = 0;
  名缓存用 = 0;
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
static void 临时路径(char *buf, size_t cap, const char *号) {
#ifdef _WIN32
  const char *dir = getenv("TEMP");
  if (!dir || !*dir) dir = getenv("TMP");
  if (!dir || !*dir) dir = ".";
  /* 名字里带线程号：两个线程同时要一份临时文件时，光有 pid 会撞成同一个名字 ——
   * 一个在写、另一个在读，症状是访问违例而不是「文件读不到」。
   *
   * 号 是调用方给的额外后缀（2026-11-02）：`线程起` 是在主线程里取路径的，
   * 于是两个线程的 GetCurrentThreadId() 相同、撞成同一个文件名。那一条修法
   * 是让调用方把线程句柄号当字符串传进来 —— 拼接放在这里一次做完，
   * 不再拿 1024 字节的路径去套 "%s-%d"（那会触发 -Wformat-truncation）。 */
  snprintf(buf, cap, "%s\\hmyr-%ld-%lu%s.hmoks", dir, (long)_getpid(), (unsigned long)GetCurrentThreadId(), 号 ? 号 : "");
#elif defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
  const char *dir = getenv("TMPDIR");
  if (!dir || !*dir) dir = "/tmp";
  snprintf(buf, cap, "%s/hmyr%s.hmoks", dir, 号 ? 号 : "");
#else
  const char *dir = getenv("TMPDIR");
  if (!dir || !*dir) dir = "/tmp";
  snprintf(buf, cap, "%s/hmyr-%ld%s.hmoks", dir, (long)getpid(), 号 ? 号 : "");
#endif
}

/* 容器这一整块只给桌面：它要临时目录、要建目录、要 getenv —— 裸机上一样都没有，
 * 而板子上摊开一个容器本来也没有地方摊。所以裸机上给两个 stub：
 * 「不认这个后缀」与「解不出来」，main 里那个分支于是永远不进去。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)

/* ---------- 容器：.hm-ittgn-krgn-m ----------
 *
 * 与 src/ittgn.mjs 是同一条规矩的两份实现：那一份读容器，这一份也读。
 * 验收是「同一份容器，两台跑出同一段输出」—— 比「两边都能读」硬得多。
 *
 * 摊开用临时目录：容器就地跑不起来，因为它的成员在文件里、不在文件系统上。
 * 摊开之后交给既有的两条路（源码走 cli_main，字节码走 run_bytecode），
 * 那一层不必知道「容器」这回事。 */

static void 临时目录路径(char *buf, size_t cap) {
#ifdef _WIN32
  const char *dir = getenv("TEMP");
  if (!dir || !*dir) dir = getenv("TMP");
  if (!dir || !*dir) dir = ".";
  /* 带线程号的理由与 临时路径 那一条相同：两个线程同时摊开一个容器会撞成同一个目录。 */
  snprintf(buf, cap, "%s\\hmyr-ittgn-%ld-%lu", dir, (long)_getpid(), (unsigned long)GetCurrentThreadId());
#elif defined(__arm__) || defined(__ARM_ARCH) || defined(__aarch64__)
  const char *dir = getenv("TMPDIR");
  if (!dir || !*dir) dir = "/tmp";
  snprintf(buf, cap, "%s/hmyr-ittgn", dir);
#else
  const char *dir = getenv("TMPDIR");
  if (!dir || !*dir) dir = "/tmp";
  snprintf(buf, cap, "%s/hmyr-ittgn-%ld", dir, (long)getpid());
#endif
}

static void 试建目录(const char *路) {
#ifdef _WIN32
  _mkdir(路);
#else
  mkdir(路, 0777);
#endif
}

/* 建到「最后一段的前面」：路是文件路径，所以末段不能建。
 * 成员的路径里可以带子目录，所以要从头一级一级来。 */
static void 建父目录(const char *路) {
  char 暂[2048];
  snprintf(暂, sizeof 暂, "%s", 路);
  for (char *p = 暂 + 1; *p; p++) {
    if (*p == '/' || *p == '\\') {
      char 旧 = *p;
      *p = 0;
      试建目录(暂);
      *p = 旧;
    }
  }
}

static int 写整文件(const char *路, const uint8_t *数据, size_t 长) {
  FILE *f = 开文件(路, "wb");
  if (!f) return 0;
  size_t 写 = fwrite(数据, 1, 长, f);
  fclose(f);
  return 写 == 长;
}

static int 以尾2(const char *s, const char *尾) {
  size_t n = strlen(s), m = strlen(尾);
  return n >= m && strcmp(s + n - m, 尾) == 0;
}

static int 是容器路径(const char *p) { return p && 以尾2(p, ".hm-ittgn-krgn-m"); }

static unsigned 容器读16(const uint8_t *b, size_t 位) {
  return (unsigned)b[位] | ((unsigned)b[位 + 1] << 8);
}

static unsigned 容器读32(const uint8_t *b, size_t 位) {
  return (unsigned)b[位] | ((unsigned)b[位 + 1] << 8) | ((unsigned)b[位 + 2] << 16) | ((unsigned)b[位 + 3] << 24);
}

typedef struct {
  char 名[1024];
  const uint8_t *数据;
  size_t 长;
  int 阶;   /* 0 = 源码，1 = 字节码，-1 = 两者都不是 */
} 容器成员;

/* 去掉目录与扩展名，留下基名。挑入口时要拿它比 main 与包名。 */
static void 取基名(const char *名, char *出, size_t cap) {
  const char *末段 = 名;
  for (const char *p = 名; *p; p++) if (*p == '/' || *p == '\\') 末段 = p + 1;
  snprintf(出, cap, "%s", 末段);
  char *点 = strrchr(出, '.');
  if (点) *点 = 0;
}

/* 把容器摊到临时目录，交回入口的路径（malloc 的 UTF-8）。挑不出来返回 NULL。
 *
 * 挑法与 src/ittgn.mjs 的 找入口 逐条对齐：先源码后字节码；同一阶里先 main、
 * 后与包同名、再取第一个。两处对同一份容器挑出不同成员的话，那一条验收会当场红。 */
static char *解容器(const char *包路) {
  size_t 长 = 0;
  uint8_t *字节 = read_file(包路, &长);
  if (!字节) { fprintf(stderr, "HMYR-器-003 cannot read that container: %s\n", 包路); return NULL; }
  if (长 < 12 || memcmp(字节, "HMYRITTGN", 9) != 0) {
    fprintf(stderr, "HMYR-器-003 not a container: %s\n", 包路);
    free(字节);
    return NULL;
  }
  if (字节[9] != 1) {
    fprintf(stderr, "HMYR-器-005 container version %u is not known\n", (unsigned)字节[9]);
    free(字节);
    return NULL;
  }
  unsigned 数 = 容器读16(字节, 10);
  容器成员 *们 = (容器成员 *)calloc(数 ? 数 : 1, sizeof(容器成员));
  if (!们) { free(字节); return NULL; }
  size_t 位 = 12;
  for (unsigned i = 0; i < 数; i++) {
    if (位 + 2 > 长) goto 截断;
    unsigned 名长 = 容器读16(字节, 位);
    if (位 + 2 + 名长 + 4 > 长) goto 截断;
    if (名长 >= sizeof 们[i].名) {
      fprintf(stderr, "HMYR-器-007 member name is too long: %u bytes\n", 名长);
      free(们);
      free(字节);
      return NULL;
    }
    memcpy(们[i].名, 字节 + 位 + 2, 名长);
    们[i].名[名长] = 0;
    size_t 长位 = 位 + 2 + 名长;
    unsigned 数据长 = 容器读32(字节, 长位);
    size_t 起 = 长位 + 4;
    if (起 + 数据长 > 长) goto 截断;
    们[i].数据 = 字节 + 起;
    们[i].长 = 数据长;
    if (以尾2(们[i].名, ".hmoca")) 们[i].阶 = 0;
    else if (以尾2(们[i].名, ".hmoks")) 们[i].阶 = 1;
    else 们[i].阶 = -1;
    位 = 起 + 数据长;
  }

  {
    char 目录[1024];
    临时目录路径(目录, sizeof 目录);
    试建目录(目录);
    for (unsigned i = 0; i < 数; i++) {
      char 全[2048];
      snprintf(全, sizeof 全, "%s/%s", 目录, 们[i].名);
      建父目录(全);
      if (!写整文件(全, 们[i].数据, 们[i].长)) {
        fprintf(stderr, "HMYR-器-007 cannot write a member: %s\n", 们[i].名);
        free(们);
        free(字节);
        return NULL;
      }
    }

    /* 包名：容器文件名去掉后缀。用「与包同名」挑入口时要用它。 */
    char 包名[512];
    {
      const char *末段 = 包路;
      for (const char *p = 包路; *p; p++) if (*p == '/' || *p == '\\') 末段 = p + 1;
      snprintf(包名, sizeof 包名, "%s", 末段);
      size_t m = strlen(".hm-ittgn-krgn-m");
      size_t n = strlen(包名);
      if (n > m) 包名[n - m] = 0;
    }

    int 选 = -1;
    for (int 阶 = 0; 阶 < 2 && 选 < 0; 阶++) {
      int 第一个 = -1, 同名 = -1, 主 = -1;
      for (unsigned i = 0; i < 数; i++) {
        if (们[i].阶 != 阶) continue;
        if (第一个 < 0) 第一个 = (int)i;
        char 基[512];
        取基名(们[i].名, 基, sizeof 基);
        if (同名 < 0 && strcmp(基, 包名) == 0) 同名 = (int)i;
        if (主 < 0 && strcmp(基, "main") == 0) 主 = (int)i;
      }
      选 = 主 >= 0 ? 主 : 同名 >= 0 ? 同名 : 第一个;
    }
    if (选 < 0) {
      fprintf(stderr, "HMYR-器-008 the container has no runnable entry (needs a .hmoca or .hmoks member)\n");
      free(们);
      free(字节);
      return NULL;
    }
    {
      char 全[2048];
      snprintf(全, sizeof 全, "%s/%s", 目录, 们[选].名);
      char *出 = (char *)malloc(strlen(全) + 1);
      if (出) memcpy(出, 全, strlen(全) + 1);
      free(们);
      free(字节);
      return 出;
    }
  }

截断:
  fprintf(stderr, "HMYR-器-006 the container member table is truncated\n");
  free(们);
  free(字节);
  return NULL;
}

#else  /* 裸机：没有文件系统，摊不开容器 */

static int 是容器路径(const char *p) { (void)p; return 0; }
static char *解容器(const char *包路) { (void)包路; return NULL; }

#endif

/* 种子在哪。三种找法，按「离用户近」排：环境变量、可执行文件旁边、
 * 当前目录。找不到就明说，别让人等一个「没有这个文件」的通用消息。 */
/* 内置种子写到哪儿：与编译产物分开一个名字，免得 cli_main 的清理删错文件。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
static 线程局部 char g_种子临时[1024];

static int 写种子临时(char *buf, size_t cap) {
  临时路径(buf, cap, NULL);
  size_t n = strlen(buf);
  if (n > 6 && strcmp(buf + n - 6, ".hmoks") == 0) {
    snprintf(buf + n - 6, cap - (n - 6), ".seed.hmtn");
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
    snprintf(buf, cap, "%s%cbootstrap%cpack.hmtn", 目录, '\\', '\\');
    if (文件在(buf)) return 1;
    snprintf(buf, cap, "%s%c..%cbootstrap%cpack.hmtn", 目录, '\\', '\\', '\\');
    if (文件在(buf)) return 1;
  }
  snprintf(buf, cap, "bootstrap%cpack.hmtn", '\\');
  if (文件在(buf)) return 1;
  return 0;
}

/* 档位：看名字，不看内容 —— 与 JS 那侧的 tools/file-kind.mjs 同一条规矩。
 * 只写在这里：步限与回收都问它。两处各写一遍「以尾」的话，改一处就漏一处，
 * 而那种漏不会当场叫 —— 它只是让某一个名字悄悄回到默认档。 */
static int 是弹性档(const char *名) {
  size_t n = 名 ? strlen(名) : 0;
  return n > 6 && strcmp(名 + n - 6, ".hmhsr") == 0;
}

/* 步限：默认五百万步。跑解释器替程序执行要几十倍，所以从环境变量放宽 ——
 * 编译那一段则直接按放宽的那个数算，因为「编一份源码」本来就不是小活。 */
static int 步限从环境(const char *目标) {
  const char *sl = getenv("HMYR_STEPS");
  if (sl) {
    long v = atol(sl);
    if (v > 0) return (int)(v > 2000000000L ? 2000000000L : v);
  }
  /* 两档落在两个已经存在的数上：五百万是这一份一直以来的默认，两亿是启动器
   * 主路径一直以来的默认。.hmsnp 就是默认那一档，所以这里只判弹性档。 */
  return 是弹性档(目标) ? 200000000 : 5000000;
}

/* 回收：默认开，阈值三十二兆。档位给默认值 —— steady 开、elastic 关，与
 * tools/file-kind.mjs 的档预设同一条规矩（看后缀，不看内容）。
 * 环境变量优先于档位：它说的是「这一跑我要改」，比文件名离得更近。
 * 只在桌面编译：裸机上没有 getenv，也没有回收器本身。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
static void 回收从档位(const char *目标) {
  int 默认 = 是弹性档(目标) ? 0 : 1;
  { const char *gc = getenv("HMYR_GC"); g_gc开 = gc ? !(gc[0] == 48 && gc[1] == 0) : 默认; }
  g_gc日志 = getenv("HMYR_GC_LOG") != NULL;
  {
    const char *gb = getenv("HMYR_GC_BYTES");
    if (gb) {
      long v = atol(gb);
      if (v > 0) g_gc阈值 = (size_t)v;
    }
  }
}
#endif

/* 装一份字节码、按命令行给它 argv、跑，交回退出码。
 *
 * 装载路径与 argv[0] 分开给：装载用临时文件，而程序看到的第一个参数
 * 应该是用户敲的那个源文件 —— 它读 argv() 时不该看见一个临时名字。 */
static int run_bytecode(const char *path, const char *argv0, int nrest, char **rest, int 限) {
  size_t len = 0;
  uint8_t *bytes = read_file(path, &len);
  if (!bytes) {
    fprintf(stderr, "HMYR-詞-009 cannot read that bytecode file: %s\n", path);
    return 1;
  }
  load_program(bytes, len);
  /* HMYR_LOAD_ONLY=1：装载完就停，只报装载本身花了多少。
   *
   * 为什么要有这一条：装完再跑，heap 峰值是两件事的和，于是「读法装不下」
   * 这句话会被「程序跑起来也要内存」搅在一起。而 design/BOARD.txt 第十二节
   * 要回答的是前者 —— 那份字节码读进来本身要多少。分开量才有落点。
   *
   * 只在桌面上有用：板子上 getenv 返回 0，那一条开不起来。 */
  if (getenv("HMYR_LOAD_ONLY")) {
    /* 用 %llu 而不是 %zu：这台机器上的那个 gcc 走的是 MSVCRT 的 printf，
     * 它不认 z 修饰符 —— 而 c-vm 那一套把「编译时一条警告都没有」当判据，
     * 于是这条诊断会把它弄红。 */
    fprintf(stderr, "load=%llu\n", (unsigned long long)hmyr_堆峰值());
    return 0;
  }
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
      if (f->name_len == 4 && 名码(f->name_off, 0) == 'm' && 名码(f->name_off, 1) == 'a' && 名码(f->name_off, 2) == 'i' && 名码(f->name_off, 3) == 'n') entry = f;
      if (f->name_len == 5) {
        uint32_t same = 1;
        for (uint32_t k = 0; k < 5; k++) if (名码(f->name_off, k) != cli_name[k]) { same = 0; break; }
        if (same) cli = f;
      }
    }
  }
  if (cli && nrest > 0) entry = cli;
  if (!entry) { fprintf(stderr, "HMYR-詞-009 no main in %s\n", path); return 1; }

  /* 顶层段：调 main 之前先跑一次。名字与 src/bytecode.mjs 的 顶层段名 是同一串 ——
   * 改一处要两处一起改。它由编译器生成，只在有模块级 const 的模块里存在。 */
  g_全局数 = 0;
  {
    Func *top = NULL;
    const char *字 = "__hmyr_top__";
    uint32_t 字长 = 12;
    for (uint32_t i = 0; i < g_机->函数数; i++) {
      Func *f = &g_机->函数们[i];
      if (f->name_len != 字长) continue;
      uint32_t 同 = 1;
      for (uint32_t k = 0; k < 字长; k++) {
        if (名码(f->name_off, k) != (uint16_t)(unsigned char)字[k]) { 同 = 0; break; }
      }
      if (同) { top = f; break; }
    }
    if (top) {
      (void)run_func(top, NULL, 0);
      if (g_failed) { 报一行(g_fail_msg); return 1; }
    }
  }

  Value r = run_func(entry, NULL, 0);
  if (g_trace_on) trace_dump();
  if (g_failed) {
    报一行(g_fail_msg);
    return 1;
  }
  /* 返回值就是退出码，不是输出。自举层自己会打印它那份验收的编号，
   * 而一台机器不欠谁这一行。 */
  return (r.tag == T_NUM) ? (int)r.num : 0;
}

/* ---- 线程：三个辅助函数的定义（声明在内置表那一段） -------------------
 *
 * 为什么定义在这儿：它们要用种子、装载与执行那一批函数，而那批在文件更靠后的位置。
 * 结构与线程表留在内置表旁边 —— 那里要用到它们的字段。 */
#if defined(_WIN32)
static DWORD WINAPI 线程体(LPVOID 参) {
  线程上下文 *c = (线程上下文 *)参;
  Hmyr机器 m;
  memset(&m, 0, sizeof g_诊m);
  m.步限 = 200000000;
  /* 这一句就是「独立实例」：从此刻起，这个线程里每一处 g_机 都是自己那一台。 */
  g_机 = &m;
  g_failed = 0;
  c->码 = 0;
  c->话[0] = 0;
  c->结果[0] = 0;

  do {
    char 种子[1024];
    if (!找种子(种子, sizeof 种子, "")) { c->码 = 1; snprintf(c->话, sizeof c->话, "no seed to compile with"); break; }
    {
      char *编译参[2];
      int 码;
      编译参[0] = c->产物路径;
      编译参[1] = c->源码路径;
      /* 种子自己会打印「N 个块 → 路径」。那是编译期的进度，不该落进用户程序的输出 ——
       * cli_main 在它那一趟做同样的一件事，这里也要做，否则线程里的编译日志会混进
       * 主线程的 stdout，症状是「输出对，但前面多了一行」。 */
      g_compile_quiet = 1;
      码 = run_bytecode(种子, 种子, 2, 编译参, 200000000);
      g_compile_quiet = 0;
      if (码 != 0) { c->码 = 2; snprintf(c->话, sizeof c->话, "the compiler failed on that source"); break; }
    }
    {
      size_t 长 = 0;
      uint8_t *字节 = read_file(c->产物路径, &长);
      Func *入口 = NULL;
      if (!字节) { c->码 = 3; snprintf(c->话, sizeof c->话, "cannot read what the compiler wrote"); break; }
      /* 可开的现场（2026-11-02）：线程读的到底是哪一个文件、读到多少字节。
       * 报的是「the file ends in the middle of something」而偏移落在主程序的长度里，
       * 所以先要看清这一句而不是继续猜。HMYR_THREAD_TRACE=1 才打印。 */
      if (getenv("HMYR_THREAD_TRACE")) fprintf(stderr, "[线程 %d] 读 %s → %lu 字节\n", c->号, c->产物路径, (unsigned long)长);
      load_program(字节, 长);
      {
        uint32_t 长16 = 0;
        uint16_t *u = utf8_to_utf16(c->入口, strlen(c->入口), &长16);
        for (uint32_t i = 0; i < g_机->函数数; i++) {
          Func *f = &g_机->函数们[i];
          uint32_t same = 1;
          if (f->name_len != 长16) continue;
          for (uint32_t k = 0; k < 长16; k++) if (名码(f->name_off, k) != u[k]) { same = 0; break; }
          if (same) { 入口 = f; break; }
        }
      }
      if (!入口) { c->码 = 4; snprintf(c->话, sizeof c->话, "no such function: %s", c->入口); break; }
      {
        Value r = run_func(入口, NULL, 0);
        Value t = v_null();
        if (g_failed) { c->码 = 5; snprintf(c->话, sizeof c->话, "%s", g_fail_msg); break; }
        value_to_text(r, &t);
        {
          char *文本 = utf16_to_utf8(t.s, t.slen);
          snprintf(c->结果, sizeof c->结果, "%s", 文本 ? 文本 : "");
          free(文本);
        }
      }
    }
  } while (0);

  c->完 = 1;
  g_机 = &主机;
  return 0;
}

/* 起一个线程。交回句柄号，起不来交回 -1 —— 与 JS 那侧「起不来」同一条路：
 * 调用方拿到 -1 之后 join 会得到 HMYR-內-020，一条路而不是两条。 */
/* 运行时的线程池上限。0 表示用编译期那个数（线程上限）；steady 那一档给 1。
 * 编译期那个数管的是数组大小，这个数管的是「这一次准开几个」。 */
static int g_线程上限 = 0;

static int 线程起(const char *源码, const char *入口) {
  线程上下文 *c;
  FILE *f;
  int 槽 = -1;
  int 限 = g_线程上限 > 0 ? g_线程上限 : 线程上限;
  {
    int 活 = 0;
    for (int i = 0; i < 线程上限; i++) if (g_线程们[i]) 活++;
    /* 池满与「这台机器起不了线程」都是 -1，但那不是一件事：一个该等，一个该换机器。
     * 所以池满在这里说一句 —— steady 那一档只给一个槽，撞上去是设计，不是意外。 */
    if (活 >= 限) {
      fprintf(stderr, "HMYR-內-022 thread pool is full: %d alive, limit %d\n", 活, 限);
      return -1;
    }
  }
  for (int i = 0; i < 线程上限; i++) if (!g_线程们[i]) { 槽 = i; break; }
  if (槽 < 0) return -1;
  c = (线程上下文 *)calloc(1, sizeof(线程上下文));
  if (!c) return -1;
  c->号 = g_下一个线程号++;
  snprintf(c->入口, sizeof c->入口, "%s", 入口);
  {
    /* 再嵌一个线程句柄号（2026-11-02 修的真 bug）：临时路径 的名字里带的是
     * GetCurrentThreadId()，而这一句是在**主线程**里执行的 —— 两个线程于是拿到
     * 同一个文件名，一个在写、另一个在读，症状是「the file ends in the middle of
     * something」而两台机器的输出只差一个 2。c->号 是递增的句柄号，一定不同。 */
    char 号串[32];
    snprintf(号串, sizeof 号串, "-%d", c->号);
    临时路径(c->源码路径, sizeof c->源码路径, 号串);
  }
  snprintf(c->产物路径, sizeof c->产物路径, "%s.hmoks", c->源码路径);
  f = 开文件(c->源码路径, "wb");
  if (!f) { free(c); return -1; }
  fwrite(源码, 1, strlen(源码), f);
  fclose(f);

  c->手 = CreateThread(NULL, 0, 线程体, c, 0, NULL);
  if (!c->手) { remove(c->源码路径); free(c); return -1; }
  g_线程们[槽] = c;
  return c->号;
}

static 线程上下文 *找线程(int 号) {
  for (int i = 0; i < 线程上限; i++) if (g_线程们[i] && g_线程们[i]->号 == 号) return g_线程们[i];
  return NULL;
}

/* 收掉一行的账：句柄关掉、两份临时文件删掉、结构放掉。 */
static void 清线程(线程上下文 *c) {
  for (int i = 0; i < 线程上限; i++) if (g_线程们[i] == c) g_线程们[i] = NULL;
  if (c->手) CloseHandle(c->手);
  remove(c->源码路径);
  remove(c->产物路径);
  free(c);
}
#endif

/* 启动器的正文：两趟。第一趟种子编，第二趟跑编出来的那一份。 */

/* 一个路径是源码还是字节码。判据只看后缀，不看内容去猜 ——
 * 猜错的时候症状比报错难查得多（这一句在这一份里已经写过一次）。
 *
 * 两套名字并存，是改名第一步（design/FILETYPE.txt 第七节）：
 *   .hmyr   旧名    ↔ .hmoca  新名
 *   .hmyrb  旧名    ↔ .hmoks  新名（种子另有 .hmtn）
 * 这一份里认名字的地方只有此处，其余出现 .hmyrb 的地方都是产物名。 */
static int 是源码路径(const char *p) {
  size_t n = strlen(p);
  if (n > 6 && strcmp(p + n - 6, ".hmoca") == 0) return 1;
  /* 两档的入口也是源码，只是档位不同：内容照样要交给种子去编。 */
  if (n > 6 && strcmp(p + n - 6, ".hmsnp") == 0) return 1;
  if (n > 6 && strcmp(p + n - 6, ".hmhsr") == 0) return 1;
  return 0;
}

static int cli_main(int argc, char **argv) {
  char 种子[1024];
  if (!找种子(种子, sizeof 种子, argv[0])) {
    fprintf(stderr, "HMYR-詞-009 no seed: put bootstrap/pack.hmyrb beside this program, "
                    "or say where it is with HMYR_SEED\n");
    return 2;
  }
  char 临时[1024];
  临时路径(临时, sizeof 临时, NULL);
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
      fprintf(stderr, "HMYR-詞-009 the seed could not compile %s\n", argv[1]);
      return 码 == 0 ? 1 : 码;
    }
  }
  if (!文件在(临时)) {
    remove(临时);
    fprintf(stderr, "HMYR-詞-009 the seed said it wrote %s, and it is not there\n", 临时);
    return 1;
  }

  unload_program();
  {
    int nrest = argc - 2;
    char **参 = (char **)malloc(sizeof(char *) * (size_t)(nrest > 0 ? nrest : 1));
    if (!参) { 分配失败(); }
    for (int i = 0; i < nrest; i++) 参[i] = argv[i + 2];
    int 码 = run_bytecode(临时, argv[1], nrest, 参, 步限从环境(argv[1]));
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
  return run_bytecode(路径, 路径, nrest, 参数, 步限从环境(路径));
}

#ifndef HMYR_LIB
/* 板子上没有「命令行」，也就没有这个 main —— 那一边的入口是 port/board-main.c。
 *
 * 一条 #ifndef 就够，而不必把整个文件拆成两份：这台机器与「它跑在哪」无关这件事，
 * 在 hmyr_运行 以下就已经成立，只有「从哪儿拿字节码、往哪儿写出口」是平台的事，
 * 而那两件事本来就在 port/ 里。
 */
#ifndef HMYR_BOARD
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
  else if (getenv("HMYR_HEAP_ONLY")) atexit(堆峰值报一下);
  if (getenv("HMYR_MALLOC_HIST")) 直方开();
  /* 回收：默认开，HMYR_GC=0 关掉。阈值默认三十二兆（HMYR_GC_BYTES 改）。
   * 为什么改默认：实测同一份自编译，关着峰值 279.3 兆、开着 151.2 兆，
   * 而耗时几乎一样（12.8 秒对 12.6 秒）。原来那句「一次运行很短，GC 是另一件工作」
   * 在峰值上已经站不住 —— 二百五十六兆的界线只剩四十兆余量。
   * 板子上不编这一块，那几个变量也不在 —— 所以这一段只给桌面。
   * 档位那一项也在这里给默认：steady 开、elastic 关。 */
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
  回收从档位(argc > 1 ? argv[1] : NULL);
#endif
  {
    /* 上限：给了就照给的，给 0 表示不限。 */
    const char *ml = getenv("HMYR_MEM_LIMIT");
    if (ml) {
      long v = atol(ml);
      g_mem_limit = v > 0 ? (size_t)v * 1024 * 1024 : 0;
    }
  }
  {
    /* 栈预算：桌面上的「像板子那样只有这么点栈」，单位是字节。
     * 与 HMYR_MEM_LIMIT 的分工：那个管堆，这个管递归用掉的栈。 */
    const char *sl = getenv("HMYR_STACK_LIMIT");
    if (sl) {
      long v = atol(sl);
      if (v > 0) g_栈限 = (size_t)v;
    }
  }

  /* 档位：hmsnp 只给一个线程槽（与它保守的步限是同一件事），hmhsr 用编译期那个数。
   * 与步限那条同一条规矩：看后缀，不看内容。 */
#if defined(_WIN32)
  /* 线程池那一项只在有线程块的平台上存在（线程块本身是 _WIN32 的），
   * 所以这一句也只在那一侧 —— 裸机上它引用的两个东西都不在。 */
  if (argv[1]) g_线程上限 = 以尾2(argv[1], ".hmsnp") ? 1 : 0;
#endif
  /* 容器：先摊开，再把 argv[1] 换成解出来的入口 —— 后面两条路都不必知道容器这回事。
   * 程序看到的第一个参数仍是用户敲的那个容器名（argv0 传旧的那一个），
   * 所以里面的程序读 argv() 时看见的是「我被哪个容器叫起来的」，不是一个临时路径。 */
  if (是容器路径(argv[1])) {
    char *旧 = argv[1];
    char *入口 = 解容器(旧);
    if (!入口) return 1;
    argv[1] = 入口;
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
    /* 挑出来的是哪个入口，摊开之后才知道 —— 所以档位在这里再定一次。
     * 一个容器可以同时装 hmsnp 与 hmhsr，而跑的是被挑出来的那一个。 */
    回收从档位(入口);
#endif
    if (是源码路径(入口)) {
      int 码 = cli_main(argc, argv);
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
      if (g_种子临时[0]) remove(g_种子临时);
#endif
      return 码;
    }
    return run_bytecode(入口, 旧, argc - 2, argv + 2, 步限从环境(旧));
  }

  /* 两个入口：给一份源码时先编再跑（启动器那一面），给一份字节码时直接跑。
   * 判据是后缀 —— 别看文件内容去猜，猜错的时候症状比报错难查得多。 */
  {
    if (是源码路径(argv[1])) {
      int 码 = cli_main(argc, argv);
#if !defined(__arm__) && !defined(__ARM_ARCH) && !defined(__aarch64__)
      if (g_种子临时[0]) remove(g_种子临时);
#endif
      return 码;
    }
  }
  return run_bytecode(argv[1], argv[1], argc - 2, argv + 2, 步限从环境(argv[1]));
}
#endif  /* HMYR_BOARD：板子上这一份 main 不存在，入口是 port/board-main.c */
#endif  /* HMYR_LIB：库那一侧不要 main，要的是 hmyr_运行 */
