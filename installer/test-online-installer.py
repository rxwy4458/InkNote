"""Inspect the deliverable itself; this is not a Windows execution test."""
from pathlib import Path
import hashlib, importlib.util, io, json, os, shutil, struct, subprocess, sys, tempfile, zipfile
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('online_builder',root/'installer/build-online-exe.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
version=json.loads((root/'package.json').read_text())['version']
file=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root.parent/('InkNote-Setup-'+version+'-online.exe')
binary=file.read_bytes();report=builder.inspect_bundle(binary)
assert report['version']==version
def pe_imports(data):
 pe=builder.u32(data,0x3c);opt=pe+24;sections=opt+builder.u16(data,pe+20)
 assert data[:2]==b'MZ' and builder.u16(data,pe+4)==0x8664 and builder.u16(data,opt)==0x20b
 assert builder.u16(data,opt+68)==2 and builder.u16(data,opt+70)&0x140==0x140
 def offset(rva):
  for i in range(builder.u16(data,pe+6)):
   section=sections+i*40;address=builder.u32(data,section+12);size=max(builder.u32(data,section+8),builder.u32(data,section+16))
   if address<=rva<address+size:return builder.u32(data,section+20)+rva-address
  raise AssertionError('RVA outside sections')
 def string(rva):
  start=offset(rva);return data[start:data.index(b'\0',start)].decode('ascii')
 reloc=builder.u32(data,opt+112+5*8);assert reloc
 cursor=offset(builder.u32(data,opt+112+8));imports={}
 while builder.u32(data,cursor):
  ilt,_,_,name,iat=struct.unpack_from('<IIIII',data,cursor);names=[];index=0
  while True:
   value=struct.unpack_from('<Q',data,offset(ilt)+index*8)[0]
   assert value==struct.unpack_from('<Q',data,offset(iat)+index*8)[0]
   if not value:break
   names.append('#'+str(value&0xffff) if value&(1<<63) else string(value+2));index+=1
  imports[string(name).lower()]=names;cursor+=20
 return imports
imports=pe_imports(binary)
def has_icon(data):
 pe=builder.u32(data,0x3c);opt=pe+24;return builder.u32(data,opt+112+2*8)!=0
assert has_icon(binary),'installer icon resource missing'
assert imports=={'kernel32.dll':builder.KERNEL,'user32.dll':['MessageBoxW']}
with zipfile.ZipFile(io.BytesIO(report['payload'])) as archive:
 offline='tools/runtime.json' in archive.namelist()
 for folder in ['app','desktop']:
  for source in (root/folder).rglob('*'):
   if source.is_file():assert archive.read(str(source.relative_to(root)))==source.read_bytes()
 assert b'reply-reference' not in archive.read('app/app.mjs')
 assert b'comment-reply' in archive.read('app/app.mjs')
 assert b'publishDiscussionDraft' in archive.read('app/app.mjs')
 assert '发新楼层'.encode() in archive.read('app/app.mjs')
 uninstall=archive.read('tools/uninstall.exe')
 assert 'RegDeleteTreeW' in pe_imports(uninstall)['advapi32.dll']
 assert has_icon(uninstall),'uninstaller icon resource missing'
 assert ('InkNote-'+version).encode('utf-16le') in uninstall
 if offline:
  runtime=json.loads(archive.read('tools/runtime.json'))
  assert runtime==json.loads((root/'installer/runtime.json').read_text())
  runtime_bytes=archive.read('tools/'+runtime['file_name'])
  assert len(runtime_bytes)==runtime['size_bytes']
  assert hashlib.sha256(runtime_bytes).hexdigest()==runtime['sha256']
  with zipfile.ZipFile(io.BytesIO(runtime_bytes)) as electron:
   assert electron.read('version').decode().strip()==runtime['version']
   assert electron.testzip() is None
   pe_imports(electron.read('electron.exe'))
script_source=(root/('installer/setup-offline.ps1' if offline else 'installer/setup.ps1')).read_text(encoding='utf-8-sig')
if offline:
 for forbidden in ['Download-Official','WebClient','Invoke-WebRequest','DownloadFile','https://','http://']:
  assert forbidden not in script_source,forbidden
 assert 'tools\\runtime.json' in script_source
script=b'\xef\xbb\xbf'+script_source.replace('\r\n','\n').replace('\n','\r\n').encode('utf-8')
assert script in binary
# Exactly one byte-order mark in front of param(...): a second one (0.7.0) made Windows PowerShell skip the param block,
# so -BundlePath was never bound and the installer stopped with "空路径名是非法的".
start=binary.index(script)
assert binary[start-3:start]!=b'\xef\xbb\xbf' and script[3:9]==b'param(' and '\ufeff' not in script_source,'setup script must start with one BOM and param('
# With PowerShell available (PWSH=path, or pwsh on PATH): the embedded script, written out as the bootstrapper writes it,
# must bind -BundlePath.
pwsh=os.environ.get('PWSH') or shutil.which('pwsh')
if pwsh:
 with tempfile.TemporaryDirectory(prefix='inknote-script-') as folder:
  first=script.split(b'\r\n',1)[0]
  probe=Path(folder)/'setup.ps1';probe.write_bytes(first+b'\r\n"BOUND=[$BundlePath]"\r\n')
  out=subprocess.run([pwsh,'-NoLogo','-NoProfile','-NonInteractive','-File',str(probe),'-BundlePath','C:\\Temp\\InkNote-Setup.exe'],capture_output=True,text=True,timeout=120)
  assert 'BOUND=[C:\\Temp\\InkNote-Setup.exe]' in out.stdout,(out.stdout,out.stderr)
  full=Path(folder)/'full.ps1';full.write_bytes(script)
  checker=Path(folder)/'check.ps1'
  checker.write_text("param([string]$Target)\n$e=$null;$t=$null\n$a=[System.Management.Automation.Language.Parser]::ParseFile($Target,[ref]$t,[ref]$e)\nif($e.Count){$e|ForEach-Object{$_.Message};exit 4}\nif(-not $a.ParamBlock -or ($a.ParamBlock.Parameters.Name.VariablePath.UserPath -notcontains 'BundlePath')){exit 3}\n'PARSED'\n",encoding='utf-8')
  check=subprocess.run([pwsh,'-NoLogo','-NoProfile','-NonInteractive','-File',str(checker),'-Target',str(full)],capture_output=True,text=True,timeout=120)
  assert check.returncode==0 and 'PARSED' in check.stdout,(check.returncode,check.stdout,check.stderr)
damaged=bytearray(binary);damaged[-builder.FOOTER_SIZE-100]^=1
try:builder.inspect_bundle(damaged)
except ValueError as error:assert 'SHA-256' in str(error)
else:raise AssertionError('Corrupt archive accepted')
print('PASS: x64 GUI PE imports/relocations, script bytes, latest app files, nested replies, registered uninstaller, archive integrity and corruption rejection.'+(' Complete official runtime embedded; installer contains no download code.' if offline else '')+' Windows execution remains unverified.')
