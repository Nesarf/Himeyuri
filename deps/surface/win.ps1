# HMYR's native presentation backend: it borrows PowerShell and WPF to open a real window.
#
# Why borrow instead of shipping our own: a real window needs a platform binding, and this
# machine already has PowerShell and WPF. Same approach as the colour bridge - borrow the
# capability, do not copy the implementation.
#
#   powershell -NoProfile -STA -File deps/surface/win.ps1 -Width 640 -Height 400 -Text "..." -NoShow
#
# -NoShow only checks the arguments and the pipe; the suites use it. Drop the switch to
# actually look at the window.
#
# 2026-11-02: from "open, show for a while, close" to a session. Three new parameters:
#   -EventMs   how long the message loop runs, in milliseconds. 0 is the old behaviour:
#              sleep for ShowMs and close.
#   -Events    injected events, semicolon-separated (key:A, mouse:10,20). Test-only, the
#              same nature as -NoShow: it gives automation a way to check this without a
#              human pressing keys. Events the real window receives go into the same list,
#              so this may be left empty when a person is watching.
#              Semicolons between events, not commas: a comma also separates the two
#              coordinates, so mixing them split mouse:10,20 into three pieces, the second
#              of which had no colon- and y silently came back as 0.
#   -Frames    frame interval in milliseconds. Text holds the frames separated by vertical
#              bars; they cycle. 0 means no change.
#
# The receipt is still one line of JSON, with two more lists: events and frames.
#
# THIS FILE IS ASCII ONLY - comments included, not just identifiers. Reason: powershell.exe
# 5.1 reads a file in the current code page, so without a BOM every Chinese character is
# mis-decoded, and the second byte of a GBK pair may land inside the ASCII range. A harmless
# comment then produces a stray ')' or quote and the whole script fails to parse - the error
# points at param() and says nothing about the comment that broke it. Identifiers were ASCII
# already on 2026-11-02; the comments followed after that failure.
param(
  [int]$Width = 640,
  [int]$Height = 400,
  [string]$Text = "",
  [string]$Image = "",
  [int]$ShowMs = 1200,
  [int]$EventMs = 0,
  [string]$Events = "",
  [int]$Frames = 0,
  [switch]$NoShow
)

# The event list: a kind plus its own fields. Injected and really-received events both land
# here, so the receipt has exactly one shape.
$eventList = New-Object System.Collections.ArrayList
foreach ($piece in $Events.Split(";")) {
  $piece = $piece.Trim()
  if ($piece -eq "") { continue }
  $parts = $piece.Split(":")
  if ($parts.Count -lt 2) { continue }
  if ($parts[0] -eq "key") {
    [void]$eventList.Add(@{ kind = "key"; value = $parts[1] })
  } elseif ($parts[0] -eq "mouse") {
    $xy = $parts[1].Split(",")
    [void]$eventList.Add(@{ kind = "mouse"; x = [int]$xy[0]; y = [int]$xy[1] })
  }
}

Add-Type -AssemblyName PresentationFramework
$hasImage = $Image -ne ""
$imageW = 0
$imageH = 0
if ($hasImage) {
  $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
  $bmp.BeginInit()
  $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $bmp.UriSource = New-Object System.Uri((Resolve-Path $Image).Path)
  $bmp.EndInit()
  $imageW = $bmp.PixelWidth
  $imageH = $bmp.PixelHeight
}

$frameTexts = @($Text.Split("|"))
$report = {
  param($shown, $shownFrames)
  "HMYR-SURFACE " + (@{
    shown    = $shown
    width    = $Width
    height   = $Height
    text_len = $Text.Length
    image    = $hasImage
    image_w  = $imageW
    image_h  = $imageH
    frames   = $shownFrames
    events   = @($eventList)
  } | ConvertTo-Json -Compress -Depth 6)
}

if ($NoShow) {
  # Without a window there is no time to change frames in, so this reports how many changes
  # would have happened: the frame count minus one. Not a lie, it is the NoShow convention.
  $planned = 0
  if ($Frames -gt 0 -and $frameTexts.Count -gt 1) { $planned = $frameTexts.Count - 1 }
  & $report $false $planned
  exit 0
}

$w = New-Object System.Windows.Window
$w.Title = "HMYR surface"
$w.Width = $Width
$w.Height = $Height
$w.Background = [System.Windows.Media.Brushes]::Black

if ($hasImage) {
  $img = New-Object System.Windows.Controls.Image
  $img.Source = $bmp
  $img.Stretch = "Uniform"
  $w.Content = $img
}
$tb = New-Object System.Windows.Controls.TextBlock
$tb.Text = $frameTexts[0]
$tb.Foreground = [System.Windows.Media.Brushes]::White
$tb.FontFamily = "Consolas"
$tb.FontSize = 18
$tb.Margin = "12"
if (-not $hasImage) { $w.Content = $tb }

# Two real handlers: a key and a click. Injected events are already in the list; these add
# what the window itself receives, so "injected" and "received" look the same in the receipt.
$w.Add_KeyDown({
  param($sender, $e)
  [void]$eventList.Add(@{ kind = "key"; value = $e.Key.ToString() })
})
$w.Add_MouseDown({
  param($sender, $e)
  $pos = $e.GetPosition($w)
  [void]$eventList.Add(@{ kind = "mouse"; x = [int]$pos.X; y = [int]$pos.Y })
})

$w.ShowActivated = $false
$w.Show()
$pump = [System.Windows.Threading.Dispatcher]::CurrentDispatcher
$shownFrames = 0

if ($EventMs -le 0) {
  # The old behaviour: sleep for ShowMs and close, with no message loop - which is why a
  # click on that window is never received. Kept because it is the cheapest path and
  # "just take a look" is a common use.
  Start-Sleep -Milliseconds $ShowMs
  # Nothing pumped while sleeping; do it once here, or the window shows as not responding.
  $pump.Invoke([System.Windows.Threading.DispatcherPriority]::Background, [action]{})
} else {
  # A session: pump every 10 ms and close when the time is up. Frame changes ride the same
  # clock, so frames and events share one timeline instead of two loops fighting for the window.
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $nextFrame = $Frames
  while ($clock.ElapsedMilliseconds -lt $EventMs) {
    $pump.Invoke([System.Windows.Threading.DispatcherPriority]::Background, [action]{})
    Start-Sleep -Milliseconds 10
    if ($Frames -gt 0 -and $frameTexts.Count -gt 1 -and $clock.ElapsedMilliseconds -ge $nextFrame) {
      $shownFrames = $shownFrames + 1
      $tb.Text = $frameTexts[$shownFrames % $frameTexts.Count]
      $nextFrame = $nextFrame + $Frames
    }
  }
}

$w.Close()
& $report $true $shownFrames
