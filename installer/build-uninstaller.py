"""Build the independent legacy uninstaller with GNU gcc/binutils.

Uses a native Win32 GUI and system DLLs only. This is not an app installer.
The PE import table is generated explicitly; no executable bytes are downloaded.
Windows execution still needs verification on Windows.
"""
from pathlib import Path
import json, re, struct, subprocess, tempfile, sys

ROOT = Path(__file__).resolve().parents[1]
args=[value for value in sys.argv[1:] if value!='--current']
OUT = Path(args[0]).resolve() if args else ROOT.parent/'InkNote-Uninstall-Legacy.exe'
flags=['-DINKNOTE_CURRENT=1'] if '--current' in sys.argv else []
definitions=re.findall(r'(WIN_IMPORT|WIN_IMPORT_END)\((\w+)(?:,\s*(\w+))?\)',(ROOT/'installer/uninstall-imports.def').read_text())
groups={};slot_count=0
for kind,dll,name in definitions:
    if kind=='WIN_IMPORT':groups.setdefault(dll,[]).append((slot_count,name))
    else:assert dll in groups and groups[dll][-1][0]==slot_count-1
    slot_count+=1
assert 0<slot_count<64
def u16(b,o):return struct.unpack_from('<H',b,o)[0]
def u32(b,o):return struct.unpack_from('<I',b,o)[0]

with tempfile.TemporaryDirectory(prefix='inknote-uninstall-') as temporary:
    build=Path(temporary)
    subprocess.run(['gcc','-Os','-std=c11','-Wall','-Wextra','-Wno-misleading-indentation','-Werror','-c','-m64','-mabi=ms','-mno-red-zone','-fshort-wchar','-ffreestanding','-fno-builtin','-fno-stack-protector','-fno-stack-clash-protection','-fno-asynchronous-unwind-tables','-fno-unwind-tables','-fno-ident','-fpie',*flags,str(ROOT/'installer/uninstall.c'),'-o',str(build/'uninstall.o')],check=True)
    subprocess.run(['ld','-mi386pep','--subsystem','windows','--entry','entry','--image-base','0x140000000','--dynamicbase','--nxcompat','--no-insert-timestamp',str(build/'uninstall.o'),'-o',str(build/'base.exe')],check=True)
    binary=bytearray((build/'base.exe').read_bytes())
    pe=u32(binary,0x3c);opt=pe+24
    assert binary[:2]==b'MZ' and binary[pe:pe+4]==b'PE\0\0' and u16(binary,pe+4)==0x8664 and u16(binary,opt)==0x20b
    sections=opt+u16(binary,pe+20)
    idata=None
    for i in range(u16(binary,pe+6)):
        off=sections+i*40
        if binary[off:off+8].rstrip(b'\0')==b'.idata':idata=(u32(binary,off+12),u32(binary,off+20),u32(binary,off+16))
    assert idata is not None
    rva,raw,size=idata;assert size>=8192
    symbols=subprocess.check_output(['nm','-P',str(build/'base.exe')],text=True)
    address=int(next(line.split()[2] for line in symbols.splitlines() if line.split()[0]=='win_imports'),16)
    image_base=struct.unpack_from('<Q',binary,opt+24)[0];offset=address-image_base-rva
    assert 0<=offset<0x100
    section=bytearray(8192);descriptor=0x300;cursor=0x500
    def put(data,alignment=1):
        global cursor
        cursor=(cursor+alignment-1)//alignment*alignment
        start=cursor;section[start:start+len(data)]=data;cursor+=len(data)
        assert cursor<len(section)
        return start
    for index,(dll,names) in enumerate(groups.items()):
        assert [slot for slot,_ in names]==list(range(names[0][0],names[0][0]+len(names)))
        dll_name=put((dll+'.dll').encode()+b'\0')
        thunks=[rva+put(b'\0\0'+name.encode()+b'\0',2) for _,name in names]
        ilt=put(struct.pack('<'+'Q'*(len(thunks)+1),*thunks,0),8)
        for (slot,_),thunk in zip(names,thunks):struct.pack_into('<Q',section,offset+slot*8,thunk)
        assert struct.unpack_from('<Q',section,offset+(names[-1][0]+1)*8)[0]==0
        struct.pack_into('<IIIII',section,descriptor+index*20,rva+ilt,0,0,rva+dll_name,rva+offset+names[0][0]*8)
    OUT.parent.mkdir(parents=True,exist_ok=True)
    binary[raw:raw+8192]=section
    struct.pack_into('<II',binary,opt+112+8,rva+descriptor,(len(groups)+1)*20)
    struct.pack_into('<II',binary,opt+112+12*8,rva+offset,slot_count*8)
    struct.pack_into('<I',binary,opt+64,0)
    OUT.write_bytes(binary)
    print(json.dumps({'exe':str(OUT),'bytes':OUT.stat().st_size,'architecture':'Windows x64','subsystem':'GUI','runtime':'Windows system DLLs only','windows_tested':False}))
