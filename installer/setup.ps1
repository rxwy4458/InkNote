param([Parameter(Mandatory=$true)][string]$BundlePath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$electronVersion='45.2.3'
$appVersion='0.6.1'
$zipName="electron-v$electronVersion-win32-x64.zip"
$release="https://github.com/electron/electron/releases/download/v$electronVersion/"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object System.Windows.Forms.Form
$form.Text='安装墨页 InkNote 0.6.1（在线安装）'
$form.Size=New-Object System.Drawing.Size(530,255)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.MinimizeBox=$false
$label=New-Object System.Windows.Forms.Label
$label.Location=New-Object System.Drawing.Point(28,27)
$label.Size=New-Object System.Drawing.Size(465,112)
$label.Font=New-Object System.Drawing.Font('Microsoft YaHei UI',10)
$label.Text="正在准备安装墨页。`n本安装器已包含最新版笔记程序。`n首次安装需要联网下载桌面运行组件。"
$form.Controls.Add($label)
$progress=New-Object System.Windows.Forms.ProgressBar
$progress.Location=New-Object System.Drawing.Point(28,150)
$progress.Size=New-Object System.Drawing.Size(462,16)
$progress.Style='Marquee'
$form.Controls.Add($progress)
$form.Show()
$form.Activate()
$form.BringToFront()
[Windows.Forms.Application]::DoEvents()
$stage=$null
$launchReport=$null
$mutex=$null
$locked=$false
function Set-Phase([string]$s){
 if($form.IsDisposed){throw '安装已取消。'}
 $label.Text=$s
 [Windows.Forms.Application]::DoEvents()
}
function Assert-RegularDirectory([string]$path){
 if(Test-Path -LiteralPath $path){
  $item=Get-Item -LiteralPath $path -Force
  if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "安装目录不是普通文件夹：$path"}
 }
}
function Download-Official([string]$uri,[string]$destination){
 $client=New-Object Net.WebClient
 try{
  $client.Headers['User-Agent']='InkNote-Setup/0.6.1'
  $task=$client.DownloadFileTaskAsync([Uri]$uri,$destination)
  $watch=[Diagnostics.Stopwatch]::StartNew()
  while(-not $task.IsCompleted){
   if($form.IsDisposed){$client.CancelAsync();throw '安装已取消。'}
   if($watch.Elapsed.TotalMinutes -gt 10){$client.CancelAsync();throw '下载超时，请检查网络后重试。'}
   [Windows.Forms.Application]::DoEvents()
   Start-Sleep -Milliseconds 100
  }
  $task.GetAwaiter().GetResult()
 }finally{$client.Dispose()}
}
try{
 if(-not [Environment]::Is64BitOperatingSystem){throw '此版本适用于 64 位 Windows 10 或 Windows 11。'}
 $mutex=[Threading.Mutex]::new($false,'Local\InkNote-Setup')
 try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
 if(-not $locked){throw '另一个墨页安装程序正在运行，请等待它结束。'}
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 $root=Join-Path $env:LOCALAPPDATA 'Programs\InkNoteDesktop'
 Assert-RegularDirectory $root
 [void][IO.Directory]::CreateDirectory($root)
 $stage=Join-Path $root ('.setup-'+[Guid]::NewGuid().ToString('N'))
 [void][IO.Directory]::CreateDirectory($stage)
 Set-Phase '正在检查安装器内的最新版程序…'
 $appZip=Join-Path $stage 'app.zip'
 $source=[IO.File]::OpenRead($BundlePath)
 try{
  if($source.Length -lt 1024){throw '安装程序内容不完整。'}
  [void]$source.Seek(-88,[IO.SeekOrigin]::End)
  $footer=New-Object byte[] 88
  if($source.Read($footer,0,88)-ne 88){throw '安装程序尾部读取失败。'}
  if([Text.Encoding]::ASCII.GetString($footer,0,16)-ne 'INKNOTE_APP_V03!'){throw '安装程序内容标记无效。'}
  $length=[BitConverter]::ToUInt64($footer,16)
  $payloadHash=[Text.Encoding]::ASCII.GetString($footer,24,64)
  if($length -gt 100MB -or $length -gt ($source.Length-1024) -or $payloadHash -notmatch '^[a-f0-9]{64}$'){throw '安装程序数据长度或校验信息无效。'}
  [void]$source.Seek(-88-[long]$length,[IO.SeekOrigin]::End)
  $output=[IO.File]::Create($appZip)
  try{
   $buffer=New-Object byte[] 65536
   $remaining=[long]$length
   while($remaining -gt 0){
    $read=$source.Read($buffer,0,[int][Math]::Min($buffer.Length,$remaining))
    if($read -le 0){throw '安装程序数据不完整。'}
    $output.Write($buffer,0,$read)
    $remaining-=$read
   }
  }finally{$output.Dispose()}
 }finally{$source.Dispose()}
 if((Get-FileHash -LiteralPath $appZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $payloadHash){throw '墨页程序包校验失败，请重新下载安装器。'}
 $appStage=Join-Path $stage 'app'
 Expand-Archive -LiteralPath $appZip -DestinationPath $appStage
 $package=Get-Content -Raw -LiteralPath (Join-Path $appStage 'package.json') -Encoding UTF8 | ConvertFrom-Json
 if($package.name -ne 'inknote' -or $package.version -ne $appVersion){throw '安装程序中的墨页版本不匹配。'}
 foreach($required in @('desktop\main.cjs','desktop\preload.cjs','app\index.html','app\app.mjs','app\vendor\pdf.worker.min.mjs','tools\uninstall.exe')){
  if(-not (Test-Path -LiteralPath (Join-Path $appStage $required) -PathType Leaf)){throw "安装程序缺少文件：$required"}
 }
 $zip=Join-Path $stage $zipName
 $sha=Join-Path $stage 'SHASUMS256.txt'
 $near=Split-Path -Parent $BundlePath
 $nearZip=Join-Path $near $zipName
 $nearSha=Join-Path $near 'SHASUMS256.txt'
 if((Test-Path -LiteralPath $nearZip)-and(Test-Path -LiteralPath $nearSha)){
  Set-Phase '正在校验安装器旁边的桌面运行组件…'
  Copy-Item -LiteralPath $nearZip -Destination $zip
  Copy-Item -LiteralPath $nearSha -Destination $sha
 }else{
  Set-Phase "正在从 Electron 官方下载桌面运行组件。`n首次安装需要联网，请保持此窗口打开。`n关闭此窗口可取消。"
  Download-Official ($release+'SHASUMS256.txt') $sha
  Download-Official ($release+$zipName) $zip
 }
 $line=Get-Content -LiteralPath $sha | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?'+[regex]::Escape($zipName)+'$') } | Select-Object -First 1
 if(-not $line){throw '官方校验文件中没有匹配的 Windows 运行组件。'}
 $expected=($line -split '\s+')[0]
 if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected){throw '桌面运行组件的 SHA-256 校验失败，安装已停止。'}
 Set-Phase '正在安装墨页和桌面运行组件…'
 $unpacked=Join-Path $stage 'desktop'
 Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
 if(-not (Test-Path -LiteralPath (Join-Path $unpacked 'electron.exe'))){throw '桌面运行组件缺少主程序。'}
 Move-Item -LiteralPath $appStage -Destination (Join-Path $unpacked 'resources\app')
 Rename-Item -LiteralPath (Join-Path $unpacked 'electron.exe') -NewName 'InkNote.exe'
 foreach($process in @(Get-Process -Name InkNote -ErrorAction SilentlyContinue)){
  try{$runningPath=$process.Path}catch{$runningPath=$null}
  if(-not $runningPath -or $runningPath.StartsWith(($root+'\'),[StringComparison]::OrdinalIgnoreCase)){throw '请先保存笔记并关闭墨页，再重新运行安装程序。'}
 }
 $destination=Join-Path $root ('InkNote-'+$appVersion)
 Assert-RegularDirectory $destination
 if(Test-Path -LiteralPath $destination){
  $oldPackage=Get-Content -Raw -LiteralPath (Join-Path $destination 'resources\app\package.json') -Encoding UTF8 | ConvertFrom-Json
  if($oldPackage.name -ne 'inknote'){throw '目标目录不是可识别的墨页程序，安装已停止。'}
  $previous=Join-Path $root ('.previous-'+[Guid]::NewGuid().ToString('N'))
  Move-Item -LiteralPath $destination -Destination $previous
 }
 Move-Item -LiteralPath $unpacked -Destination $destination
 $exe=Join-Path $destination 'InkNote.exe'
 $uninstall=Join-Path $root 'Uninstall-InkNote.exe'
 Copy-Item -LiteralPath (Join-Path $destination 'resources\app\tools\uninstall.exe') -Destination $uninstall -Force
 $shell=New-Object -ComObject WScript.Shell
 foreach($folder in @([Environment]::GetFolderPath('Desktop'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'InkNote'))){
  [void][IO.Directory]::CreateDirectory($folder)
  $shortcut=$shell.CreateShortcut((Join-Path $folder '墨页 InkNote.lnk'))
  $shortcut.TargetPath=$exe
  $shortcut.WorkingDirectory=$destination
  $shortcut.Description='墨页：PDF、画布、电子书和帖子笔记'
  $shortcut.IconLocation=(Join-Path $destination 'resources\app\app\icon.ico')
  $shortcut.Save()
 }
 $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\InkNoteDesktop')
 try{
  $key.SetValue('DisplayName','墨页 InkNote')
  $key.SetValue('DisplayVersion',$appVersion)
  $key.SetValue('Publisher','InkNote')
  $key.SetValue('InstallLocation',$destination)
  $key.SetValue('DisplayIcon',(Join-Path $destination 'resources\app\app\icon.ico'))
  $key.SetValue('UninstallString',('"'+$uninstall+'"'))
  $key.SetValue('NoModify',1,[Microsoft.Win32.RegistryValueKind]::DWord)
  $key.SetValue('NoRepair',1,[Microsoft.Win32.RegistryValueKind]::DWord)
 }finally{$key.Dispose()}
 Set-Phase "墨页已安装。`n正在检查程序能否正常打开…"
 $launchReport=Join-Path $root ('.launch-'+[Guid]::NewGuid().ToString('N')+'.json')
 $process=Start-Process -FilePath $exe -WorkingDirectory $destination -ArgumentList @('--startup-report',('"'+$launchReport+'"')) -PassThru
 $watch=[Diagnostics.Stopwatch]::StartNew()
 while(-not (Test-Path -LiteralPath $launchReport)){
  if($process.HasExited){throw '墨页在页面初始化之前退出。请检查笔记数据目录中的 logs\startup.log。'}
  if($watch.Elapsed.TotalSeconds -gt 45){throw '启动检查超时。程序已安装，可从桌面重试；诊断文件位于笔记数据目录的 logs\startup.log。'}
  [Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 100
 }
 $ready=Get-Content -Raw -LiteralPath $launchReport -Encoding UTF8 | ConvertFrom-Json
 if(-not $ready.ok){throw ('程序已安装，但启动未完成：'+$ready.error)}
 $form.Close()
}catch{
 if(-not $form.IsDisposed){$form.Close()}
 [void][Windows.Forms.MessageBox]::Show(($_.Exception.Message+"`n`n在线安装需要访问 github.com 的 Electron 官方发布页。安装成功后，也可以从 Windows 已安装的应用卸载墨页。"),'墨页安装或启动未完成','OK','Error')
 exit 1
}finally{
 if($launchReport -and (Test-Path -LiteralPath $launchReport)){Remove-Item -LiteralPath $launchReport -Force -ErrorAction SilentlyContinue}
 if($stage -and (Test-Path -LiteralPath $stage)){Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
 if($locked -and $mutex){$mutex.ReleaseMutex()}
 if($mutex){$mutex.Dispose()}
}
exit 0
