param(
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int[]]$Sizes = @(512, 256, 128, 64, 48, 32, 24, 16),
  # blue = 蓝底细体白字；white = 白底细体深字（DeepSeek 风格）；dark = 深底细体白字（LBook 风格）
  [ValidateSet('blue', 'white', 'dark')][string]$Style = 'blue',
  [string]$Text = 'TBM'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$RADIUS_RATIO = 0.22
$TRACKING_RATIO = 0.030

# 小尺寸需要更大的字形占比才看得清（光学修正）
function Get-TextRatio([int]$Size) {
  if ($Size -le 24) { return 0.82 }
  if ($Size -le 48) { return 0.76 }
  if ($Size -le 128) { return 0.70 }
  return 0.64
}

# 细体在小尺寸会糊，32px 及以下改用常规字重
function Get-FontName([int]$Size) {
  if ($Size -le 32) { return @('Calibri', 'Segoe UI', 'Arial') }
  return @('Calibri Light', 'Segoe UI Light', 'Calibri', 'Segoe UI', 'Arial')
}

function Get-Font([int]$Size, [single]$FontSize) {
  foreach ($name in (Get-FontName $Size)) {
    try {
      $font = New-Object System.Drawing.Font($name, $FontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
      if ($font.Name -eq $name) { return $font }
      $font.Dispose()
    } catch { }
  }
  return New-Object System.Drawing.Font('Arial', $FontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
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

$palette = @{
  blue  = @{ from = [System.Drawing.Color]::FromArgb(255, 37, 99, 235); to = [System.Drawing.Color]::FromArgb(255, 49, 46, 129); text = [System.Drawing.Color]::White; border = $null }
  white = @{ from = [System.Drawing.Color]::FromArgb(255, 255, 255, 255); to = [System.Drawing.Color]::FromArgb(255, 244, 246, 251); text = [System.Drawing.Color]::FromArgb(255, 15, 23, 42); border = [System.Drawing.Color]::FromArgb(255, 214, 222, 235) }
  dark  = @{ from = [System.Drawing.Color]::FromArgb(255, 32, 36, 48); to = [System.Drawing.Color]::FromArgb(255, 17, 20, 28); text = [System.Drawing.Color]::White; border = $null }
}
$c = $palette[$Style]

foreach ($size in $Sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $path = New-RoundedPath $size ($size * $RADIUS_RATIO)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(0, 0)),
    (New-Object System.Drawing.PointF(0, $size)),
    $c.from, $c.to)
  $g.FillPath($brush, $path)

  if ($c.border) {
    $pen = New-Object System.Drawing.Pen($c.border, [single]([Math]::Max(1, $size / 256)))
    $g.DrawPath($pen, $path)
    $pen.Dispose()
  }

  # 逐字绘制以控制字间距
  $chars = $Text.ToCharArray()
  $targetWidth = $size * (Get-TextRatio $size)
  $tracking = $size * $TRACKING_RATIO
  $fontSize = $size * 0.4
  $font = $null
  $widths = @()
  for ($pass = 0; $pass -lt 3; $pass++) {
    if ($font) { $font.Dispose() }
    $font = Get-Font $size $fontSize
    $widths = @()
    foreach ($ch in $chars) { $widths += $g.MeasureString([string]$ch, $font).Width }
    $total = ($widths | Measure-Object -Sum).Sum + $tracking * ($chars.Count - 1)
    if ($total -le 0) { break }
    $fontSize = $fontSize * ($targetWidth / $total)
  }

  $total = ($widths | Measure-Object -Sum).Sum + $tracking * ($chars.Count - 1)
  $x = ($size - $total) / 2
  $textBrush = New-Object System.Drawing.SolidBrush($c.text)
  for ($i = 0; $i -lt $chars.Count; $i++) {
    $h = $g.MeasureString([string]$chars[$i], $font).Height
    $y = ($size - $h) / 2 - $size * 0.012
    $g.DrawString([string]$chars[$i], $font, $textBrush, [single]$x, [single]$y)
    $x += $widths[$i] + $tracking
  }

  $outFile = Join-Path $OutDir ("logo-{0}.png" -f $size)
  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $textBrush.Dispose(); $font.Dispose(); $brush.Dispose(); $path.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Output ("generated {0}" -f $outFile)
}
