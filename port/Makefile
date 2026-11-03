# 裸机那一侧的最小构建：把 VM、平台口、板侧入口与启动文件编成一颗映像。
#
# 两套芯片共用这一份：Nucleo-F411RE（Cortex-M4，默认）与桌上那块 H723ZG
# （Cortex-M7，make h723）。差别全落在旋钮上 —— CPU / FPU / STARTUP / UART /
# LDSCRIPT / OPENOCD_TARGET —— 源代码里一处在没有 #ifdef，理由与 port/ 里那几对
# 文件一样：换芯片时改的是「这几个数」，而一份文件里放两套最容易出的错是改了这边
# 忘了那边。
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

# 启动文件那一份：M4 与 M7 各一份 —— M7 那份多一段 FPU 使能（CPACR 的 CP10/CP11）。
STARTUP ?= startup_cm4_gnu.s

# 浮点：M4 留空（走软浮点，GNU 默认），M7 用 -mfpu=fpv5-d16 -mfloat-abi=hard。
# 硬浮点必须配 startup_cm7_gnu.s —— 少了那段 CPACR，第一条浮点指令就进 HardFault，
# 而症状是「程序跑到某处就不动了」，看上去像别的地方出了问题。
FPU     ?=

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

CFLAGS  := -mcpu=$(CPU) $(FPU) -mthumb -Os -g -Wall -Wextra -Wno-unused-parameter \
           -ffunction-sections -fdata-sections -fno-common -std=c11 \
           --specs=nosys.specs
# 链接脚本：板子是 link.ld（Flash 从 0x08000000），QEMU 的 MPS2 是 link-mps2.ld（从 0）。
LDSCRIPT ?= link.ld

LDFLAGS := -mcpu=$(CPU) $(FPU) -mthumb -T $(LDSCRIPT) --specs=nosys.specs -Wl,--gc-sections -Wl,-Map=$(TARGET).map

OBJS    := $(BUILD)/startup.o $(BUILD)/arm-port.o $(BUILD)/board-main.o \
           $(BUILD)/$(UART:.c=.o) $(BUILD)/hmyr.o $(BUILD)/program.o

# 编字节码用谁。默认 tools/emit-code.mjs —— 那条路整条是 JS 的（src/bytecode.mjs 编、
# src/code-file.mjs 写）。COMPILER=hmyr 时换成 tools/compile-hmyr.mjs：那边由
# self/compile.hmoca 编、self/pack.hmoca 落盘，node 只做启动。
#
# 为什么这个开关值得有（2026-10-30）：板子那条线的判据是「不依赖宿主单独运行」，
# 而默认这一条把「字节码从哪儿来」留在了 JS 侧 —— 执行不依赖宿主了，产出还依赖。
# 开关让同一个判据能覆盖那一步，而两条路产出的字节码在那个判据下必须跑出同样的字节。
COMPILER ?= js

ifeq ($(COMPILER),hmyr)
EMIT := tools/compile-hmyr.mjs
else
EMIT := tools/emit-code.mjs
endif

# 先编字节码，再把它打成对象：两段符号由 objcopy 给。
$(BUILD)/program.hmoks: ../$(PROGRAM)
	@mkdir -p $(BUILD)
	cd .. && $(NODE) $(EMIT) "$(PROGRAM)" "port/$(BUILD)/program.hmoks"

$(BUILD)/program.o: $(BUILD)/program.hmoks
	# 先 cd 进 build 再 objcopy：符号名由「objcopy 看到的路径」决定，
	# 传 build/program.hmoks 会得到 _binary_build_program_hmoks_start，
	# 而 board-main.c 那边等的是 _binary_program_hmoks_start —— 差一个目录名就链不上，
	# 而弱声明的症状是「字节码是空的」，看上去像程序自己没跑。
	cd $(BUILD) && $(OBJCOPY) -I binary -O elf32-littlearm -B arm \
	  --rename-section .data=.program,alloc,load,readonly,data,contents \
	  program.hmoks program.o

$(BUILD)/startup.o: $(STARTUP)
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -c $< -o $@

# port/ 里的每一份 .c 都走这一条：arm-port、board-main，以及任意一份串口。
#
# 用模式规则而不是一条一条列 —— 「加第三份串口」这件事刚发生过一次（uart-h723.c），
# 而列出写法漏掉它时报的是「No rule to make target 'build/uart-h723.o'」，
# 那句话看不出是 Makefile 漏了、还是文件根本没写。
#
# hmyr.o 不走这一条：它的源在 ../vm，而且要多一个 -DHMYR_BOARD。
$(BUILD)/%.o: %.c
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
	qemu-system-arm -M netduinoplus2 -kernel $(TARGET).elf -nographic -monitor none -serial stdio

# 桌面上跑同一份镜像，不必插板子：QEMU 的 MPS2（Cortex-M3）把串口写进文件，
# 工具等一个时限再收。它验逻辑，不验容量 —— 理由与两者的差别见 design/BOARD.txt 第十八节。
qemu-desktop: $(TARGET).elf
	cd .. && $(NODE) tools/qemu-board.mjs "port/$(TARGET).elf" --machine mps2

# 模拟器上验（Cortex-M3 的 MPS2：串口与链接脚本都换那一套）：
#   make qemu-mps2 PROGRAM=examples/hello.hmoca
#
# 它跑起来之后不会自己退出 —— 串口一直开着，要手动停（Ctrl-C）。
# 所以脚本里调它要带 timeout，否则会像「卡住」：
#   timeout 8 qemu-system-arm -M mps2-an385 -kernel build/hmyr-board.elf \
#     -nographic -monitor none -serial stdio
QEMU_MPS2_FLAGS := UART=uart-mps2.c LDSCRIPT=link-mps2.ld CPU=cortex-m3

qemu-mps2:
	$(MAKE) elf PROGRAM=$(PROGRAM) $(QEMU_MPS2_FLAGS)
	qemu-system-arm -M mps2-an385 -kernel $(TARGET).elf -nographic -monitor none -serial stdio

# 桌上那块 STM32H723ZG：Cortex-M7、1 MB Flash、512 KB AXI SRAM。
# H723_FLAGS 一处在源代码里都没有 —— 它改的全是旋钮。
H723_FLAGS := CPU=cortex-m7 STARTUP=startup_cm7_gnu.s UART=uart-h723.c \
              LDSCRIPT=link-h723.ld FPU="-mfpu=fpv5-d16 -mfloat-abi=hard"

# 只链、不烧：这一条在没有 ST-Link 的机器上也能跑完，产出 ELF 与 map，
# 于是「链接布局对不对」这件事不必等硬件。
h723:
	$(MAKE) elf PROGRAM=$(PROGRAM) $(H723_FLAGS)

h723-bin:
	$(MAKE) bin PROGRAM=$(PROGRAM) $(H723_FLAGS)

# 烧：这一条要 ST-Link 插上、且 OpenOCD 能看见它。
h723-flash:
	$(MAKE) flash PROGRAM=$(PROGRAM) $(H723_FLAGS) \
	  OPENOCD_TARGET=target/stm32h7x.cfg TARGET_CHIP=stm32h723zg

# 烧板子。三条路，看本机装了哪一件：
#
#   make flash                  OpenOCD（默认 —— 这块探针只有它通得过）
#   make flash PROBE=pyocd      pyocd（装了驱动也连不上，见 design/BOARD.txt 第七节）
#   make flash PROBE=st-flash   stlink 那一套
#
# OpenOCD 要显式 INIT 之后才能 reset —— 少了那一句会报 invalid command name "reset"。
PROBE       ?= openocd
PYOCD       ?= /e/DaShaoHuo/Python-managed/pythoncore-3.14-64/Scripts/pyocd.exe
OPENOCD     ?= openocd
TARGET_CHIP ?= stm32f411re
# OpenOCD 的目标配置也得跟着换：H7 那一族是 target/stm32h7x.cfg，F4 是 stm32f4x.cfg。
OPENOCD_TARGET ?= target/stm32f4x.cfg

flash: $(TARGET).elf
ifeq ($(PROBE),openocd)
	$(OPENOCD) -f interface/stlink.cfg -f $(OPENOCD_TARGET) \
	  -c "program $(TARGET).elf verify reset exit"
else ifeq ($(PROBE),pyocd)
	$(PYOCD) flash --target $(TARGET_CHIP) $(TARGET).elf
else
	st-flash --reset write $(TARGET).bin 0x08000000
endif

clean:
	rm -rf $(BUILD)

.PHONY: elf bin qemu qemu-mps2 qemu-desktop flash clean h723 h723-bin h723-flash
