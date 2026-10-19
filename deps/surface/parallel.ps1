# 真的同时跑几件事。
#
# 列表文件的每一行是一条命令（原样的命令行）。用 Start-Job 同时起，
# 然后逐条等——而它们已经在跑了，所以总时间约等于最长的那一条。
#
# 为什么并行发生在这里而不是在语言里：语言的求值器是同步的，
# 同步等异步的完成事件会把事件循环堵死（见 design/CONCURRENCY.txt 的补记）。
# 所以「同时起几个」交给一个本来就支持并行的进程——借能力，不复制实现。
param(
  [string]$List,
  [string]$Out,
  [int]$TimeoutSec = 30
)
$jobs = @()
foreach ($line in Get-Content -LiteralPath $List -Encoding UTF8) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $job = Start-Job -ScriptBlock { param($c) Invoke-Expression $c } -ArgumentList $line
  $jobs += [pscustomobject]@{ Cmd = [string]$line; Job = $job; Start = (Get-Date) }
}
$rows = @()
foreach ($j in $jobs) {
  $waited = Wait-Job -Job $j.Job -Timeout $TimeoutSec
  $state = "$($j.Job.State)"
  $output = ""
  if ($state -eq "Completed") { $output = ((Receive-Job -Job $j.Job) -join "`n") }
  $ms = [int]((Get-Date) - $j.Start).TotalMilliseconds
  $rows += [pscustomobject]@{ cmd = $j.Cmd; state = $state; output = $output; ms = $ms }
  Remove-Job -Job $j.Job -Force
}
# 无 BOM 写：JSON 读取端不该为了 BOM 多一步，而 UTF8Encoding($false) 正好不写 BOM。
# 包一层 {items: [...]}：PowerShell 对只有一项的数组会输出成对象而不是数组，
# 而读取端不该为此猜两次。包一层之后形状永远确定。
$json = [pscustomobject]@{ items = @($rows) } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($Out, $json, [System.Text.UTF8Encoding]::new($false))
"HMYR-PARALLEL $($rows.Count)"
