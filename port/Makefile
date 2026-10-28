# Cortex-M4 那一侧的最小构建：把 VM、平台口、板侧入口与启动文件编成一颗映像。
#
# 三个目标，各有各的用处：
#
#   make elf      链出 ELF（不烧，只看大小与符号）
#   make bin      同一个映像的原始二进制（QEMU 与 ST-Link 都吃这一种）
#   make qemu     在 QEMU 的 netduinoplus2（STM32F405，与 F411 同族）上跑
#
# 字节码用 objcopy 打成对象文件链进去，符号名由文件名决定 —— 与 board-main.c
# 文件头那条约定一致。所以要让程序换成别的，只改 PROGRAM 这一个变量。
#
# 工具链：MSYS2 的 ucrt64 双栈（pacman -S mingw-w64-ucrt-x86_64-arm-none-eabi-gcc）。
# 路径写死在这儿是因为这台机器就是这么装的；换机器时改 CROSS 一行即可。

CROSS   ?= /d/msys64/ucrt64/bin/arm-none-eabi-
# node 是 Windows 那一份，msys 的 PATH 里没有它 —— 写死路径比「记得先 export」可靠。
NODE    ?= /c/Program\ Files/nodejs/node.exe
# 串口那一份：板子是 uart.c（STM32 的 USART2），QEMU 上验是 uart-mps2.c（CMSDK UART）。
# 两者的差别只有寄存器布局，所以换的是文件，不是代码里的 #ifdef。
UART    ?= uart.c

# PROGRAM 是相对仓库根的名字 —— 不是相对 port/。理由：编字节码那一步要回仓库根，
# 而「相对谁」只该有一个答案。
PROGRAM ?= examples/hello.hmoca

CC      := $(CROSS)gcc
OBJCOPY := $(CROSS)objcopy
SIZE    := $(CROSS)size

BUILD   := build
TARGET  := $(BUILD)/hmyr-board

# 目标核：板子是 cortex-m4（Nucleo-F411RE），QEMU 的 mps2-an385 是 cortex-m3。
# 这一行不能只当「优化选项」看：M4 的 DSP 指令在 M3 上是未定义指令，
# 症状是 Undefined 异常 —— 而我们的向量表只有一个 Reset_Handler，于是变成 lockup。
CPU     ?= cortex-m4

CFLAGS  := -mcpu=$(CPU) -mthumb -Os -g -Wall -Wextra -Wno-unused-parameter \
           -ffunction-sections -fdata-sections -fno-common -std=c11 \
           --specs=nosys.specs
# 链接脚本：板子是 link.ld（Flash 从 0x08000000），QEMU 的 MPS2 是 link-mps2.ld（从 0）。
LDSCRIPT ?= link.ld

LDFLAGS := -mcpu=$(CPU) -mthumb -T $(LDSCRIPT) --specs=nosys.specs -Wl,--gc-sections -Wl,-Map=$(TARGET).map

OBJS    := $(BUILD)/startup.o $(BUILD)/arm-port.o $(BUILD)/board-main.o \
           $(BUILD)/$(UART:.c=.o) $(BUILD)/hmyr.o $(BUILD)/program.o

# 先编字节码，再把它打成对象：两段符号由 objcopy 给。
$(BUILD)/program.hmoks: ../$(PROGRAM)
	@mkdir -p $(BUILD)
	cd .. && $(NODE) tools/emit-code.mjs "$(PROGRAM)" "port/$(BUILD)/program.hmoks"

$(BUILD)/program.o: $(BUILD)/program.hmoks
	# 先 cd 进 build 再 objcopy：符号名由「objcopy 看到的路径」决定，
	# 传 build/program.hmoks 会得到 _binary_build_program_hmoks_start，
	# 而 board-main.c 那边等的是 _binary_program_hmoks_start —— 差一个目录名就链不上，
	# 而弱声明的症状是「字节码是空的」，看上去像程序自己没跑。
	cd $(BUILD) && $(OBJCOPY) -I binary -O elf32-littlearm -B arm \
	  --rename-section .data=.program,alloc,load,readonly,data,contents \
	  program.hmoks program.o

$(BUILD)/startup.o: startup_cm4_gnu.s
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD)/arm-port.o: arm-port.c
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -I../vm -c $< -o $@

$(BUILD)/board-main.o: board-main.c
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -I../vm -c $< -o $@

# 两条串口来源，同一个目标文件：UART 变量说这一轮换哪一份进来。
$(BUILD)/uart.o: uart.c
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -I../vm -c $< -o $@

$(BUILD)/uart-mps2.o: uart-mps2.c
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -I../vm -c $< -o $@

$(BUILD)/hmyr.o: ../vm/hmyr.c
	@mkdir -p $(BUILD)
	# HMYR_BOARD 关掉 vm/hmyr.c 自己的 main —— 板侧的入口在 board-main.c。
	$(CC) $(CFLAGS) -DHMYR_BOARD -I../vm -c $< -o $@

elf: $(TARGET).elf

$(TARGET).elf: $(OBJS)
	$(CC) $(LDFLAGS) -o $@ $(OBJS) -lm
	$(SIZE) $@

bin: $(TARGET).bin

$(TARGET).bin: $(TARGET).elf
	$(OBJCOPY) -O binary $< $@

qemu: $(TARGET).elf
	qemu-system-arm -M netduinoplus2 -kernel $(TARGET).elf -nographic -serial stdio

clean:
	rm -rf $(BUILD)

.PHONY: elf bin qemu clean
