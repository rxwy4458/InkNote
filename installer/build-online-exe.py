"""Build an x64 Windows GUI online installer using the local GNU toolchain.

Application code and a native uninstaller are embedded. At installation time,
Windows PowerShell downloads the pinned official Electron runtime and checks its
SHA-256. This build does not include that runtime or establish Windows QA.
"""
from pathlib import Path
import hashlib, io, json, re, struct, subprocess, sys, tempfile, zipfile

ROOT=Path(__file__).resolve().parents[1]
MARKER=b'INKNOTE_APP_V03!'
FOOTER_SIZE=88
KERNEL=['GetModuleFileNameW','GetTempPathW','GetSystemDirectoryW','GetCurrentProcessId','CreateDirectoryW','CreateFileW','WriteFile','CloseHandle','DeleteFileW','RemoveDirectoryW','CreateProcessW','WaitForSingleObject','GetExitCodeProcess','ExitProcess']
def u16(b,o):return struct.unpack_from('<H',b,o)[0]
def u32(b,o):return struct.unpack_from('<I',b,o)[0]

def inspect_bundle(binary):
    if len(binary)<FOOTER_SIZE or binary[-FOOTER_SIZE:-FOOTER_SIZE+16]!=MARKER:raise ValueError('Invalid online installer marker')
    length=struct.unpack_from('<Q',binary,len(binary)-FOOTER_SIZE+16)[0]
    if length>1024*1024*1024 or length>len(binary)-FOOTER_SIZE-1024:raise ValueError('Invalid application archive length')
    payload=binary[-FOOTER_SIZE-length:-FOOTER_SIZE]
    if hashlib.sha256(payload).hexdigest().encode()!=binary[-64:]:raise ValueError('Application archive SHA-256 mismatch')
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        bad=archive.testzip()
        if bad:raise ValueError('Corrupt application file: '+bad)
        package=json.loads(archive.read('package.json'))
        for file in ['desktop/main.cjs','desktop/preload.cjs','app/app.mjs','app/discussion.mjs','app/styles.css','app/vendor/pdf.worker.min.mjs','tools/uninstall.exe']:archive.getinfo(file)
        return {'version':package['version'],'payload_bytes':length,'files':len(archive.namelist()),'payload':payload}

def build(output,runtime_archive=None):
    package=json.loads((ROOT/'package.json').read_text())
    version=package['version'];runtime=package['devDependencies']['electron']
    offline=runtime_archive is not None
    runtime_info=None
    if offline:
        runtime_archive=Path(runtime_archive).resolve()
        runtime_info=json.loads((ROOT/'installer/runtime.json').read_text())
        assert runtime_info['version']==runtime and runtime_info['platform']=='win32-x64'
        with runtime_archive.open('rb') as source:
            actual_hash=hashlib.file_digest(source,'sha256').hexdigest()
        if actual_hash!=runtime_info['sha256']:raise ValueError('Official Windows runtime SHA-256 mismatch')
        with zipfile.ZipFile(runtime_archive) as archive:
            for required in ['electron.exe','ffmpeg.dll','icudtl.dat','resources.pak','resources/default_app.asar','version']:
                archive.getinfo(required)
            if archive.read('version').decode().strip().removeprefix('v')!=runtime:raise ValueError('Windows runtime version mismatch')
            executable=archive.read('electron.exe');pe=u32(executable,0x3c)
            if executable[:2]!=b'MZ' or u16(executable,pe+4)!=0x8664:raise ValueError('Windows x64 runtime required')
    script_source=(ROOT/('installer/setup-offline.ps1' if offline else 'installer/setup.ps1')).read_text()
    assert re.search(r"\$appVersion='([^']+)'",script_source)[1]==version
    assert re.search(r"\$electronVersion='([^']+)'",script_source)[1]==runtime
    script=b'\xef\xbb\xbf'+script_source.replace('\r\n','\n').replace('\n','\r\n').encode('utf-8')
    with tempfile.TemporaryDirectory(prefix='inknote-online-') as directory:
        temporary=Path(directory)
        (temporary/'setup-bytes.h').write_text('static const unsigned char setup_bytes[]={'+','.join(map(str,script))+'};\nstatic const U32 setup_bytes_length='+str(len(script))+';\n')
        subprocess.run(['gcc','-Os','-std=c11','-Wall','-Wextra','-Werror','-c','-m64','-mabi=ms','-mno-red-zone','-fshort-wchar','-ffreestanding','-fno-builtin','-fno-stack-protector','-fno-stack-clash-protection','-fno-asynchronous-unwind-tables','-fno-unwind-tables','-fno-ident','-fpie','-I',str(temporary),str(ROOT/'installer/bootstrap.c'),'-o',str(temporary/'bootstrap.o')],check=True)
        subprocess.run(['ld','-mi386pep','--subsystem','windows','--entry','entry','--image-base','0x140000000','--dynamicbase','--nxcompat','--no-insert-timestamp',str(temporary/'bootstrap.o'),'-o',str(temporary/'base.exe')],check=True)
        binary=bytearray((temporary/'base.exe').read_bytes())
        pe=u32(binary,0x3c);opt=pe+24
        assert binary[:2]==b'MZ' and binary[pe:pe+4]==b'PE\0\0'
        assert u16(binary,pe+4)==0x8664 and u16(binary,opt)==0x20b and u16(binary,opt+68)==2
        sections=opt+u16(binary,pe+20);idata=None
        for i in range(u16(binary,pe+6)):
            off=sections+i*40
            if binary[off:off+8].rstrip(b'\0')==b'.idata':idata=(u32(binary,off+12),u32(binary,off+20),u32(binary,off+16))
        assert idata is not None
        rva,raw,size=idata;assert size>=8192
        symbols=subprocess.check_output(['nm','-P',str(temporary/'base.exe')],text=True)
        address=int(next(line.split()[2] for line in symbols.splitlines() if line.split()[0]=='win_imports'),16)
        image_base=struct.unpack_from('<Q',binary,opt+24)[0]
        offset=address-image_base-rva;assert 0<=offset<0x100
        section=bytearray(8192);descriptor=0x200;cursor=0x400
        def put(data,alignment=1):
            nonlocal cursor
            cursor=(cursor+alignment-1)//alignment*alignment
            start=cursor;section[start:start+len(data)]=data;cursor+=len(data)
            assert cursor<len(section)
            return start
        for index,(dll,names,slot) in enumerate([('KERNEL32.dll',KERNEL,0),('USER32.dll',['MessageBoxW'],16)]):
            name=put(dll.encode()+b'\0')
            thunks=[rva+put(b'\0\0'+fn.encode()+b'\0',2) for fn in names]
            ilt=put(struct.pack('<'+'Q'*(len(thunks)+1),*thunks,0),8)
            for i,thunk in enumerate(thunks):struct.pack_into('<Q',section,offset+(slot+i)*8,thunk)
            struct.pack_into('<IIIII',section,descriptor+index*20,rva+ilt,0,0,rva+name,rva+offset+slot*8)
        binary[raw:raw+8192]=section
        struct.pack_into('<II',binary,opt+112+8,rva+descriptor,60)
        struct.pack_into('<II',binary,opt+112+12*8,rva+offset,18*8)
        struct.pack_into('<I',binary,opt+64,0)
        uninstall=temporary/'uninstall.exe'
        subprocess.run([sys.executable,str(ROOT/'installer/build-uninstaller.py'),'--current',str(uninstall)],check=True,stdout=subprocess.DEVNULL)
        app=io.BytesIO()
        with zipfile.ZipFile(app,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for folder in ['app','desktop']:
                for file in sorted((ROOT/folder).rglob('*')):
                    if file.is_file():archive.write(file,file.relative_to(ROOT))
            metadata={key:value for key,value in package.items() if key not in ['scripts','devDependencies','build']}
            archive.writestr('package.json',json.dumps(metadata,ensure_ascii=False))
            archive.write(uninstall,'tools/uninstall.exe')
            if offline:
                archive.write(runtime_archive,'tools/'+runtime_info['file_name'],compress_type=zipfile.ZIP_STORED)
                archive.writestr('tools/runtime.json',json.dumps(runtime_info,ensure_ascii=False))
        payload=app.getvalue()
        binary+=payload+MARKER+struct.pack('<Q',len(payload))+hashlib.sha256(payload).hexdigest().encode()
        inspection=inspect_bundle(binary)
        assert script in binary
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_bytes(binary)
        return {'exe':str(output),'bytes':len(binary),'version':version,'electron':runtime,'architecture':'Windows x64','subsystem':'GUI','installer':'offline' if offline else 'online','embedded_application_files':inspection['files'],'sha256':hashlib.sha256(binary).hexdigest(),'runtime_embedded':offline,'windows_tested':False}

if __name__=='__main__':
    version=json.loads((ROOT/'package.json').read_text())['version']
    output=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT.parent/('InkNote-Setup-'+version+'-online.exe')
    print(json.dumps(build(output)))
