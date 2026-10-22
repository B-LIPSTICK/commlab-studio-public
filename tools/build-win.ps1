#requires -Version 5.1
<#
  CommLab Studio · Windows 可重复构建脚本

  等价于以下三步：
    1. npx electron-builder --win dir --config.win.signAndEditExecutable=false
    2. tools/rcedit-x64.exe 给 release\win-unpacked\CommLab Studio.exe 写图标和版本信息
    3. npx electron-builder --win nsis --prepackaged release\win-unpacked --config.win.signAndEditExecutable=false

  用法：
    .\tools\build-win.ps1                          # NSIS 安装包（私有/内部构建）
    .\tools\build-win.ps1 -Portable                # 私有构建 + portable zip
    .\tools\build-win.ps1 -CheckPublicRelease      # 只检查并列出公开包会排除的第三方资产
    .\tools\build-win.ps1 -PublicRelease -Portable # 真正生成公开包（release\public）

  公开构建使用临时 electron-builder 配置，只改变公开构建的文件过滤；
  私有构建仍使用 package.json 中的 build 配置，输出到 release。
#>
[CmdletBinding()]
param(
  [switch]$Portable,
  [switch]$PublicRelease,
  [switch]$CheckPublicRelease
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BaseReleaseDir = Join-Path $Root "release"
$ReleaseDir = if ($PublicRelease) { Join-Path $BaseReleaseDir "public" } else { $BaseReleaseDir }
$UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
$ExePath = Join-Path $UnpackedDir "CommLab Studio.exe"
$IconIco = Join-Path $Root "build\icon.ico"
$IconPng = Join-Path $Root "build\icon.png"
$Rcedit = Join-Path $Root "tools\rcedit-x64.exe"
$PackageJson = Join-Path $Root "package.json"
$Builder = Join-Path $Root "node_modules\.bin\electron-builder.cmd"
$Asar = Join-Path $Root "node_modules\.bin\asar.cmd"

function Assert-Exists {
  param([string]$Path, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "缺少${Label}：$Path"
  }
}

function Invoke-Checked {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$Label)
  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $FilePath @ArgumentList
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "$Label 失败（退出码 $LASTEXITCODE）"
  }
}

function Show-FileHash {
  param([string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha.ComputeHash($stream)
      $hex = [System.BitConverter]::ToString($bytes).Replace("-", "")
      Write-Host ("    SHA256  {0}  {1}" -f $hex, $Path)
    }
    finally {
      $sha.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

function Get-RelativePath {
  param([string]$Path)
  return $Path.Substring($Root.Length).TrimStart('\', '/')
}

function New-AssetRow {
  param(
    [string]$Kind,
    [object[]]$Files,
    [string]$Action
  )
  $list = @($Files)
  $bytes = 0
  foreach ($f in $list) { $bytes += [int64]$f.Length }
  $examples = @($list | Select-Object -First 3 | ForEach-Object { Get-RelativePath $_.FullName }) -join ", "
  return [pscustomobject]@{
    Kind = $Kind
    Count = $list.Count
    Bytes = $bytes
    Action = $Action
    Examples = $examples
  }
}

function Get-PublicExcludedAssets {
  $items = @()
  $dataDir = Join-Path $Root "data"

  $scriptsDir = Join-Path $dataDir "scripts"
  if (Test-Path -LiteralPath $scriptsDir) {
    $files = @(Get-ChildItem -LiteralPath $scriptsDir -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in @('.m', '.octave') })
    if ($files.Count -gt 0) {
      $items += New-AssetRow "平台脚本原文" $files "不进入公开包；仅保留在私有源码树"
    }
  }

  $expDir = Join-Path $dataDir "experiments"
  if (Test-Path -LiteralPath $expDir) {
    $files = @(Get-ChildItem -LiteralPath $expDir -Recurse -File -Filter "*.md" -ErrorAction SilentlyContinue)
    if ($files.Count -gt 0) {
      $items += New-AssetRow "平台课程原文" $files "不进入公开包；由用户课程包导入"
    }
  }

  $ocj = Join-Path $dataDir "ocj-templates.json"
  if (Test-Path -LiteralPath $ocj) {
    $items += New-AssetRow "Rainier OCJ 器件模板" @(Get-Item -LiteralPath $ocj) "不进入公开包；老版实验台导出会提示不可用"
  }

  if (Test-Path -LiteralPath $dataDir) {
    $images = @(Get-ChildItem -LiteralPath $dataDir -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|gif|webp|bmp|svg|tif|tiff)$' })
    if ($images.Count -gt 0) {
      $items += New-AssetRow "data 下的学校课程图片" $images "不进入公开包"
    }

    $otherM = @(Get-ChildItem -LiteralPath $dataDir -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in @('.m', '.octave') -and $_.FullName -notlike "$scriptsDir*" })
    if ($otherM.Count -gt 0) {
      $items += New-AssetRow "data 下的其他平台脚本" $otherM "不进入公开包"
    }
  }

  foreach ($rel in @("vlab_offline", "data\vlab_offline")) {
    $p = Join-Path $Root $rel
    if (Test-Path -LiteralPath $p) {
      $items += [pscustomobject]@{
        Kind = "vlab_offline / Rainier 离线实验台"
        Count = 1
        Bytes = 0
        Action = "不进入公开包；用户自行安装学校客户端"
        Examples = $rel
      }
    }
  }

  foreach ($rel in @("", "app", "data", "tools")) {
    $dir = if ($rel) { Join-Path $Root $rel } else { $Root }
    $exe = Join-Path $dir "com_rainier_osgi_gui.exe"
    if (Test-Path -LiteralPath $exe) {
      $items += [pscustomobject]@{
        Kind = "Rainier 引擎二进制"
        Count = 1
        Bytes = (Get-Item -LiteralPath $exe).Length
        Action = "不进入公开包；用户自行安装学校客户端"
        Examples = (Get-RelativePath $exe)
      }
    }
  }

  $indexPath = Join-Path $dataDir "experiments.json"
  if (Test-Path -LiteralPath $indexPath) {
    $text = Get-Content -Raw -LiteralPath $indexPath -Encoding UTF8
    $urlHits = [regex]::Matches($text, '10\.2\.18\.64|https?://').Count
    if ($urlHits -gt 0) {
      $items += [pscustomobject]@{
        Kind = "公开元数据中的平台 URL"
        Count = $urlHits
        Bytes = 0
        Action = "公开构建会拒绝；请从 data/experiments.json 移除"
        Examples = "data/experiments.json"
      }
    }
  }

  return $items
}

function Write-PublicAssetReport {
  param([object[]]$Assets)
  Write-Host ""
  Write-Host "公开构建排除清单（源码可保留，但不会进入公开包）：" -ForegroundColor Yellow
  $list = @($Assets)
  if ($list.Count -eq 0) {
    Write-Host "  - 未发现需要排除的第三方资产。"
    return
  }
  foreach ($a in $list) {
    $kb = [math]::Round(($a.Bytes / 1KB), 1)
    Write-Host ("  - {0}: {1} 个 / {2} KB" -f $a.Kind, $a.Count, $kb)
    Write-Host ("      处理：{0}" -f $a.Action)
    if ($a.Examples) { Write-Host ("      示例：{0}" -f $a.Examples) }
  }
}

function Get-PublicFilePatterns {
  return @(
    "app/**/*",
    "data/**/*",
    "templates/**/*",
    "build/icon.png",
    "package.json",
    "!data/scripts/**",
    "!data/experiments/**",
    "!data/ocj-templates.json",
    "!data/**/*.m",
    "!data/**/*.octave",
    "!data/**/*.png",
    "!data/**/*.jpg",
    "!data/**/*.jpeg",
    "!data/**/*.gif",
    "!data/**/*.webp",
    "!data/**/*.bmp",
    "!data/**/*.svg",
    "!data/**/*.tif",
    "!data/**/*.tiff",
    "!**/vlab_offline/**",
    "!**/com_rainier_osgi_gui.exe"
  )
}

function New-PublicBuilderConfig {
  param($Package)
  if (-not $Package.build) { throw "package.json 缺少 build 配置" }
  $build = $Package.build | ConvertTo-Json -Depth 40 | ConvertFrom-Json
  $build.files = @(Get-PublicFilePatterns)
  $build.directories.output = $ReleaseDir
  $build.directories.buildResources = (Join-Path $Root "build")
  $build.win | Add-Member -NotePropertyName icon -NotePropertyValue $IconPng -Force

  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("commlab-public-build-{0}.json" -f [guid]::NewGuid().ToString("N"))
  $json = $build | ConvertTo-Json -Depth 40
  [System.IO.File]::WriteAllText($temp, $json, (New-Object System.Text.UTF8Encoding($false)))
  return $temp
}

function Assert-PublicMetadataSafe {
  $indexPath = Join-Path $Root "data\experiments.json"
  Assert-Exists $indexPath "data/experiments.json"
  $text = Get-Content -Raw -LiteralPath $indexPath -Encoding UTF8
  $hits = @()
  if ($text -match '10\.2\.18\.64') { $hits += "校内平台地址" }
  if ($text -match 'https?://') { $hits += "http(s) URL" }
  if ($text -match '"url"\s*:') { $hits += '"url" 字段' }
  if ($hits.Count -gt 0) {
    throw ("公开构建被阻止：data/experiments.json 仍包含 " + ($hits -join "、") + "。请只保留题号、标题、chain、params 等结构化元数据。")
  }
  try {
    $idx = $text | ConvertFrom-Json
    if (-not $idx.experiments -or @($idx.experiments).Count -eq 0) {
      throw "experiments 数组为空"
    }
  }
  catch {
    throw "data/experiments.json 无法解析：$($_.Exception.Message)"
  }
}

function Assert-PublicAsarClean {
  param([string]$AsarPath)
  Assert-Exists $AsarPath "公开包 app.asar"
  if (-not (Test-Path -LiteralPath $Asar)) {
    Write-Warning "未找到 asar CLI，跳过 app.asar 内容校验。"
    return
  }
  $entries = @(& $Asar list $AsarPath 2>&1)
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "asar list 失败（退出码 $LASTEXITCODE）"
  }
  $bad = @($entries | Where-Object {
    $e = (($_ -replace '\\', '/')).Trim()
    ($e -match '(^|/)data/(scripts|experiments)(/|$)') -or
    ($e -match '(^|/)data/ocj-templates\.json$') -or
    ($e -match '(^|/)data/.*\.(m|octave|png|jpg|jpeg|gif|webp|bmp|svg|tif|tiff)$')
  })
  if ($bad.Count -gt 0) {
    throw ("公开包 app.asar 仍包含被排除资产：`n - " + ($bad -join "`n - "))
  }
  Write-Host "    app.asar 公开过滤校验通过（未发现 scripts/experiments/ocj/图片）"
}

function Reset-PublicReleaseDir {
  $resolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $resolvedRelease = [System.IO.Path]::GetFullPath($ReleaseDir)
  if (-not $resolvedRelease.StartsWith($resolvedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理项目目录之外的路径：$resolvedRelease"
  }
  if (Test-Path -LiteralPath $resolvedRelease) {
    Remove-Item -LiteralPath $resolvedRelease -Recurse -Force
  }
  New-Item -ItemType Directory -Path $resolvedRelease -Force | Out-Null
}

Write-Host "CommLab Studio · Windows build" -ForegroundColor Green
Write-Host "  项目目录: $Root"
$modeLabel = if ($CheckPublicRelease) { '公开包检查（只读）' } elseif ($PublicRelease) { '公开包（release\public）' } else { '私有/内部包（release）' }
Write-Host "  构建模式: $modeLabel"

Assert-Exists $PackageJson "package.json"

if ($CheckPublicRelease) {
  $assets = @(Get-PublicExcludedAssets)
  Write-PublicAssetReport $assets
  Write-Host ""
  Write-Host "检查模式只读，不生成安装包。"
  Write-Host "公开构建命令：.\tools\build-win.ps1 -PublicRelease -Portable"
  return
}

Assert-Exists $Builder "electron-builder（先运行 npm install）"
Assert-Exists $Rcedit "rcedit（tools\rcedit-x64.exe）"
Assert-Exists $IconIco "build\icon.ico"
Assert-Exists $IconPng "build\icon.png"
Assert-Exists (Join-Path $Root "app\main.js") "app\main.js"

$pkg = Get-Content -Raw -LiteralPath $PackageJson -Encoding UTF8 | ConvertFrom-Json
$Version = [string]$pkg.version
if ([string]::IsNullOrWhiteSpace($Version)) { throw "package.json 缺少 version" }

$numericVersion = ($Version -split '[-+]')[0]
$parts = @($numericVersion.Split('.'))
if ($parts.Count -lt 3) { throw "version 需要至少三段数字：$Version" }
while ($parts.Count -lt 4) { $parts += "0" }
$FileVersion = ($parts[0..3] -join '.')

$ProductName = "CommLab Studio"
if ($pkg.build -and $pkg.build.productName) { $ProductName = [string]$pkg.build.productName }
$Description = if ($pkg.description) { [string]$pkg.description } else { "通信原理虚拟仿真实验教学助手" }
$Company = if ($pkg.author) { [string]$pkg.author } else { "B-LIPSTICK" }

$Installer = Join-Path $ReleaseDir ("CommLabStudio-{0}-setup.exe" -f $Version)
$PortableZip = Join-Path $ReleaseDir ("CommLabStudio-{0}-portable.zip" -f $Version)
$PublicConfig = $null

if ($PublicRelease) {
  Assert-PublicMetadataSafe
  $assets = @(Get-PublicExcludedAssets)
  Write-PublicAssetReport $assets
  Reset-PublicReleaseDir
}

Push-Location $Root
try {
  if (-not (Test-Path -LiteralPath $ReleaseDir)) {
    New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
  }

  $builderArgs = @("--config.win.signAndEditExecutable=false")
  if ($PublicRelease) {
    $PublicConfig = New-PublicBuilderConfig $pkg
    Write-Host ""
    Write-Host "  公开临时配置: $PublicConfig"
    $builderArgs = @("--config", $PublicConfig) + $builderArgs
  }

  Invoke-Checked $Builder (@("--win", "dir") + $builderArgs) "1/3 生成 win-unpacked"

  Assert-Exists $ExePath "解包后的主程序"
  if ($PublicRelease) {
    Assert-PublicAsarClean (Join-Path $UnpackedDir "resources\app.asar")
  }

  Invoke-Checked $Rcedit @(
    $ExePath,
    "--set-icon", $IconIco,
    "--set-file-version", $FileVersion,
    "--set-product-version", $FileVersion,
    "--set-version-string", "ProductName", $ProductName,
    "--set-version-string", "FileDescription", $Description,
    "--set-version-string", "CompanyName", $Company,
    "--set-version-string", "LegalCopyright", "MIT License",
    "--set-version-string", "OriginalFilename", "CommLab Studio.exe"
  ) "2/3 写入图标与版本信息"

  $vi = (Get-Item -LiteralPath $ExePath).VersionInfo
  Write-Host ("    ProductName: {0}" -f $vi.ProductName)
  Write-Host ("    FileVersion: {0}" -f $vi.FileVersion)
  Write-Host ("    ProductVersion: {0}" -f $vi.ProductVersion)

  Invoke-Checked $Builder (@("--win", "nsis", "--prepackaged", $UnpackedDir) + $builderArgs) "3/3 生成 NSIS 安装包"

  Assert-Exists $Installer "NSIS 安装包"
  Assert-Exists (Join-Path $ReleaseDir "latest.yml") "latest.yml"

  if ($Portable) {
    Write-Host ""
    Write-Host "==> 生成 portable zip" -ForegroundColor Cyan
    if (Test-Path -LiteralPath $PortableZip) {
      [System.IO.File]::Delete($PortableZip)
    }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open(
      $PortableZip,
      [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
      $prefix = "CommLab Studio"
      Get-ChildItem -LiteralPath $UnpackedDir -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($UnpackedDir.Length).TrimStart('\', '/')
        $entryName = $prefix + "/" + ($relative -replace '\\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
          $zip,
          $_.FullName,
          $entryName,
          [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
      }
    }
    finally {
      $zip.Dispose()
    }
    Assert-Exists $PortableZip "portable zip"
  }

  Write-Host ""
  Write-Host "构建完成" -ForegroundColor Green
  Write-Host "  安装包:   $Installer"
  if ($Portable) { Write-Host "  便携版:   $PortableZip" }
  Write-Host "  解包目录: $UnpackedDir"
  Show-FileHash $Installer
  if ($Portable) { Show-FileHash $PortableZip }
}
finally {
  Pop-Location
  if ($PublicConfig -and (Test-Path -LiteralPath $PublicConfig)) {
    Remove-Item -LiteralPath $PublicConfig -Force -ErrorAction SilentlyContinue
  }
}
