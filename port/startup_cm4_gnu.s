/* Cortex-M4 的 GNU 启动文件：向量表、复位入口、以及那一小段拷贝与清零。
 *
 * 与 startup_cm4.s 只差一处：那边一句 `bl __main` 把 .data 的拷贝与 .bss 的清零
 * 交给 Arm C 库的启动例程，而 GNU 工具链里没有 __main。所以这里自己写那两段，
 * 写完再调 main。
 *
 * 用到的符号（_estack / _sidata / _sdata / _edata / _sbss / _ebss）全部由
 * port/link.ld 给出 —— 脚本与启动文件是一对，缺一个链接就会说出名字。
 *
 * 两份启动文件与两份链接脚本并存是同一个理由：换工具链换的是这两件，
 * 换布局换的是脚本里的数字。
 */
    .syntax unified
    .cpu cortex-m4
    .thumb

    .global __Vectors
    .section .isr_vector, "a", %progbits
    .type __Vectors, %object
__Vectors:
    .word _estack
    .word Reset_Handler
    .space 4 * 14           /* 其余异常：先留空，用到哪一个再补 */
    .word 0
    .size __Vectors, . - __Vectors

    .text
    .thumb_func
    .global Reset_Handler
    .type Reset_Handler, %function
Reset_Handler:
    /* 把 .data 的初值从 Flash 拷进 RAM：源 _sidata，目标 _sdata.._edata */
    ldr r0, =_sdata
    ldr r1, =_edata
    ldr r2, =_sidata
1:  cmp r0, r1
    bcs 2f
    ldr r3, [r2], #4
    str r3, [r0], #4
    b 1b
2:  /* 把 .bss 清零：_sbss.._ebss */
    ldr r0, =_sbss
    ldr r1, =_ebss
    movs r3, #0
3:  cmp r0, r1
    bcs 4f
    str r3, [r0], #4
    b 3b
4:  bl main
5:  b 5b                      /* main 返回就停在这里 —— 裸机上没有「退出去」这回事 */

    .ltorg                    /* ldr =符号 的字面量池落在这里，不落在代码中间 */
