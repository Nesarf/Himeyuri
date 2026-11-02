# Run several things for real at the same time.
#
# Each line of the list file is one command (a raw command line). All of them
# are started with Start-Job at once, then waited on one by one -- they are
# already running, so the total time is about the longest one.
#
# Why the parallelism lives here and not in the language: the evaluator is
# synchronous, and waiting synchronously for asynchronous completion events
# would block the event loop (see design/CONCURRENCY.txt). So "start several
# at once" is handed to a process that already supports it -- borrow the
# capability, do not copy the implementation.
#
# ASCII ONLY, this line included. This script is run by powershell.exe 5.1,
# which reads a script in the current code page when the file has no BOM.
# A non-ASCII comment is then decoded as GBK byte pairs, and the second byte
# of a pair can land in the ASCII range -- a Chinese comment can turn into
# half a bracket, and the reported error points at param() (win.ps1 hit the
# same trap twice on 2026-11-02). Comments in English, no BOM needed.
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
# Written without a BOM: the JSON reader should not need an extra step for one,
# and UTF8Encoding($false) is exactly that.
# Wrapped as {items: [...]}: PowerShell prints a one-element array as an
# object rather than an array, and the reader should not have to guess twice.
# Wrapping makes the shape the same every time.
$json = [pscustomobject]@{ items = @($rows) } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($Out, $json, [System.Text.UTF8Encoding]::new($false))
"HMYR-PARALLEL $($rows.Count)"
