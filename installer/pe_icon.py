"""Add an application icon (RT_ICON + RT_GROUP_ICON) to a freshly linked PE32+ image.

The installers and the uninstaller are linked with GNU ld, which has no resource compiler here,
so the .rsrc section is written directly: one new section, its resource tree, and the
data directory entry. Call it before anything is appended to the file (the overlay).
"""
import struct

def _u16(b,o):return struct.unpack_from('<H',b,o)[0]
def _u32(b,o):return struct.unpack_from('<I',b,o)[0]
def _align(v,a):return (v+a-1)//a*a

def ico_entries(ico):
    reserved,kind,count=struct.unpack_from('<HHH',ico,0)
    if reserved!=0 or kind!=1 or not 0<count<64:raise ValueError('Not an .ico file')
    out=[]
    for i in range(count):
        w,h,colors,_,planes,bits,size,offset=struct.unpack_from('<BBBBHHII',ico,6+16*i)
        out.append({'w':w,'h':h,'colors':colors,'planes':planes,'bits':bits,'data':ico[offset:offset+size]})
    return out

def resource_section(entries,rva):
    """Resource tree: type → id → language(0) → data, for RT_ICON (3) and RT_GROUP_ICON (14)."""
    group=struct.pack('<HHH',0,1,len(entries))+b''.join(struct.pack('<BBBBHHIH',e['w'],e['h'],e['colors'],0,e['planes'] or 1,e['bits'],len(e['data']),i+1) for i,e in enumerate(entries))
    leaves=[(3,i+1,e['data']) for i,e in enumerate(entries)]+[(14,1,group)]
    def directory(n):return struct.pack('<IIHHHH',0,0,0,0,0,n)
    # layout: root dir, type dirs, name dirs, language dirs, data entries, data
    types=[(3,[l for l in leaves if l[0]==3]),(14,[l for l in leaves if l[0]==14])]
    root_size=16+8*len(types)
    type_offsets=[];cursor=root_size
    for _,items in types:type_offsets.append(cursor);cursor+=16+8*len(items)
    lang_offsets=[];
    for _,items in types:
        for _ in items:lang_offsets.append(cursor);cursor+=16+8
    data_entries=cursor;cursor+=16*len(leaves)
    data_offsets=[]
    for _,_,blob in [l for _,items in types for l in items]:
        cursor=_align(cursor,8);data_offsets.append(cursor);cursor+=len(blob)
    out=bytearray(_align(cursor,8))
    out[0:16]=directory(len(types))
    for i,(kind,items) in enumerate(types):
        struct.pack_into('<II',out,16+8*i,kind,0x80000000|type_offsets[i])
    leaf=0
    for t,(kind,items) in enumerate(types):
        base=type_offsets[t];out[base:base+16]=directory(len(items))
        for j,(_,ident,_) in enumerate(items):
            struct.pack_into('<II',out,base+16+8*j,ident,0x80000000|lang_offsets[leaf+j])
        for j in range(len(items)):
            lb=lang_offsets[leaf+j];out[lb:lb+16]=directory(1)
            struct.pack_into('<II',out,lb+16,0,data_entries+16*(leaf+j))
        leaf+=len(items)
    for k,(_,_,blob) in enumerate([l for _,items in types for l in items]):
        struct.pack_into('<IIII',out,data_entries+16*k,rva+data_offsets[k],len(blob),0,0)
        out[data_offsets[k]:data_offsets[k]+len(blob)]=blob
    return bytes(out)

def add_icon_resource(binary,ico):
    binary=bytearray(binary);pe=_u32(binary,0x3c);opt=pe+24
    if binary[pe:pe+4]!=b'PE\0\0' or _u16(binary,opt)!=0x20b:raise ValueError('PE32+ image required')
    count=_u16(binary,pe+6);sections=opt+_u16(binary,pe+20)
    file_align=_u32(binary,opt+36);section_align=_u32(binary,opt+32);headers=_u32(binary,opt+60)
    if _u32(binary,opt+112+2*8):raise ValueError('Image already has resources')
    table_end=sections+40*(count+1)
    first_raw=min(_u32(binary,sections+40*i+20) for i in range(count) if _u32(binary,sections+40*i+20))
    if table_end>headers or table_end>first_raw:raise ValueError('No room for another section header')
    last=sections+40*(count-1)
    va=_align(_u32(binary,last+12)+max(_u32(binary,last+8),_u32(binary,last+16)),section_align)
    raw_end=max(_u32(binary,sections+40*i+20)+_u32(binary,sections+40*i+16) for i in range(count))
    symbols=_u32(binary,pe+12)
    if symbols:                                   # GNU ld leaves a COFF symbol table after the sections; images do not need it
        if symbols<raw_end:raise ValueError('Symbol table inside the image')
        del binary[symbols:];struct.pack_into('<II',binary,pe+12,0,0)
    if len(binary)>_align(raw_end,file_align):raise ValueError('Unexpected data after the last section')
    raw=_align(len(binary),file_align)
    data=resource_section(ico_entries(ico),va);raw_size=_align(len(data),file_align)
    binary+=b'\0'*(raw-len(binary))+data+b'\0'*(raw_size-len(data))
    header=struct.pack('<8sIIIIIIHHI',b'.rsrc',len(data),va,raw_size,raw,0,0,0,0,0x40000040)
    binary[table_end-40:table_end]=header
    struct.pack_into('<H',binary,pe+6,count+1)
    struct.pack_into('<I',binary,opt+56,_align(va+len(data),section_align))      # SizeOfImage
    struct.pack_into('<I',binary,opt+8,_u32(binary,opt+8)+raw_size)              # SizeOfInitializedData
    struct.pack_into('<II',binary,opt+112+2*8,va,len(data))                      # resource directory
    return binary
