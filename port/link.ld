/* Cortex-M4 的 GNU ld 链接脚本：与 link.sct 同一份布局，只是换了一种脚本语言。
 *
 * 两份并存不是懒：armlink 认 scatter，GNU ld 认这一份。改布局时改的是同一组数字 ——
 * 地址、大小、栈与堆 —— 所以两份要一起改。只改一份的症状是「换工具链之后行为不一样」，
 * 而那种症状很难看出是链接的事。
 *
 * 布局（与 link.sct 一致）：
 *   Flash 0x08000000  512 KB   向量表最先，然后只读段（四张 Unicode 表在这里）
 *   RAM   0x20000000  112 KB   .data 与 .bss
 *   栈顶  0x2001C000 向下 8 KB
 *   堆    0x20010000 起 32 KB
 *
 * 换芯片时改的是这四个数，外加下面 _estack 与两处固定地址。
 */

ENTRY(Reset_Handler)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 512K
  /* 2026-11-01 改：112K → 128K。F411RE 的 SRAM 是 0x20000000 起 128 KB，
   * 而这一份先前只切到 0x2001C000 —— 十六 KB 一直躺在那里没人用。
   * 自编译在板子上撞墙时 live 是 68102，把这一段拿回来就不必再省。 */
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
}

/* 栈顶与 link.sct 里 ARM_LIB_STACK 那一条同源：
 * start 0x2001C000、向下 8 KB。两处不一致时，症状是「中断一来就进 HardFault」，
 * 而没人会想到去看链接脚本。 */
_estack = 0x20020000;

SECTIONS
{
  /* 向量表放最前：复位之后硬件从 0x08000000 读第一个字当栈顶，第二个字当入口。 */
  .isr_vector :
  {
    KEEP(*(.isr_vector))
  } > FLASH

  .text :
  {
    *(.text*)
    *(.rodata*)
    /* 板子上要跑的那份字节码：由 objcopy 把 program.hmyrb 打成一个对象文件，
     * 段名约定成 .program。它唯一的引用者是 board-main.c 里的弱声明，而弱引用
     * 拦不住 --gc-sections —— 少了这一句 KEEP，字节码会被安静地回收掉，
     * 映像照样链得过、照样烧得进，跑起来却报「读不到文件」。 */
    KEEP(*(.program))
    KEEP(*(.init))
    KEEP(*(.fini))
    . = ALIGN(4);
  } > FLASH

  .ARM.extab : { *(.ARM.extab* .gnu.linkonce.armextab.*) } > FLASH
  .ARM.exidx :
  {
    __exidx_start = .;
    *(.ARM.exidx*)
    __exidx_end = .;
  } > FLASH

  /* .data 在 RAM 里运行，但初值要从 Flash 拷 —— 启动文件用的就是 _sidata。 */
  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } > RAM AT > FLASH
  _sidata = LOADADDR(.data);

  .bss (NOLOAD) :
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
  } > RAM

  /* 堆与栈只占位置，不占文件。两处地址与 link.sct 里那两块 EMPTY 区一一对应：
   * 堆从 0x20010000 起 32 KB，栈从 0x2001A000 到 0x2001C000。
   * 写死地址是为了与 scatter 那份对齐 —— 顺带也成了检查：.bss 若长过 64 KB，
   * ld 会在这里报段重叠，那正是我们想早一点知道的事。 */
  .heap (NOLOAD) :
  {
    . = ALIGN(8);
    _heap_start = .;
    /* newlib 的 _sbrk 找的是这个不带下划线的 end —— 少了它，链接会停在
     * 「undefined reference to `end'」上，而那句话看不出跟堆有关。 */
    PROVIDE(end = .);
    PROVIDE(_end = .);
    . = . + 0x8000;            /* 32 KB */
    _heap_end = .;
  } > RAM

  .stack (NOLOAD) :
  {
    . = ALIGN(8);
    _stack_start = .;
    . = . + 0x2000;            /* 8 KB */
    _stack_end = .;
  } > RAM
}
