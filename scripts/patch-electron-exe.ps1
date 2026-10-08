param(
  # 不传则自动在 electron-builder 缓存里找 rcedit-x64.exe
  [string]$RceditPath = '',
  [string]$TargetExe = 'node_modules\electron\dist\electron.exe',
  [string]$IconPath = 'build\icon.ico',
  # 不传则读取 package.json
  [string]$Version = '',
  [string]$ProductName = '',
  [string]$CompanyName = 'TBM',
  [string]$Copyright = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Resolve-Path2([string]$p, [string]$base) {
  if ([System.IO.Path]::IsPathRooted($p)) { return $p }
  return (Join-Path $base $p)
}

$target = Resolve-Path2 $TargetExe $root
$icon = Resolve-Path2 $IconPath $root

if (-not (Test-Path $target)) { throw "找不到目标 exe: $target" }
if (-not (Test-Path $icon)) { throw "找不到图标: $icon（先运行 scripts/make-logo.ps1 生成 build/icon.ico）" }

# 读取 package.json 补齐版本与产品名
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $pkg.version }
if (-not $ProductName) { $ProductName = if ($pkg.productName) { $pkg.productName } else { $pkg.name } }
if (-not $Copyright) { $Copyright = "Copyright (c) 2026 $CompanyName" }

# 自动查找 rcedit
if (-not $RceditPath) {
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
  if (Test-Path $cacheRoot) {
    $found = Get-ChildItem -Path $cacheRoot -Recurse -Filter 'rcedit-x64.exe' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) { $RceditPath = $found.FullName }
  }
}
if (-not $RceditPath) {
  throw "找不到 rcedit-x64.exe，请用 -RceditPath 指定（通常位于 %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<hash>\rcedit-x64.exe）"
}

Write-Output ("rcedit  : " + $RceditPath)
Write-Output ("target  : " + $target)
Write-Output ("icon    : " + $icon)
Write-Output ("version : " + $Version + " / " + $ProductName)

# 首次运行备份原 exe（放在 dist 目录之外，避免被 electron-builder 一起打包）
$backup = (Resolve-Path2 'node_modules\electron\.electron.exe.orig' $root)
if ((Test-Path "$target.orig")) { Remove-Item "$target.orig" -Force }
if (-not (Test-Path $backup)) {
  Copy-Item $target $backup -Force
  Write-Output ("已备份原 exe -> " + $backup)
}
Copy-Item $backup $target -Force

& $RceditPath $target `
  --set-icon $icon `
  --set-file-version $Version `
  --set-product-version $Version `
  --set-version-string "ProductName" $ProductName `
  --set-version-string "FileDescription" $ProductName `
  --set-version-string "CompanyName" $CompanyName `
  --set-version-string "LegalCopyright" $Copyright `
  --set-version-string "OriginalFilename" "$ProductName.exe" | Out-Null

if ($LASTEXITCODE -ne 0) { throw "rcedit 执行失败，退出码 $LASTEXITCODE" }

$item = Get-Item $target
Write-Output ("完成: {0} ({1:N0} bytes)" -f $item.Name, $item.Length)
