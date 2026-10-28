/* MPS2-AN385（QEMU 的 Cortex-M3 开发板）的链接布局。
 *
 * 与 link.ld 只差三个数，而那三个数正是「换芯片时要改的东西」：
 *
 *   FLASH  0x00000000（MPS2 从 0 读向量表；STM32 是从 0x08000000）
 *   RAM    0x20000000，4 MB（MPS2 给得阔，而这不是要用的意思）
 *   _estack 0x20100000 —— 栈顶在 RAM 里往上 1 MB 处，留足余量
 *
 * 为什么这份单独写而不是在 link.ld 里开 #ifdef：链接脚本没有预处理器，
 * 而「一个文件两个地址」最容易出的错是改了这边忘了那边。两份文件、各自说明，
 * 比一份带开关的脚本诚实。
 *
 * 段的结构与 link.ld 完全一致 —— 若那一边加了段，这一边也要跟着加。
 */

ENTRY(Reset_Handler)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x00000000, LENGTH = 4M
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 4M
}

_estack = 0x20100000;

SECTIONS
{
  /* 向量表放最前：复位之后硬件从 0 读第一个字当栈顶，第二个字当入口。 */
  .isr_vector :
  {
    KEEP(*(.isr_vector))
  } > FLASH

  .text :
  {
    *(.text*)
    *(.rodata*)
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

  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } > RAM AT > FLASH
  _sidata = LOADADDR(.data);

  .bss :
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
  } > RAM

  end = .;
  _end = .;
}
