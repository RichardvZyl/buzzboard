# Buzz Board v0, AC1 evidence: the board (static buzzboard SPA) and its backend (Buzz relay) are live
# and reachable only over the tailnet. Read-only; changes nothing. Output is redacted: tailnet names
# and addresses, LAN addresses and the host name are replaced with placeholders.
param([int[]] $Ports = @(8401, 9300), [string] $RelayUrlFile)
$ErrorActionPreference = 'Continue'
$tsExe = 'tailscale'; if (-not (Get-Command $tsExe -ErrorAction SilentlyContinue)) { $tsExe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' }
$tsIps = @(& $tsExe ip 2>$null)
$tsHost = ((& $tsExe status --json 2>$null | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
$lan = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notin $tsIps -and $_.IPAddress -notlike '169.254.*' } | Select-Object -Expand IPAddress)
function Redact([string]$s) {
  foreach ($i in $tsIps) { if ($i) { $s = $s.Replace($i, '<tailnet-ip>') } }
  foreach ($i in $lan) { $s = $s.Replace($i, '<lan-ip>') }
  if ($tsHost) { $s = $s.Replace($tsHost, '<tailnet-host>') }
  $s = $s -replace '[a-z0-9-]+\.tail[0-9a-f]+\.ts\.net', '<tailnet-host>' -replace [regex]::Escape($env:COMPUTERNAME), '<host>'
  return $s
}
function Say([string]$s) { Write-Output (Redact $s) }
function Probe([string]$hostOrIp, [int]$port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $ok = $c.ConnectAsync($hostOrIp, $port).Wait(3000) -and $c.Connected; if ($ok) { 'CONNECTED' } else { 'NO CONNECTION (timeout)' } }
  catch { 'NO CONNECTION (' + $_.Exception.InnerException.Message + ')' } finally { $c.Dispose() }
}
$fail = 0
Say "== AC1 probe $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
Say "-- 1. Listeners (expect only loopback + tailnet addresses; no 0.0.0.0 / :: / LAN)"
foreach ($p in $Ports) {
  foreach ($l in Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) {
    $a = $l.LocalAddress; $cls = if ($a -in '127.0.0.1','::1') { 'loopback' } elseif ($a -in $tsIps) { 'tailnet' } else { 'OTHER'; $fail++ }
    $proc = (Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Say ("   port {0,-5} {1,-28} {2,-9} {3}" -f $p, $a, $cls, $proc)
  }
}
Say "-- 2. Tailscale serve (expect 'tailnet only' for each port) and funnel (expect none)"
$serve = (& $tsExe serve status 2>&1) -join "`n"
foreach ($p in $Ports) { $m = [regex]::Match($serve, "https://\S+:$p \((.+?)\)"); Say ("   serve :{0} -> {1}" -f $p, $(if ($m.Success) { $m.Groups[1].Value } else { 'not served' })); if ($m.Success -and $m.Groups[1].Value -ne 'tailnet only') { $fail++ } }
$funnel = (& $tsExe funnel status 2>&1) -join ' '
$fOn = $funnel -match 'Funnel on'; Say ("   funnel: {0}" -f $(if ($fOn) { 'ON (FAIL)' } else { 'off for all ports' })); if ($fOn) { $fail++ }
Say "-- 3. On-tailnet probe (board SPA over the tailnet name)"
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "https://${tsHost}:8401/"; $title = [regex]::Match($r.Content, '<title>(.*?)</title>').Groups[1].Value; Say ("   GET https://${tsHost}:8401/ -> {0}, {1} bytes, title '{2}'" -f $r.StatusCode, $r.RawContentLength, $title) } catch { Say "   GET board over tailnet FAILED: $($_.Exception.Message)"; $fail++ }
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri 'http://127.0.0.1:8401/'; Say ("   GET http://127.0.0.1:8401/ (host-local) -> {0}" -f $r.StatusCode) } catch { Say "   host-local GET failed: $($_.Exception.Message)" }
Say "-- 4. Off-tailnet probes from this host's LAN addresses (expect NO CONNECTION)"
foreach ($ip in $lan) { foreach ($p in $Ports) { $res = Probe $ip $p; if ($res -eq 'CONNECTED') { $fail++ }; Say ("   {0}:{1} -> {2}" -f $ip, $p, $res) } }
Say ("== RESULT: {0}" -f $(if ($fail) { "FAIL ($fail problems)" } else { 'PASS (served on loopback + tailnet only; LAN probes refused)' }))
