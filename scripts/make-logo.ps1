param(
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int[]]$Sizes = @(512, 256, 128, 64, 48, 32, 24, 16)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# 512 母版尺寸下的比例参数
$RADIUS_RATIO = 0.22   # 圆角半径
$TRACKING_RATIO = 0.030   # 字间距占画布比例

# 小尺寸需要更大的字形占比才能看清（光学修正）
function Get-TextRatio([int]$Size) {
  if ($Size -le 24) { return 0.80 }
  if ($Size -le 48) { return 0.74 }
  if ($Size -le 128) { return 0.68 }
  return 0.62
}

function New-RoundedPath([single]$Size, [single]$Radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $Radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

foreach ($size in $Sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # ── 背景：圆角矩形 + 蓝色渐变 ──
  $path = New-RoundedPath $size ($size * $RADIUS_RATIO)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(0, 0)),
    (New-Object System.Drawing.PointF(0, $size)),
    [System.Drawing.Color]::FromArgb(255, 37, 99, 235),
    [System.Drawing.Color]::FromArgb(255, 49, 46, 129))
  $g.FillPath($brush, $path)

  # ── 文字 TBM：逐字绘制以控制字间距 ──
  $text = 'TBM'
  $chars = $text.ToCharArray()
  $targetWidth = $size * (Get-TextRatio $size)
  $tracking = $size * $TRACKING_RATIO
  $fontSize = $size * 0.4
  $font = $null
  $widths = @()
  for ($pass = 0; $pass -lt 3; $pass++) {
    if ($font) { $font.Dispose() }
    $font = New-Object System.Drawing.Font('Segoe UI', [single]$fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $widths = @()
    foreach ($ch in $chars) { $widths += $g.MeasureString([string]$ch, $font).Width }
    $total = ($widths | Measure-Object -Sum).Sum + $tracking * ($chars.Count - 1)
    if ($total -le 0) { break }
    $fontSize = $fontSize * ($targetWidth / $total)
  }

  $total = ($widths | Measure-Object -Sum).Sum + $tracking * ($chars.Count - 1)
  $x = ($size - $total) / 2
  $white = [System.Drawing.Brushes]::White
  for ($i = 0; $i -lt $chars.Count; $i++) {
    $h = $g.MeasureString([string]$chars[$i], $font).Height
    $y = ($size - $h) / 2
    # 视觉居中修正：Segoe UI 顶部留白略多
    $y -= $size * 0.012
    $g.DrawString([string]$chars[$i], $font, $white, [single]$x, [single]$y)
    $x += $widths[$i] + $tracking
  }

  $outFile = Join-Path $OutDir ("logo-{0}.png" -f $size)
  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $font.Dispose(); $brush.Dispose(); $path.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Output ("generated {0}" -f $outFile)
}
