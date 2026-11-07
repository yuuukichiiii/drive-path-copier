# Chrome Web Store 用の zip を作る。
# manifest.json の "key" はローカル開発で拡張機能 ID をストア版と揃えるためのもので、
# ストアにアップロードする zip には含められない（含めるとアップロードが拒否される）ため除去する。
# 使い方: pwsh -File build-store-zip.ps1   → 親フォルダに drive-path-copier-store-v<version>.zip を出力

$ErrorActionPreference = 'Stop'
$src   = $PSScriptRoot
$files = 'manifest.json', 'popup.html', 'popup.js', 'icon16.png', 'icon48.png'

$version = (Get-Content (Join-Path $src 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$out     = Join-Path (Split-Path $src -Parent) "drive-path-copier-store-v$version.zip"
$tmp     = Join-Path ([IO.Path]::GetTempPath()) ("dpc-build-" + [guid]::NewGuid())

New-Item -ItemType Directory $tmp | Out-Null
try {
    foreach ($f in $files) { Copy-Item (Join-Path $src $f) $tmp }

    $manifestPath = Join-Path $tmp 'manifest.json'
    $lines = Get-Content $manifestPath -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*"key"\s*:' }
    [IO.File]::WriteAllLines($manifestPath, $lines, [Text.UTF8Encoding]::new($false))
    $null = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json   # JSON として壊れていないか確認

    if (Test-Path $out) { Remove-Item $out }
    Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $out
    Write-Output "Created: $out"
}
finally {
    Remove-Item $tmp -Recurse -Force
}
