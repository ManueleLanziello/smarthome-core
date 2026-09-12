param(
  [Parameter(Mandatory = $true)][string]$VenvPath,
  [string]$BootstrapPython = $env:SMART_HOME_CAMERA_BOOTSTRAP_PYTHON
)

$ErrorActionPreference = 'Stop'
$coreRoot = Split-Path -Parent $PSScriptRoot
$python = if ($BootstrapPython) { $BootstrapPython } elseif (Get-Command python -ErrorAction SilentlyContinue) {
  'python'
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  'py'
} else {
  throw 'Python 3.11+ non trovato. Impostare SMART_HOME_CAMERA_BOOTSTRAP_PYTHON.'
}
if (-not (Test-Path -LiteralPath $VenvPath)) { & $python -m venv $VenvPath }
$venvPython = Join-Path $VenvPath 'Scripts\python.exe'
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $coreRoot 'requirements-camera.txt')
& $venvPython -c "import imageio_ffmpeg, pytapo; print('Ambiente C410 pronto - FFmpeg ' + imageio_ffmpeg.get_ffmpeg_version())"
