$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'chrome-extension'
$manifest = Get-Content -LiteralPath (Join-Path $sourcePath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne '1.8.2') { throw 'Expected connector v1.8.2 before packaging.' }
if ($manifest.externally_connectable.matches.Count -ne 1 -or $manifest.externally_connectable.matches[0] -ne 'https://anma-media-tool-20261012.netlify.app/*') { throw 'Unexpected website origin.' }
$stagePath = Join-Path $projectRoot ('connector-package-v182-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$releasePath = Join-Path $stagePath 'anma-media-chrome-v1.8.2'
New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $releasePath 'video-origin-downloader-extension') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'CONNECTOR_QUICKSTART.md') -Destination (Join-Path $releasePath 'README.md')
$archivePath = Join-Path $projectRoot 'dist\downloads\chrome-extension-v1.8.2.zip'
Compress-Archive -LiteralPath $releasePath -DestinationPath $archivePath -Force
Copy-Item -LiteralPath $archivePath -Destination (Join-Path $projectRoot 'dist\downloads\chrome-extension.zip') -Force
$archiveInfo = Get-Item -LiteralPath $archivePath
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
[PSCustomObject]@{ Version=$manifest.version; Bytes=$archiveInfo.Length; SHA256=$hash; Archive=$archiveInfo.FullName } | ConvertTo-Json
