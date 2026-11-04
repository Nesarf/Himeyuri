# lib/ —— 这一门语言的标准库

十一个库，全部用这门语言自己写。引入即可：

    引入 "./lib/regex.hmoca"

**名字全带前缀**（`表_` `集_` `时_` `式_` …）。这一门语言的模块合并没有命名空间：
重名不报错，只把某个调用指到另一个函数。2026-11-04 那天 `self/wide.hmoca` 的 `乘二`
与 `self/f64.hmoca` 的 `乘二` 撞过一次，代价是 vmrun 二十二项里红了十八项 ——
所以新加的库一律带前缀。

每个库的头注释里写着它自己的边界（支持什么、不做什么、为什么）。这一页只做索引：
哪个库能干什么，以及**谁在验它**。

- interval.hmoca —— 区间数：一对双精度当上下界，按舍入方向取端点。判据：interval 套件
- json.hmoca —— JSON 的解析与生成。判据：json 套件
- maps.hmoca —— map 与 set，底是内置索引；键可以是任意字符串（这是它与 tables 的分界）。判据：maps 套件
- numbers.hmoca —— 整数与实数的常用函数。判据：numbers 套件
- protocol.hmoca —— 帧：长度前缀 + 类型字节 + 载荷，整数按小端写。判据：cvm 套件（跑 conformance/lib-protocol.hmoca）
- rational.hmoca —— 有理数：分子与分母各一个大整数。判据：rational 套件
- regex.hmoca —— 回溯正则：捕获组、懒惰量词、零宽断言；不认命名组与旗标。判据：regex 套件
- strings.hmoca —— 字符串库：用这门语言自己的内置写出来的常用函数。判据：cvm 套件（跑 conformance/lib-strings.hmoca）
- tables.hmoca —— 表库：拿记录当字典，键必须是标识符形状。判据：cvm 套件（跑 conformance/lib-tables.hmoca）
- time.hmoca —— 时间：毫秒 ↔ 年月日时分秒，ISO 8601 的一进一出；只做 UTC，时区交给调用方。判据：time 套件
- tuples.hmoca —— 元组：排序、反转、查找、求和、极值、子段。判据：cvm 套件（跑 conformance/lib-tuples.hmoca）

「判据」那一列写的是**跑得起来的那一条**：前七个各有自己的套件，后四个的探针挂在
c-vm 套件里 —— 它们在 C 机器上跑，因为那四个库是自举层与工具链自己反复用到的东西，
而 C 那台是最后一关。这一页不假装它们各有独立套件，也不因此少算它们有判据。

## 加一个新库时要做的三件事

1. 文件放 `lib/<名字>.hmoca`，头注释写清边界（支持什么、不做什么、为什么）；
2. 函数名带前缀，避免与已有库撞；
3. 在 `conformance/` 下写一个探针，在 `test/` 下写一个套件（或者明确挂到已有的套件上，
   并在这里那一行里写清挂在哪），然后回到这一页加一行 —— 这一页自己也有判据：
   `test/lib-index.test.mjs` 会核对「每个库都在这一页上」与「这一页上的每个库都存在」。
