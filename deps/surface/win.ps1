# HMYR 的 native 呈现后端：借 PowerShell 与 WPF 开一个真窗口。
#
# 为什么借而不自带：真窗口需要平台绑定，而本机已有 PowerShell 与 WPF。
# 这与颜色那条桥同一个做法——借能力，不复制实现。
#
#   powershell -NoProfile -STA -File deps/surface/win.ps1 -Width 640 -Height 400 -Text "..." -NoShow
#
# -NoShow 只验参数与管道，不弹窗；套件用它。真的看窗口要去掉这个开关。
param(
  [int]$Width = 640,
  [int]$Height = 400,
  [string]$Text = "",
  [string]$Image = "",
  [int]$ShowMs = 1200,
  [switch]$NoShow
)
Add-Type -AssemblyName PresentationFramework
$有图 = $Image -ne ""
$图宽 = 0
$图高 = 0
if ($有图) {
  $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
  $bmp.BeginInit()
  $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $bmp.UriSource = New-Object System.Uri((Resolve-Path $Image).Path)
  $bmp.EndInit()
  $图宽 = $bmp.PixelWidth
  $图高 = $bmp.PixelHeight
}
if ($NoShow) {
  "HMYR-SURFACE {""shown"":false,""width"":$Width,""height"":$Height,""text_len"":$($Text.Length),""image"":$有图,""image_w"":$图宽,""image_h"":$图高}"
  exit 0
}
$w = New-Object System.Windows.Window
$w.Title = "HMYR surface"
$w.Width = $Width
$w.Height = $Height
$w.Background = [System.Windows.Media.Brushes]::Black
if ($有图) {
  $img = New-Object System.Windows.Controls.Image
  $img.Source = $bmp
  $img.Stretch = "Uniform"
  $w.Content = $img
}
$tb = New-Object System.Windows.Controls.TextBlock
$tb.Text = $Text
$tb.Foreground = [System.Windows.Media.Brushes]::White
$tb.FontFamily = "Consolas"
$tb.FontSize = 18
$tb.Margin = "12"
if (-not $有图) { $w.Content = $tb }
$w.Show()
Start-Sleep -Milliseconds $ShowMs
$w.Close()
"HMYR-SURFACE {""shown"":true,""width"":$Width,""height"":$Height,""text_len"":$($Text.Length)}"
