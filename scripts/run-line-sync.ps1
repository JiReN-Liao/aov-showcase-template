param(
    [ValidateSet("probe")]
    [string]$Command = "probe"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv-sync\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Missing Python environment. Run npm run line:setup first."
}

& $python (Join-Path $PSScriptRoot "line-sync\background_line_sync.py") $Command
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
