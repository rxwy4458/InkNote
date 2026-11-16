param([Parameter(Mandatory=$true)][string]$BundlePath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$electronVersion='45.2.3'
$appVersion='0.7.0'
$zipName="electron-v$electronVersion-win32-x64.zip"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
# ---------- Step 1: options (traditional installer: folder, shortcuts) ----------
$regPath='Software\Microsoft\Windows\CurrentVersion\Uninstall\InkNoteDesktop'
$defaultRoot=Join-Path $env:LOCALAPPDATA 'Programs\InkNoteDesktop'
$previousLocation=$null
try{$regKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($regPath);if($regKey){$previousLocation=[string]$regKey.GetValue('InstallLocation');$regKey.Dispose()}}catch{}
$previousRoot=$null
if($previousLocation -and (Test-Path -LiteralPath (Join-Path $previousLocation 'resources\app\package.json') -PathType Leaf)){$previousRoot=(Split-Path -Parent $previousLocation).TrimEnd('\')}
$initialRoot=$defaultRoot
if($previousRoot){$initialRoot=$previousRoot}
function Test-InstallRoot([string]$candidate){
 if(-not $candidate){return '请选择安装位置。'}
 if($candidate.Length -gt 150){return '安装位置的路径太长，请选一个短一些的文件夹（例如 D:\Apps\InkNote）。'}
 if(-not [IO.Path]::IsPathRooted($candidate) -or $candidate.StartsWith('\\')){return '请选择本机磁盘上的文件夹（例如 D:\Apps\InkNote）。'}
 try{$full=[IO.Path]::GetFullPath($candidate).TrimEnd('\')}catch{return '安装位置无效。'}
 if($full.Length -le 3){return '请选择一个文件夹，不要直接装在磁盘根目录。'}
 $windowsDir=[Environment]::GetFolderPath('Windows').TrimEnd('\')
 if($windowsDir -and $full.StartsWith($windowsDir,[StringComparison]::OrdinalIgnoreCase)){return '不能安装到 Windows 系统文件夹。'}
 if(Test-Path -LiteralPath $full){
  $item=Get-Item -LiteralPath $full -Force
  if(-not $item.PSIsContainer){return '这个位置是一个文件，不是文件夹。'}
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){return '这个文件夹是一个链接，请选择普通文件夹。'}
  $children=@(Get-ChildItem -LiteralPath $full -Force)
  $ours=@($children | Where-Object { $_.Name -like 'InkNote-*' -or $_.Name -like '.previous-*' -or $_.Name -like '.setup-*' -or $_.Name -like '.launch-*' -or $_.Name -eq 'Uninstall-InkNote.exe' })
  if($children.Count -gt 0 -and $ours.Count -eq 0){return "这个文件夹里已经有别的文件。`n为了卸载时不误删其他内容，请选择一个空文件夹，或者在路径后面加上 \InkNote。"}
 }
 try{$drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($full));if($drive.IsReady -and $drive.AvailableFreeSpace -lt 700MB){return '这个磁盘的剩余空间不足。安装需要约 700 MB（其中一部分是安装时的临时文件）。'}}catch{}
 try{
  [void][IO.Directory]::CreateDirectory($full)
  $probe=Join-Path $full ('.write-test-'+[Guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText($probe,'ok')
  Remove-Item -LiteralPath $probe -Force
 }catch{return "没有写入这个文件夹的权限。`n请选择其他位置（例如 D:\Apps\InkNote），或右键安装程序选择「以管理员身份运行」。"}
 return $null
}
$uiFont=New-Object System.Drawing.Font('Microsoft YaHei UI',9.5)
$options=New-Object System.Windows.Forms.Form
$options.Text="安装墨页 InkNote $appVersion"
$options.ClientSize=New-Object System.Drawing.Size(560,372)
$options.StartPosition='CenterScreen'
$options.FormBorderStyle='FixedDialog'
$options.MaximizeBox=$false
$options.MinimizeBox=$false
$options.Font=$uiFont
try{$options.Icon=[System.Drawing.Icon]::ExtractAssociatedIcon($BundlePath)}catch{}
$heading=New-Object System.Windows.Forms.Label
$heading.Location=New-Object System.Drawing.Point(24,18)
$heading.Size=New-Object System.Drawing.Size(512,30)
$heading.Font=New-Object System.Drawing.Font('Microsoft YaHei UI',14,[System.Drawing.FontStyle]::Bold)
$heading.Text="安装墨页 InkNote $appVersion"
$options.Controls.Add($heading)
$intro=New-Object System.Windows.Forms.Label
$intro.Location=New-Object System.Drawing.Point(24,54)
$intro.Size=New-Object System.Drawing.Size(512,40)
$intro.Text='PDF 批注、手写画布、二维模板画布、帖子和电子书笔记。安装包已包含全部运行组件，安装过程不需要联网。'
$options.Controls.Add($intro)
$folderLabel=New-Object System.Windows.Forms.Label
$folderLabel.Location=New-Object System.Drawing.Point(24,102)
$folderLabel.Size=New-Object System.Drawing.Size(512,22)
$folderLabel.Text='安装位置'
$options.Controls.Add($folderLabel)
$folderBox=New-Object System.Windows.Forms.TextBox
$folderBox.Location=New-Object System.Drawing.Point(24,126)
$folderBox.Size=New-Object System.Drawing.Size(420,27)
$folderBox.Text=$initialRoot
$options.Controls.Add($folderBox)
$browse=New-Object System.Windows.Forms.Button
$browse.Location=New-Object System.Drawing.Point(452,124)
$browse.Size=New-Object System.Drawing.Size(84,30)
$browse.Text='浏览…'
$options.Controls.Add($browse)
$folderHint=New-Object System.Windows.Forms.Label
$folderHint.Location=New-Object System.Drawing.Point(24,158)
$folderHint.Size=New-Object System.Drawing.Size(512,40)
$folderHint.ForeColor=[System.Drawing.Color]::DimGray
$folderHint.Text="程序装在这个文件夹里（版本文件夹 InkNote-$appVersion 和卸载程序）。笔记保存在 %APPDATA%\InkNote，卸载不会删除笔记。"
$options.Controls.Add($folderHint)
$desktopBox=New-Object System.Windows.Forms.CheckBox
$desktopBox.Location=New-Object System.Drawing.Point(24,204)
$desktopBox.Size=New-Object System.Drawing.Size(500,24)
$desktopBox.Text='创建桌面快捷方式'
$desktopBox.Checked=$true
$options.Controls.Add($desktopBox)
$startBox=New-Object System.Windows.Forms.CheckBox
$startBox.Location=New-Object System.Drawing.Point(24,232)
$startBox.Size=New-Object System.Drawing.Size(500,24)
$startBox.Text='创建开始菜单快捷方式'
$startBox.Checked=$true
$options.Controls.Add($startBox)
$launchBox=New-Object System.Windows.Forms.CheckBox
$launchBox.Location=New-Object System.Drawing.Point(24,260)
$launchBox.Size=New-Object System.Drawing.Size(500,24)
$launchBox.Text='安装完成后打开墨页'
$launchBox.Checked=$true
$options.Controls.Add($launchBox)
$spaceLabel=New-Object System.Windows.Forms.Label
$spaceLabel.Location=New-Object System.Drawing.Point(24,296)
$spaceLabel.Size=New-Object System.Drawing.Size(512,22)
$spaceLabel.ForeColor=[System.Drawing.Color]::DimGray
$spaceLabel.Text='需要约 420 MB 磁盘空间。'
$options.Controls.Add($spaceLabel)
$installButton=New-Object System.Windows.Forms.Button
$installButton.Location=New-Object System.Drawing.Point(352,328)
$installButton.Size=New-Object System.Drawing.Size(88,32)
$installButton.Text='安装'
$options.Controls.Add($installButton)
$options.AcceptButton=$installButton
$cancelButton=New-Object System.Windows.Forms.Button
$cancelButton.Location=New-Object System.Drawing.Point(448,328)
$cancelButton.Size=New-Object System.Drawing.Size(88,32)
$cancelButton.Text='取消'
$cancelButton.DialogResult=[System.Windows.Forms.DialogResult]::Cancel
$options.Controls.Add($cancelButton)
$options.CancelButton=$cancelButton
$script:installRoot=$null
$browse.Add_Click({
 $picker=New-Object System.Windows.Forms.FolderBrowserDialog
 $picker.Description='选择安装位置（会在里面建立 InkNote 文件夹）'
 $picker.ShowNewFolderButton=$true
 $start=$folderBox.Text
 while($start -and -not (Test-Path -LiteralPath $start)){$start=Split-Path -Parent $start}
 if($start){$picker.SelectedPath=$start}
 if($picker.ShowDialog($options) -eq [System.Windows.Forms.DialogResult]::OK){
  $chosen=$picker.SelectedPath.TrimEnd('\')
  $leaf=Split-Path -Leaf $chosen
  if($leaf -notlike '*InkNote*' -and $leaf -notlike '*墨页*'){$chosen=Join-Path $chosen 'InkNote'}
  $folderBox.Text=$chosen
 }
 $picker.Dispose()
})
$installButton.Add_Click({
 $problem=Test-InstallRoot $folderBox.Text.Trim()
 if($problem){[void][Windows.Forms.MessageBox]::Show($options,$problem,'安装位置','OK','Warning');return}
 $script:installRoot=[IO.Path]::GetFullPath($folderBox.Text.Trim()).TrimEnd('\')
 $options.DialogResult=[System.Windows.Forms.DialogResult]::OK
 $options.Close()
})
[void]$options.ShowDialog()
$wantDesktop=$desktopBox.Checked
$wantStartMenu=$startBox.Checked
$wantLaunch=$launchBox.Checked
$options.Dispose()
if(-not $script:installRoot){exit 0}
# ---------- Step 2: install ----------
$form=New-Object System.Windows.Forms.Form
$form.Text="安装墨页 InkNote $appVersion"
$form.Size=New-Object System.Drawing.Size(530,255)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.MinimizeBox=$false
try{$form.Icon=[System.Drawing.Icon]::ExtractAssociatedIcon($BundlePath)}catch{}
$label=New-Object System.Windows.Forms.Label
$label.Location=New-Object System.Drawing.Point(28,27)
$label.Size=New-Object System.Drawing.Size(465,112)
$label.Font=New-Object System.Drawing.Font('Microsoft YaHei UI',10)
$label.Text="正在准备安装墨页。`n安装位置：$($script:installRoot)"
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
$checkDir=$null
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
try{
 if(-not [Environment]::Is64BitOperatingSystem){throw '此版本适用于 64 位 Windows 10 或 Windows 11。'}
 $mutex=[Threading.Mutex]::new($false,'Local\InkNote-Setup')
 try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
 if(-not $locked){throw '另一个墨页安装程序正在运行，请等待它结束。'}
 $root=$script:installRoot
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
  if($length -gt 1GB -or $length -gt ($source.Length-1024) -or $payloadHash -notmatch '^[a-f0-9]{64}$'){throw '安装程序数据长度或校验信息无效。'}
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
 Set-Phase '正在校验安装器内的完整桌面运行组件…'
 $runtimeInfo=Get-Content -Raw -LiteralPath (Join-Path $appStage 'tools\runtime.json') -Encoding UTF8 | ConvertFrom-Json
 if($runtimeInfo.version -ne $electronVersion -or $runtimeInfo.platform -ne 'win32-x64' -or $runtimeInfo.file_name -ne $zipName -or $runtimeInfo.sha256 -notmatch '^[a-f0-9]{64}$'){throw '安装器中的运行组件信息无效。'}
 $zip=Join-Path $appStage ('tools\'+$zipName)
 if(-not (Test-Path -LiteralPath $zip -PathType Leaf)){throw '离线安装包缺少桌面运行组件。'}
 if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeInfo.sha256){throw '桌面运行组件的 SHA-256 校验失败，请重新获取完整安装文件。'}
 Set-Phase '正在安装墨页和桌面运行组件…'
 $unpacked=Join-Path $stage 'desktop'
 Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
 Remove-Item -LiteralPath $zip -Force
 if(-not (Test-Path -LiteralPath (Join-Path $unpacked 'electron.exe'))){throw '桌面运行组件缺少主程序。'}
 Move-Item -LiteralPath $appStage -Destination (Join-Path $unpacked 'resources\app')
 Rename-Item -LiteralPath (Join-Path $unpacked 'electron.exe') -NewName 'InkNote.exe'
 foreach($process in @(Get-Process -Name InkNote -ErrorAction SilentlyContinue)){
  try{$runningPath=$process.Path}catch{$runningPath=$null}
  $inOld=$previousRoot -and $runningPath -and $runningPath.StartsWith(($previousRoot+'\'),[StringComparison]::OrdinalIgnoreCase)
  if(-not $runningPath -or $inOld -or $runningPath.StartsWith(($root+'\'),[StringComparison]::OrdinalIgnoreCase)){throw '请先保存笔记并关闭墨页，再重新运行安装程序。'}
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
 foreach($place in @(@{Folder=[Environment]::GetFolderPath('Desktop');Want=$wantDesktop},@{Folder=(Join-Path ([Environment]::GetFolderPath('Programs')) 'InkNote');Want=$wantStartMenu})){
  $link=Join-Path $place.Folder '墨页 InkNote.lnk'
  if($place.Want){
   [void][IO.Directory]::CreateDirectory($place.Folder)
   $shortcut=$shell.CreateShortcut($link)
   $shortcut.TargetPath=$exe
   $shortcut.WorkingDirectory=$destination
   $shortcut.Description='墨页：PDF、画布、电子书和帖子笔记'
   $shortcut.IconLocation=(Join-Path $destination 'resources\app\app\icon.ico')
   $shortcut.Save()
  }elseif(Test-Path -LiteralPath $link -PathType Leaf){
   # not wanted now: remove an old shortcut of ours (it would point at a version that is no longer there)
   try{$old=$shell.CreateShortcut($link);if($old.TargetPath -like '*\InkNote.exe'){Remove-Item -LiteralPath $link -Force}}catch{}
  }
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
 # An earlier install in a different folder: remove its program files (notes are never inside the program folder).
 if($previousRoot -and -not $previousRoot.Equals($root,[StringComparison]::OrdinalIgnoreCase)){
  try{
   foreach($old in @(Get-ChildItem -LiteralPath $previousRoot -Force -Directory | Where-Object { $_.Name -like 'InkNote-*' -or $_.Name -like '.previous-*' })){
    if($old.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
    $oldPackage=Join-Path $old.FullName 'resources\app\package.json'
    if(-not (Test-Path -LiteralPath $oldPackage -PathType Leaf)){continue}
    if((Get-Content -Raw -LiteralPath $oldPackage -Encoding UTF8 | ConvertFrom-Json).name -ne 'inknote'){continue}
    Remove-Item -LiteralPath $old.FullName -Recurse -Force -ErrorAction SilentlyContinue
   }
   $oldUninstaller=Join-Path $previousRoot 'Uninstall-InkNote.exe'
   if(Test-Path -LiteralPath $oldUninstaller -PathType Leaf){Remove-Item -LiteralPath $oldUninstaller -Force -ErrorAction SilentlyContinue}
   if(@(Get-ChildItem -LiteralPath $previousRoot -Force).Count -eq 0){Remove-Item -LiteralPath $previousRoot -Force -ErrorAction SilentlyContinue}
  }catch{}
 }
 Set-Phase "墨页已安装到：$destination`n正在检查程序能否正常打开…"
 if($wantLaunch){
  $launchReport=Join-Path $root ('.launch-'+[Guid]::NewGuid().ToString('N')+'.json')
  $launchArgs=@('--startup-report',('"'+$launchReport+'"'))
 }else{
  # check without opening a window: a separate test profile in a temporary folder, removed afterwards
  $checkDir=Join-Path ([IO.Path]::GetTempPath()) ('inknote-check-'+[Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($checkDir)
  $launchReport=Join-Path $checkDir 'report.json'
  $launchArgs=@('--smoke-test-output',('"'+$launchReport+'"'))
 }
 $process=Start-Process -FilePath $exe -WorkingDirectory $destination -ArgumentList $launchArgs -PassThru
 $watch=[Diagnostics.Stopwatch]::StartNew()
 while(-not (Test-Path -LiteralPath $launchReport)){
  if($process.HasExited){throw '墨页在页面初始化之前退出。请检查笔记数据目录中的 logs\startup.log。'}
  if($watch.Elapsed.TotalSeconds -gt 45){throw ('启动检查超时。程序已安装在 '+$destination+'，可以稍后再打开；诊断文件位于笔记数据目录的 logs\startup.log。')}
  [Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 100
 }
 $ready=Get-Content -Raw -LiteralPath $launchReport -Encoding UTF8 | ConvertFrom-Json
 if(-not $ready.ok){throw ('程序已安装，但启动未完成：'+$ready.error)}
 $form.Close()
 if(-not $wantLaunch){
  $where=@();if($wantDesktop){$where+='桌面'};if($wantStartMenu){$where+='开始菜单'}
  $how=$(if($where.Count){'可以从'+($where -join '或')+'打开墨页。'}else{'没有创建快捷方式，可以直接运行 '+$exe+'。'})
  [void][Windows.Forms.MessageBox]::Show(("墨页 InkNote $appVersion 已安装。`n`n位置：$destination`n"+$how),'安装完成','OK','Information')
 }
}catch{
 if(-not $form.IsDisposed){$form.Close()}
 [void][Windows.Forms.MessageBox]::Show(($_.Exception.Message+"`n`n本安装包已包含运行组件，无需联网。安装成功后，可从 Windows 已安装的应用卸载墨页。"),'墨页安装或启动未完成','OK','Error')
 exit 1
}finally{
 if($launchReport -and (Test-Path -LiteralPath $launchReport)){Remove-Item -LiteralPath $launchReport -Force -ErrorAction SilentlyContinue}
 if($checkDir -and (Test-Path -LiteralPath $checkDir)){Remove-Item -LiteralPath $checkDir -Recurse -Force -ErrorAction SilentlyContinue}
 if($stage -and (Test-Path -LiteralPath $stage)){Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
 if($locked -and $mutex){$mutex.ReleaseMutex()}
 if($mutex){$mutex.Dispose()}
}
exit 0
