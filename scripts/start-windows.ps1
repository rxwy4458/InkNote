# Windows PowerShell 5.1 / Windows 10 and 11. No Node.js or admin rights required.
$ErrorActionPreference = 'Stop'
$port = 43877
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\app'))
$prefix = $appRoot + [IO.Path]::DirectorySeparatorChar
$origin = "http://127.0.0.1:$port/"
$profilePath = Join-Path $env:LOCALAPPDATA 'InkNote\EdgeProfile'
function Show-Failure([string]$message) {
 Add-Type -AssemblyName System.Windows.Forms
 [void][System.Windows.Forms.MessageBox]::Show($message, 'InkNote', 'OK', 'Error')
}
try {
 $edgeCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
 )
 $edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
 if (-not $edge) { throw 'Microsoft Edge was not found. Install Microsoft Edge, then run Start-InkNote.cmd again.' }
 function Open-InkNote {
  $edgeArgs = @("--app=$origin", ('--user-data-dir="{0}"' -f $profilePath), '--no-first-run')
  Start-Process -FilePath $edge -ArgumentList $edgeArgs
 }
 $existing = $null
 try { $existing = Invoke-RestMethod -Uri ($origin + '__inknote_health') -TimeoutSec 2 -UseBasicParsing } catch {}
 if ($existing -and $existing.product -eq 'InkNote') { Open-InkNote; exit 0 }
 $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
 try { $listener.Start() } catch { throw "Local port $port is busy. Close the application using that port and try again." }
 Open-InkNote
 $lastRequest = [DateTime]::UtcNow
 $mime = @{ '.html'='text/html; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.svg'='image/svg+xml'; '.wasm'='application/wasm'; '.json'='application/json'; '.ttf'='font/ttf' }
 while (([DateTime]::UtcNow - $lastRequest).TotalSeconds -lt 120) {
  if (-not $listener.Pending()) { Start-Sleep -Milliseconds 30; continue }
  $client = $listener.AcceptTcpClient()
  $client.ReceiveTimeout = 5000
  $client.SendTimeout = 15000
  $stream = $client.GetStream()
  $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
  try {
   $line = $reader.ReadLine()
   if (-not $line) { continue }
   $parts = $line.Split(' ')
   do { $headerLine = $reader.ReadLine() } while ($headerLine)
   $status = '200 OK'; $contentType = 'application/octet-stream'; $bytes = $null
   if ($parts.Length -lt 2 -or ($parts[0] -ne 'GET' -and $parts[0] -ne 'HEAD')) { $status='405 Method Not Allowed' }
   else {
    $requestPath = [Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
    if ($requestPath -eq '/__inknote_health') {
     $lastRequest = [DateTime]::UtcNow
     $contentType='application/json'
     $bytes=[Text.Encoding]::UTF8.GetBytes('{"product":"InkNote","version":"0.1.0"}')
    } else {
     if ($requestPath -eq '/') { $requestPath='/index.html' }
     $file = [IO.Path]::GetFullPath((Join-Path $appRoot $requestPath.TrimStart('/').Replace('/', '\')))
     if (-not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $status='403 Forbidden' }
     elseif (-not [IO.File]::Exists($file)) { $status='404 Not Found' }
     else {
      $lastRequest = [DateTime]::UtcNow
      $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
      if ($mime.ContainsKey($ext)) { $contentType=$mime[$ext] }
      $bytes=[IO.File]::ReadAllBytes($file)
     }
    }
   }
   if ($null -eq $bytes) { $bytes=[Text.Encoding]::UTF8.GetBytes($status) }
   $head="HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`n`r`n"
   $headBytes=[Text.Encoding]::ASCII.GetBytes($head)
   $stream.Write($headBytes,0,$headBytes.Length)
   if ($parts[0] -ne 'HEAD') { $stream.Write($bytes,0,$bytes.Length) }
   $stream.Flush()
  } catch { } finally { $reader.Dispose(); $stream.Dispose(); $client.Dispose() }
 }
 $listener.Stop()
} catch {
 if ($listener) { $listener.Stop() }
 Show-Failure $_.Exception.Message
 exit 1
}
