这些 ICC 色彩配置文件的来源与许可
====================================================================

来源：Elle Stone 的 well-behaved ICC profiles（GitHub: ellelstone/elles_icc_profiles）
取法：经本机代理从该仓库的 profiles 目录按名字挑选下载，2026-10-16。
许可：CC0 1.0（公有领域奉献）。可随本项目一起分发，不必署名，但这里记下来源，
      因为「集百家之长，成一己之胜」的第一条就是写明学自哪里。

为什么是这一批：它们按同一套原色与白点做成多种传递函数版本
（srgbtrc 表示 sRGB 的传递曲线，g10/g18 表示 gamma 1.0 与 1.8，labl 表示 L* 曲线），
于是同一个色域可以有多种编码，便于测试「有损率」到底是来自色域还是来自传递函数。

包含的空间：
  ・sRGB 变体（srgbtrc / g10 / g18 / labl）
  ・ACES 与 ACEScg（电影级的广色域）
  ・AllColorsRGB（覆盖全部真实颜色的超广色域）
  ・CIERGB（CIE 1931 RGB）
  ・ClayRGB（= AdobeRGB 兼容）
  ・Rec2020（UHD 电视的色域）

系统里另有两个（不在这里）：sRGB Color Space Profile.icm 与 RSWOP.icm（Agfa : Swop Standard，印刷用 CMYK）。
桥会同时扫描本目录与系统目录，所以往这里放新的 ICC 会自动出现在清单里。
