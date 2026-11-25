# Buzz Board v0: one-time local setup on the board host. Creates the per-user folder (restricted ACL:
# current account + SYSTEM only, inheritance removed) and writes the local config file. The bots'
# Nostr keys live in Windows Credential Manager (A2A/BUZZ_<BOT>_SECRET_KEY, created by
# `buzz-board.mjs keygen`). Nothing here is committed; no secret is printed.
param(
  [Parameter(Mandatory)] [string] $RelayUrlFile,     # file holding the relay wss:// URL (tailnet name)
  [Parameter(Mandatory)] [string] $NostrToolsFrom,   # folder whose node_modules has nostr-tools (e.g. the buzzboard spa)
  [Parameter(Mandatory)] [string] $WinCredScript,    # the host's WinCred.ps1 (Get-/Set-WinCredSecret)
  [string] $Root = (Join-Path $env:LOCALAPPDATA 'buzz-board')
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($p in @($Root)) {
  & icacls.exe $p /inheritance:r /grant:r "${me}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null   # S-1-5-18 = SYSTEM
  if ($LASTEXITCODE -ne 0) { throw "icacls failed on $p" }
}
$cfgFile = Join-Path $Root 'config.json'
if (-not (Test-Path $cfgFile)) {
  [ordered]@{ relayUrlFile = $RelayUrlFile; nostrToolsFrom = $NostrToolsFrom; winCredScript = $WinCredScript; lane = @{ owner = ''; d = '' } } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $cfgFile
}
"config folder ready; ACL:"; (Get-Acl $Root).Access | ForEach-Object { "  $($_.IdentityReference) $($_.FileSystemRights)" }
