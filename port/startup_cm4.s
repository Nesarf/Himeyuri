/* Cortex-M4 的最小启动文件：向量表、复位入口。
 *
 * 复位之后做的事只有一句 `bl __main`：那是 Arm C 库（或 microlib）的启动例程，
 * 它负责把 .data 从 Flash 拷到 RAM、把 .bss 清零、设好堆栈，然后调 main。
 * 自己写拷贝循环也行，但那几段与链接脚本里的符号名绑得很紧，
 * 用库那一份反而更稳 —— 链接脚本里只要给 ARM_LIB_STACK 与 ARM_LIB_HEAP。
 *
 * 汇编用 GNU 语法（armclang 收的那一种），不是 Keil armasm 的老语法。
 */
    .syntax unified
    .cpu cortex-m4
    .thumb

    /* 这个文件存的是函数地址（向量表），而函数按 AAPCS 要求 8 字节对齐的栈。
     * 不声明这一条，armlink 会警告「向量表所在的段可能不保留 8 字节对齐」——
     * 那不是我们的段不保留，而是它不知道我们保留。这一行就是回答它。 */
    .eabi_attribute 25, 1

    /* 栈顶。与 link.sct 里的 ARM_LIB_STACK 同一条边界：
     * 那边写 0x2001C000 向下 8 KB，这边给同一个顶。两处不一致时，
     * 症状是「中断一来就进 HardFault」，而没人会想到去看链接脚本。 */
    .equ __initial_sp, 0x2001C000

    .global __Vectors
    .section .isr_vector, "a", %progbits
    .type __Vectors, %object
__Vectors:
    .word __initial_sp          /* 栈顶，由链接脚本里的 ARM_LIB_STACK 给出 */
    .word Reset_Handler
    .space 4 * 14               /* 其余异常：先留空，用到哪一个再补 */
    .word 0
    .size __Vectors, . - __Vectors

    .text
    .thumb_func
    .global Reset_Handler
    .type Reset_Handler, %function
Reset_Handler:
    bl __main                   /* 拷 .data、清 .bss、调 main */
1:  b 1b                        /* main 返回就停在这里 */
    .size Reset_Handler, . - Reset_Handler

    .end
