[CmdletBinding()]
param(
  [string]$Version,
  [string]$NotesFile,
  [switch]$Draft,
  [switch]$Prerelease
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageJson = Join-Path $RepoRoot 'package.json'
$TauriConfigPath = Join-Path $RepoRoot 'src-tauri\tauri.conf.json'
$BundleRoot = Join-Path $RepoRoot 'src-tauri\target\release\bundle'
$NsisDir = Join-Path $BundleRoot 'nsis'
$LatestJson = Join-Path $BundleRoot 'latest.json'

function Get-GitHubRepoSlug {
  param([string]$RepoRoot)
  $origin = git -C $RepoRoot remote get-url origin
  if (-not $origin) {
    throw "Unable to resolve git remote origin."
  }
  if ($origin -match 'github\.com[:/](?<slug>.+?)(?:\.git)?$') {
    return $matches.slug
  }
  throw "Only GitHub origin remotes are supported. Current origin: $origin"
}

function New-TauriStaticLatestJson {
  param(
    [string]$OutFile,
    [string]$RepoSlug,
    [string]$Tag,
    [string]$Version,
    [string]$AssetName,
    [string]$SignatureFile,
    [string]$Notes
  )

  if (-not (Test-Path $SignatureFile)) {
    throw "Signature file not found: $SignatureFile"
  }

  $signature = (Get-Content $SignatureFile -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($signature)) {
    throw "Signature file is empty: $SignatureFile"
  }

  $encodedAssetName = [System.Uri]::EscapeDataString($AssetName)
  $downloadUrl = "https://github.com/$RepoSlug/releases/download/$Tag/$encodedAssetName"

  $payload = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
      "windows-x86_64" = [ordered]@{
        signature = $signature
        url       = $downloadUrl
      }
    }
  }

  $json = $payload | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path $PackageJson)) {
  throw "package.json not found: $PackageJson"
}

if (-not (Test-Path $TauriConfigPath)) {
  throw "tauri.conf.json not found: $TauriConfigPath"
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "gh command not found in PATH."
}

$Package = Get-Content $PackageJson -Raw | ConvertFrom-Json
$TauriConfig = Get-Content $TauriConfigPath -Raw | ConvertFrom-Json
$ResolvedVersion = if ($Version) { $Version } else { [string]$Package.version }
if ([string]::IsNullOrWhiteSpace($ResolvedVersion)) {
  throw "Unable to resolve release version."
}

if ($Package.version -ne $ResolvedVersion) {
  throw "Version mismatch. package.json is $($Package.version), requested release version is $ResolvedVersion."
}

$Tag = "v$ResolvedVersion"
$SetupExe = Get-ChildItem $NsisDir -Filter "*_${ResolvedVersion}_x64-setup.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $SetupExe) {
  throw "NSIS installer for version $ResolvedVersion not found under $NsisDir"
}

$NotesText = ""
if ($NotesFile) {
  if (-not (Test-Path $NotesFile)) {
    throw "Notes file not found: $NotesFile"
  }
  $NotesText = (Get-Content $NotesFile -Raw).Trim()
}

$Assets = [System.Collections.Generic.List[string]]::new()
$Assets.Add($SetupExe.FullName)

$UpdaterEnabled = $null -ne $TauriConfig.plugins.updater
$CreateUpdaterArtifacts = $TauriConfig.bundle.createUpdaterArtifacts -eq $true

if ($UpdaterEnabled -and $CreateUpdaterArtifacts) {
  $InstallerSignature = "$($SetupExe.FullName).sig"
  $RepoSlug = Get-GitHubRepoSlug -RepoRoot $RepoRoot
  New-TauriStaticLatestJson `
    -OutFile $LatestJson `
    -RepoSlug $RepoSlug `
    -Tag $Tag `
    -Version $ResolvedVersion `
    -AssetName $SetupExe.Name `
    -SignatureFile $InstallerSignature `
    -Notes $NotesText
  $Assets.Add($LatestJson)
}

$SignatureFiles = Get-ChildItem $BundleRoot -Recurse -File -Include '*.sig' -ErrorAction SilentlyContinue |
  Where-Object { $_.BaseName -like "*$ResolvedVersion*" -or $_.Name -eq 'latest.json.sig' }

if ($UpdaterEnabled -and $CreateUpdaterArtifacts -and $SignatureFiles.Count -eq 0) {
  throw "Updater artifacts are required but no .sig files were generated under $BundleRoot"
}

foreach ($file in $SignatureFiles) {
  $Assets.Add($file.FullName)
}

$Assets = $Assets | Select-Object -Unique

if ($Assets.Count -eq 0) {
  throw "No release assets found."
}

gh auth status | Out-Null

$ReleaseArgs = @(
  'release', 'create', $Tag
)
$ReleaseArgs += $Assets
$ReleaseArgs += @('--title', $Tag)

if ($NotesFile) {
  if (-not (Test-Path $NotesFile)) {
    throw "Notes file not found: $NotesFile"
  }
  $ReleaseArgs += @('--notes-file', (Resolve-Path $NotesFile).Path)
} else {
  $ReleaseArgs += @('--generate-notes')
}

if ($Draft) {
  $ReleaseArgs += '--draft'
}

if ($Prerelease) {
  $ReleaseArgs += '--prerelease'
}

Write-Host "Creating GitHub release $Tag"
Write-Host "Assets:"
$Assets | ForEach-Object { Write-Host " - $_" }

& gh @ReleaseArgs
