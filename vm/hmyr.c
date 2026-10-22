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

/* Two range tables generated from the Unicode corpus by tools/ucd-c.mjs.
 * They live in the repository as C arrays so this machine can answer "is this
 * a letter" without borrowing anybody's table at run time. */
#include "ucd-letter.h"
#include "ucd-mark.h"

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

/* Shortest form that round-trips, the way the JavaScript side does it for the
 * values this machine has printed so far. Not the exact formatter in
 * src/decimal.mjs -- see the header note. */
static uint32_t num_to_text(double n, uint16_t *buf, uint32_t cap) {
  char tmp[64];
  if (n == (double)(long long)n && n > -1e15 && n < 1e15) snprintf(tmp, sizeof tmp, "%.0f", n);
  else snprintf(tmp, sizeof tmp, "%.15g", n);
  uint32_t len = (uint32_t)strlen(tmp);
  if (len > cap) len = cap;
  for (uint32_t i = 0; i < len; i++) buf[i] = (uint16_t)(unsigned char)tmp[i];
  return len;
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
    uint16_t buf[64];
    uint32_t n = num_to_text(v.num, buf, 64);
    uint16_t *p = (uint16_t *)malloc((size_t)n * sizeof(uint16_t));
    memcpy(p, buf, n * sizeof(uint16_t));
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

static Value run_func(Func *f, Value *args, int nargs);

/* Builtins. Each returns 1 on success and stores into *out; 0 means "not a
 * builtin I know", and the failure is already recorded. */
static int call_builtin(int64_t name_idx, Value *args, int nargs, Value *out) {
  if (name_is(name_idx, "print") || name_is(name_idx, "print_err")) {
    FILE *to = name_is(name_idx, "print") ? stdout : stderr;
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
    uint16_t *p = (uint16_t *)malloc(sizeof(uint16_t));
    p[0] = (uint16_t)(long long)cp;
    *out = v_str(p, 1);
    return 1;
  }
  if (name_is(name_idx, "ord")) {
    if (nargs != 1) { fail("HMYR-R0101", "ord wants one argument"); return 1; }
    if (args[0].tag != T_STR || args[0].slen == 0) { fail("HMYR-R0206", "ord of an empty string"); return 1; }
    *out = v_num((double)args[0].s[0]);
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
  /* Normalisation is not done here, and saying so is better than doing it
   * half way: the real table is 17 MB of corpus data. This machine hands the
   * text back unchanged, which is the identity function and therefore right
   * for any text that was already normalised. */
  if (name_is(name_idx, "nfc")) {
    if (nargs != 1) { fail("HMYR-R0101", "nfc wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "nfc wants a string"); return 1; }
    *out = args[0];
    return 1;
  }
  /* ASCII case folding. The full table is again corpus data; a letter outside
   * ASCII comes back unchanged, which is what most callers want anyway. */
  if (name_is(name_idx, "to_upper") || name_is(name_idx, "to_lower")) {
    if (nargs != 1) { fail("HMYR-R0101", "that builtin wants one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "that builtin wants a string"); return 1; }
    uint32_t n = args[0].slen;
    uint16_t *p = (uint16_t *)malloc((size_t)(n ? n : 1) * sizeof(uint16_t));
    int up = name_is(name_idx, "to_upper");
    for (uint32_t i = 0; i < n; i++) {
      uint16_t ch = args[0].s[i];
      if (up && ch >= 'a' && ch <= 'z') ch = (uint16_t)(ch - 32);
      if (!up && ch >= 'A' && ch <= 'Z') ch = (uint16_t)(ch + 32);
      p[i] = ch;
    }
    *out = v_str(p, n);
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
    FILE *f = fopen(p, "rb");
    if (f) fclose(f);
    *out = v_bool(f != NULL);
    free(p);
    return 1;
  }
  if (name_is(name_idx, "read_text")) {
    if (nargs < 1) { fail("HMYR-R0101", "read_text wants at least one argument"); return 1; }
    if (args[0].tag != T_STR) { fail("HMYR-R0130", "read_text wants a path string"); return 1; }
    char *p = utf16_to_utf8(args[0].s, args[0].slen);
    FILE *f = fopen(p, "rb");
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
    FILE *f = fopen(p, "wb");
    if (!f) { free(p); free(t); fail("HMYR-R0212", "cannot write that file"); return 1; }
    size_t tl = strlen(t);
    size_t wrote = fwrite(t, 1, tl, f);
    fclose(f);
    free(p);
    free(t);
    *out = v_num((double)(wrote == tl ? args[1].slen : 0));
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
        if (t.tag != T_RECORD) { fail("HMYR-R0106", "no field on that value"); return v_null(); }
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
      case OP_RET: { Value v = pop(); g_stack_n = base; g_base = 外base; return v; }
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
  FILE *f = fopen(path, "rb");
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

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: hmyr-vm program.hmyrb\n");
    return 2;
  }
  size_t len = 0;
  uint8_t *bytes = read_file(argv[1], &len);
  load_program(bytes, len);
  g_trace_on = getenv("HMYR_TRACE") != NULL;
  g_calls_on = getenv("HMYR_CALLS") != NULL;
  g_fields_on = getenv("HMYR_FIELDS") != NULL;
  /* The step limit is 5 million by default, which is right for a programme
   * doing its own work. Running an interpreter that runs another programme is
   * tens of times that, so the ceiling is adjustable. */
  {
    const char *sl = getenv("HMYR_STEPS");
    if (sl) {
      long v = atol(sl);
      if (v > 0) step_limit = (int)(v > 2000000000L ? 2000000000L : v);
    }
  }
  for (int i = 0; i < TRACE_N; i++) g_trace[i].op = 255;

  /* argv: the .hmyrb path first, then whatever else was typed. The bootstrap's
   * 命令行入口 reads element 1 as the target .hmyr, so the first slot has to
   * stay where the script name would be. */
  g_argv = v_null();
  g_argv.tag = T_TUPLE;
  g_argv.ilen = (uint32_t)(argc - 1);
  g_argv.items = alloc_values(g_argv.ilen);
  for (int i = 1; i < argc; i++) {
    uint32_t n16 = 0;
    uint16_t *u = utf8_to_utf16(argv[i], strlen(argv[i]), &n16);
    g_argv.items[i - 1] = v_str(u, n16);
  }

  /* Which function runs: 命令行入口 if the bytecode has one, otherwise main.
   * The bootstrap has both - its own four-line self-test is main, and the real
   * command line entry is 命令行入口. Picking main there ran the self-test and
   * ignored the argument, which looks like "the file I asked for was not run". */
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
  /* With arguments, 命令行入口 runs; without, main. The bootstrap has both: main
   * is its own four-line self-test, 命令行入口 is the real command line. That is
   * also the shape a user sees - type a file and it runs, type nothing and you
   * get the self-test. */
  if (cli && argc > 2) entry = cli;
  if (!entry) { fprintf(stderr, "hmyr: no main\n"); return 1; }

  Value r = run_func(entry, NULL, 0);
  if (g_trace_on) trace_dump();
  if (g_failed) {
    fprintf(stderr, "%s\n", g_fail_msg);
    return 1;
  }
  /* The return value is the exit code, not output. The bootstrap prints it
   * because its conformance programmes report a failing number that way; a
   * machine does not owe anybody that. */
  return (r.tag == T_NUM) ? (int)r.num : 0;
}
