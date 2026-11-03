/* Cortex-M7（STM32H723ZG）的 GNU ld 链接脚本。与 link.ld 的差别只有四个数，
 * 而四个数都是「换芯片时要改的」：
 *
 *   Flash 0x08000000  1024 KB   H723ZG 是 1 MB（旧板 F411RE 是 512 KB）
 *   RAM   0x24000000   512 KB   用 AXI SRAM，不用 0x20000000 的 DTCM
 *   栈顶  0x24080000              AXI SRAM 的上界
 *   堆    64 KB                  旧板是 32 KB
 *
 * 为什么选 AXI SRAM 而不是 DTCM：DTCM 只有 128 KB，而 board-main.c 那条路上
 * 一次自编译在旧板撞墙时 live 是 68102 字节 —— 差得不多，正好是「能跑一份程序、
 * 跑不了第二份」那种紧。AXI SRAM 是 512 KB，也是这一颗上唯一既大、又能被 CPU
 * 与 DMA 同时看见的一块（DTCM 只挂在 CPU 的 D 总线上，DMA 看不见）。
 *
 * 一个已知的代价：AXI SRAM 的访问延迟比 TCM 高。要是将来栈深成为瓶颈，
 * 正确做法是把 .stack 单独放到 DTCM 去（两段 RAM 各挂一个区），而不是整块搬回去 ——
 * 那样既能拿到 TCM 的速度，又不必把 512 KB 丢掉。今天不做，因为还没有量到那一步。
 *
 * 换芯片时改的是这四个数，外加下面 _estack 与两处固定地址。
 */

ENTRY(Reset_Handler)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1024K
  RAM   (rwx) : ORIGIN = 0x24000000, LENGTH = 512K
}

/* _estack 不在这里写死，而是等于 .stack 段的末尾（见文件末尾那一行）。
 *
 * 旧板的 link.ld 把它写成 0x20020000，而 .stack 段落在 0x2001A000 —— 两块不重合，
 * 于是「栈顶」与「栈段」指的是不同地方：真正生效的是向量表的第一个字（_estack），
 * 而 .stack 段只是白占 8 KB、没有任何东西用它。旧板那样是验过能跑的，所以那边没动；
 * 这一份从写对开始 —— 让两者不可能不一致，代价只是多一行。 */

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
    /* 板子上要跑的那份字节码：由 objcopy 把 program.hmoks 打成一个对象文件，
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

  /* 堆与栈只占位置，不占文件。写死地址是为了让「.bss 长过头」变成链接期的错，
   * 而不是运行期的 HardFault。 */
  .heap (NOLOAD) :
  {
    . = ALIGN(8);
    _heap_start = .;
    /* newlib 的 _sbrk 找的是这个不带下划线的 end —— 少了它，链接会停在
     * 「undefined reference to `end'」上，而那句话看不出跟堆有关。 */
    PROVIDE(end = .);
    PROVIDE(_end = .);
    . = . + 0x10000;           /* 64 KB */
    _heap_end = .;
  } > RAM

  .stack (NOLOAD) :
  {
    . = ALIGN(8);
    _stack_start = .;
    /* 64 KB。旧板是 8 KB，而那一块在自举层装载时就撞过墙（BOARD.txt 记的
     * 「栈溢出、pc 0x00000000、msp 0x1ffff828」）。H7 还多一层硬浮点：一次中断
     * 要压 S0-S15 与 FPSCR，同一段代码在 M7 上吃的栈比 M4 多。512 KB 的 RAM
     * 给得起，没必要省。 */
    . = . + 0x10000;
    _stack_end = .;
  } > RAM
}

/* 栈顶就是栈段的末尾。写这一行而不是把地址写死在上头，是为了让「栈顶」与「栈段」
 * 不可能不一致 —— 不一致的症状是「中断一来就进 HardFault」，而没人会想到去看链接脚本。 */
_estack = _stack_end;
