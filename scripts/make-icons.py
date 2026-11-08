"""Rebuild app/icon.png and app/icon.ico from app/icon.svg (and app/brand/icon-small.svg for 16-24 px).

Needs rsvg-convert and Pillow. Icons up to 48 px are stored as 32-bit DIBs, larger ones as PNG,
which every Windows version since Vista reads, both in .ico files and in EXE resources.
"""
from pathlib import Path
import io, struct, subprocess, tempfile
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
SIZES=[16,20,24,32,40,48,64,128,256]
def render(svg,size):
    with tempfile.TemporaryDirectory() as t:
        out=Path(t)/'i.png';subprocess.run(['rsvg-convert','-w',str(size),'-h',str(size),str(svg),'-o',str(out)],check=True)
        return Image.open(out).convert('RGBA')
def dib(image):
    w,h=image.size;pixels=image.tobytes('raw','BGRA')
    rows=[pixels[y*w*4:(y+1)*w*4] for y in range(h)][::-1]
    mask_stride=((w+31)//32)*4
    return struct.pack('<IiiHHIIiiII',40,w,h*2,1,32,0,0,0,0,0,0)+b''.join(rows)+b'\0'*mask_stride*h
def ico(images):
    entries=[];blobs=[];offset=6+16*len(images)
    for image in images:
        w,h=image.size
        if w>=64:buf=io.BytesIO();image.save(buf,'PNG',optimize=True);data=buf.getvalue()
        else:data=dib(image)
        entries.append(struct.pack('<BBBBHHII',w%256,h%256,0,0,1,32,len(data),offset));blobs.append(data);offset+=len(data)
    return struct.pack('<HHH',0,1,len(images))+b''.join(entries)+b''.join(blobs)
if __name__=='__main__':
    images=[render(ROOT/('app/brand/icon-small.svg' if s<=24 else 'app/icon.svg'),s) for s in SIZES]
    (ROOT/'app/icon.ico').write_bytes(ico(images))
    render(ROOT/'app/icon.svg',512).save(ROOT/'app/icon.png',optimize=True)
    print('icons:',', '.join(map(str,SIZES)))
