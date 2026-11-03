/* Cortex-M7 的 GNU 启动文件：与 startup_cm4_gnu.s 只差两处，而两处都是「M7 才有的」。
 *
 * 一、开 FPU。CPACR 的 CP10 与 CP11 各占两位，全开是 0xF << 20。少了这三行，
 *     第一条 VMOV/VADD 就进 HardFault，而症状是「程序跑到某处就不动了」——
 *     它不报「没有 FPU」，只是不走了。M4 那份没有这一段，因为 GNU 的
 *     -mfloat-abi=soft 走软浮点、不碰这几位；而 M7 那份用 hard，就必须开。
 *
 * 二、.cpu 换成 cortex-m7。这一行决定汇编器认哪些指令（例如 dsb/isb 与 M7 的
 *     双精度浮点指令），写错时汇编期就会报，不必等到板上。
 *
 * 其余（向量表、.data 拷贝、.bss 清零、bl main、HardFault 那一句）与 M4 那份逐字相同，
 * 因为 Cortex-M 系列的复位流程是同一个形状。两份并存而不是加 #ifdef，理由与
 * port/ 里另外那几对一样：换芯片时改的是「这几行」，而一份文件里放两套最容易出的错
 * 是改了这边忘了那边。
 */
    .syntax unified
    .cpu cortex-m7
    .thumb

    .global __Vectors
    .section .isr_vector, "a", %progbits
    .type __Vectors, %object
__Vectors:
    .word _estack
    .word Reset_Handler
    .word 0                 /* 2: NMI */
    .word HardFault_Handler /* 3: HardFault */
    .space 4 * 12           /* 4..15：其余异常先留空，用到哪一个再补 */
    .size __Vectors, . - __Vectors

    .text
    .thumb_func
    .global Reset_Handler
    .type Reset_Handler, %function
Reset_Handler:
    /* 开 FPU：SCB->CPACR（0xE000ED88）的 CP10 与 CP11。这一句必须在任何浮点指令之前。 */
    ldr r0, =0xE000ED88
    ldr r1, [r0]
    orr r1, r1, #(0xF << 20)
    str r1, [r0]
    dsb
    isb

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

/* 硬错误：让它在串口上说一句话，然后停住。理由与 M4 那份同（见 startup_cm4_gnu.s）。
 *
 * 进来的时候栈可能已经不可信，所以这里不返回、也不再调别的东西。 */
    .thumb_func
    .global HardFault_Handler
    .type HardFault_Handler, %function
HardFault_Handler:
    bl hmyr_hard_fault
6:  b 6b
