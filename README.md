# Himeyuri（HMYR）

一门通用语言的工作实现：把既有语言的长处收进来，做成一套自己说得清、验得动的形状。

## 现在有什么

```
src/            宿主：词法 · 语法 · 求值 · 编码 · 模块加载
self/           自举：词法与语法 · 语句与体 · 求值器 · 串起来那一件
bin/hmyr.mjs    启动器：node bin/hmyr.mjs <file.hmyr>
term.hmyr       终端：内置转义序列 · 画布 · 场景栈 · 帧循环 · 节拍 · 字形
shell*.hmyr     一行 shell：行编辑与历史 · 内建认法 · 执行 · 会话
surface.hmyr    表面：主表面与子表面合成 · 呈现后端
pixel.hmyr      像素布：写点 · 填矩形 · 导出 PNG
task.hmyr       任务树：取消父即取消子树
message.hmyr    邮箱：有界 · 先进先出 · 满则拒绝 · 空则说空
sched.hmyr      调度器：轮转 · 完成 · 取消 · 失败
parallel.hmyr   真并行：借外部能力
color.hmyr      颜色：两套具名策略 · 报告在语言里判定
json.hmyr       JSON 解析与取字段
glyphs.hmyr     大字形：数字 · 字母 · 标点
locale.hmyr     语言档案：四套（语言乘编码）
deps/           外部能力：颜色桥 · 编码表 · 表面后端
design/         设计：为什么这么做、边界在哪儿
test/           四十多套件
```

## 怎么跑

```
node tools/check-all.mjs                 # 全部套件
node bin/hmyr.mjs examples/hello.hmyr    # 用启动器跑一段程序
node examples/run-demo.mjs               # 终端动画
node examples/run-shell.mjs              # 一行 shell（需要真终端）
```

## 几条一直守着的规矩

- 每条断言都要可查；拒绝比猜好。
- 能力边界写在明处：做不到的说做不到，不装作支持。
- 谁动世界谁声明效果；输入与输出都要能被注入、被断言。
- 语言达不到就先补语言，不用替代品绕过去。
- 设计文档里写清学自哪里、改了什么。

## 许可

CZGD·PL-1.1，见 LICENSE。
