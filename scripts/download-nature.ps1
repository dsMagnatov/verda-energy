$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'public/assets/nature'
$docsRoot = Join-Path $projectRoot 'docs'
New-Item -ItemType Directory -Force -Path $assetRoot, $docsRoot | Out-Null
$records = @()
foreach ($assetId in @('rock_moss_set_01', 'fern_02')) {
  $manifest = Invoke-RestMethod -Uri ('https://api.polyhaven.com/files/' + $assetId)
  $info = Invoke-RestMethod -Uri ('https://api.polyhaven.com/info/' + $assetId)
  $package = $manifest.gltf.'2k'.gltf
  $folder = Join-Path $assetRoot $assetId
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $files = @([PSCustomObject]@{name = ($assetId + '_2k.gltf'); item = $package})
  $files += $package.include.psobject.Properties | ForEach-Object {
    [PSCustomObject]@{name = $_.Name; item = $_.Value}
  }
  # The official glTF incorrectly references a JPEG base color for its MASK
  # material; preserve the separate official PNG alpha map for leaf cutouts.
  if ($assetId -eq 'fern_02') {
    $files += [PSCustomObject]@{name = 'textures/fern_02_alpha_2k.png'; item = $manifest.Alpha.'2k'.png}
  }
  foreach ($file in $files) {
    $target = Join-Path $folder $file.name
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Invoke-WebRequest -Uri $file.item.url -OutFile $target
    $actual = (Get-FileHash -LiteralPath $target -Algorithm MD5).Hash.ToLowerInvariant()
    if ($actual -ne $file.item.md5) { throw ('MD5 mismatch: ' + $target) }
    if ((Get-Item -LiteralPath $target).Length -ne $file.item.size) { throw ('Size mismatch: ' + $target) }
  }
  $records += [PSCustomObject]@{
    id = $assetId
    title = $info.name
    authors = $info.authors
    assetUrl = ('https://polyhaven.com/a/' + $assetId)
    infoUrl = ('https://api.polyhaven.com/info/' + $assetId)
    manifestUrl = ('https://api.polyhaven.com/files/' + $assetId)
    license = 'CC0-1.0'
    licenseUrl = 'https://polyhaven.com/license'
    resolution = '2k'
    files = @($files | ForEach-Object {
      [PSCustomObject]@{path = ('public/assets/nature/' + $assetId + '/' + $_.name); url = $_.item.url; bytes = $_.item.size; md5 = $_.item.md5}
    })
  }
  Write-Output ('Downloaded and verified ' + $assetId)
}
$records | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $docsRoot 'nature-downloads.json') -Encoding utf8
Write-Output ('Total asset bytes: ' + (($records.files | Measure-Object -Property bytes -Sum).Sum))
