# Start Jupyter with notebooks/analyze.ipynb
# Run from repo: scripts live under scripts/; run from bundle: same folder as pyproject.toml and .uv/

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot "pyproject.toml")) {
    $PSScriptRoot
} else {
    Split-Path -Parent $PSScriptRoot
}

$BundledUv = Join-Path $RepoRoot (Join-Path ".uv" "uv.exe")
if (Test-Path -LiteralPath $BundledUv) {
    $UvExe = $BundledUv
} elseif (Get-Command uv -ErrorAction SilentlyContinue) {
    $UvExe = "uv"
} else {
    Write-Host "Neither $BundledUv nor 'uv' on PATH was found. Run install.ps1 or install uv." -ForegroundColor Red
    exit 1
}

$Notebook = Join-Path $RepoRoot (Join-Path "notebooks" "analyze.ipynb")
if (-not (Test-Path -LiteralPath $Notebook)) {
    Write-Host "Notebook not found: $Notebook" -ForegroundColor Red
    exit 1
}

Push-Location $RepoRoot
try {
    Write-Host "Starting Jupyter: $Notebook" -ForegroundColor Cyan
    & $UvExe run --python 3.12 --extra notebook jupyter notebook $Notebook
    exit [int]$LASTEXITCODE
} finally {
    Pop-Location
}
