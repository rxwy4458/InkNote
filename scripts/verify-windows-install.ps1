param([string]$Installer)
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP) { throw 'This test is intended for an isolated Windows CI runner.' }
if (-not $Installer) { $Installer = (Get-ChildItem (Join-Path $PSScriptRoot '..\release\InkNote-Setup-*.exe') | Select-Object -First 1).FullName }
if (-not $Installer) { throw 'The complete NSIS installer was not built.' }
$testRoot = Join-Path $env:RUNNER_TEMP ('InkNote-install-test-' + [guid]::NewGuid().ToString('N'))
$installPath = Join-Path $testRoot 'program'
$report = Join-Path $testRoot 'startup.json'
$appProcess = $null
[void][IO.Directory]::CreateDirectory($testRoot)
try {
 $setup = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installPath" -Wait -PassThru
 if ($setup.ExitCode -ne 0) { throw "Installer exited with code $($setup.ExitCode)." }
 foreach ($file in @('InkNote.exe','resources\app.asar','chrome_100_percent.pak','icudtl.dat')) {
  if (-not (Test-Path -LiteralPath (Join-Path $installPath $file))) { throw "Missing installed file: $file" }
 }
 $appProcess = Start-Process -FilePath (Join-Path $installPath 'InkNote.exe') -ArgumentList @('--smoke-test-output', ('"{0}"' -f $report)) -PassThru
 if (-not $appProcess.WaitForExit(45000)) { throw 'Installed app did not finish the startup smoke test.' }
 if ($appProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $report)) { throw 'Installed app failed to report renderer readiness.' }
 $result = Get-Content -Raw -LiteralPath $report | ConvertFrom-Json
 if (-not $result.ok -or -not $result.rendererReady -or -not $result.packaged) { throw "Startup check failed: $(Get-Content -Raw -LiteralPath $report)" }
 $registryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
 $entry = Get-ItemProperty $registryRoots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'InkNote' -and $_.UninstallString -like ('*' + $installPath + '*') } | Select-Object -First 1
 if (-not $entry) { throw 'No standard Windows uninstall entry was created.' }
 $uninstall = Get-ChildItem -LiteralPath $installPath -Filter '*Uninstall*.exe' | Select-Object -First 1
 if (-not $uninstall) { throw 'The standard uninstaller was not installed.' }
 $remove = Start-Process -FilePath $uninstall.FullName -ArgumentList "/S _?=$installPath" -Wait -PassThru
 if ($remove.ExitCode -ne 0) { throw "Uninstaller exited with code $($remove.ExitCode)." }
 if (Test-Path -LiteralPath (Join-Path $installPath 'InkNote.exe')) { throw 'App executable remains after uninstall.' }
 if (Test-Path -LiteralPath (Join-Path $installPath 'resources\app.asar')) { throw 'App archive remains after uninstall.' }
 if (Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue) { throw 'Windows uninstall entry remains after uninstall.' }
 if (-not (Test-Path -LiteralPath $result.profile)) { throw 'The note profile was removed.' }
 Write-Host "PASS: full runtime install, renderer startup, standard uninstall entry, uninstall, profile retention ($($result.version))."
} finally {
 if ($appProcess -and -not $appProcess.HasExited) { $appProcess.Kill(); $appProcess.WaitForExit(10000) | Out-Null }
 # Only this test's fresh directory is removed; never any real note profile.
 if ((Test-Path -LiteralPath $testRoot) -and $testRoot.StartsWith($env:RUNNER_TEMP, [StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
 }
}
