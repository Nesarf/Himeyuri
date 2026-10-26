# Himeyuri（HMYR）

<img src="assets/himeyuri.png" width="160" alt="Himeyuri：一朵山丹">

一门通用语言的工作实现：同一份语义，既能当脚本立刻跑，也能拧到硬档进实时音频回调。
它的主张只有一句 —— 每一个论断都可被检验。

名字取自卍解所现之力：山丹（ヒメユリ，珊瑚百合）与火。在灰烬里也要开出一朵花。

## 看板娘

小一孁こはね（おひとめこはね）—— 乡村出身、憧憬都市的少女，卍解所现之力正是山丹与火，
也就是这门语言名字的来处。她负责门口的招呼，不进机房：错误信息、测试输出与数据本体里
不出现。形象卡、职责与界限见 [MASCOT.txt](MASCOT.txt)。

## 四台机器

这是这门语言最要紧的一处结构：同一份程序有四条执行路径，而它们必须给出同一个答案。

```
宿主求值器      src/eval.mjs          直接解释一棵语法树
最小求值器      src/minimal-eval.mjs  只认自举层用得到的那一部分（stage 0）
字节码机器      src/vm.mjs            编译成扁平的指令流再跑
C 机器          vm/hmyr.c             跑同一份字节码，不经过 JavaScript
```

自举层（`self/`）用 HMYR 自己写成，跑在最小求值器上；`bootstrap/pack.hmtn` 是它的种子，
`runtime/` 里是种子编出来的产物。第一条路径（宿主求值器）同时也是对照实现，
它存在的理由是「两台机器同一个答案」这一句要有东西可对。

## 现在有什么

```
src/            宿主：词法 · 语法 · 求值 · 编码 · 模块加载 · 静态检查器
self/           自举：词法与语法 · 语句与体 · 求值器 · 编译器 · 打包器
vm/             C 机器与种子头文件
bootstrap/      种子（.hmtn）
runtime/        种子编出来的产物（.hmoks）
bin/hmyr.mjs    启动器
tools/          工具：产物编译、静态检查、基准
conformance/    错误码表（70 个）与人话对照 · 符合性用例
test/           190 个套件
bench/          基准：解压 · 压缩 · 实时回调
examples/       示例
design/         45 份设计稿
data/ deps/     语料与外部能力
dist/           打包产物
```

语言本身的东西（`term.hmoca`、`shell*.hmoca`、`surface.hmoca`、`json.hmoca` 等）在根目录，
后缀是 `.hmoca`（源码）· `.hmoks`（字节码）· `.hmtn`（种子）· `.hmnkk`（一般文本）
· `.hmoug`（配置）· `.hmknst`（错误码与用例）· `.hmkit`（套件清单）· `.hmkgr`（乐曲与场景）
· `.hmbnso`（说明书）。九个扩展名的判据见 [SPEC.txt](SPEC.txt) 的 2.11。

## 怎么跑

```
node bin/hmyr.mjs examples/hello.hmoca          # 默认路径（自举层解释）
node bin/hmyr.mjs --host-eval examples/hello.hmoca
node bin/hmyr.mjs --compile examples/hello.hmoca
node tools/check-all.mjs                        # 全部套件
node tools/check-all.mjs --only owned,ffi       # 只跑几套
node bench/realtime.mjs --runs 5                # 实时回调的标尺
```

整个仓库是一堆源码，跑起来只需要 Node 与（可选的）一个 C 编译器。

## 现在的状态

三区模型、模块级名字、实时档位、与外面的窗口，四件事各有落地与边界。边界写在
[SPEC.txt](SPEC.txt) 与 [design/MEMORY.txt](design/MEMORY.txt) 里，这里只点一句：

```
区与所有权    arena / owned / managed 三区，四台一致；帧退出释放；装载时的四层静态检查
              （直行 · 分支合并 · 关之后用 · 按 own/borrow 判转移与借用闭包，单趟跨模块）
模块级名字    顶层 var 与 const 四台成立，const 不可重绑
实时档位      四条静态约束（禁分配 · 禁阻塞 · 有界循环 · 调用链闭合）加除零；
              C 那台的帧从栈上取，堆账少约九成；零停顿只在那一台成立
与外面        三个问题定了答案（语言分配 · 语言释放 · 显式编码过界）；
              bytes_view 是一段不拷贝的窗口，四台一致
```

## 几条一直守着的规矩

- 每条断言都要可查；拒绝比猜好。
- 能力边界写在明处：做不到的说做不到，不装作支持。
- 谁动世界谁声明效果；输入与输出都要能被注入、被断言。
- 语言达不到就先补语言，不用替代品绕过去。
- 设计文档里写清学自哪里、改了什么。

## 许可

CZGD·PL-1.1，见 [LICENSE](LICENSE)。
