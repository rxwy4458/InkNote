/* Legacy 0.2 uninstaller: native x64 Win32 GUI, no runtime/download/script.
 * Deletes only positively identified legacy program folders. Never traverses
 * reparse points. User document/image/archive formats are retained even if
 * someone exported them into a program folder. AppData profiles are untouched.
 * API declarations use fixed Windows widths; no C runtime is linked. */
typedef unsigned short W;
typedef unsigned int U32;
typedef int I32;
typedef unsigned long long U64;
typedef void *H;
#define API __attribute__((ms_abi))
#define CAP 32768
#define INVALID ((H)(U64)-1)
#define ATTR_DIR 0x10
#define ATTR_REPARSE 0x400
#define ABSENT 0xffffffffU
enum {
#define WIN_IMPORT(dll,name) Win##name,
#define WIN_IMPORT_END(dll) WinEnd##dll,
#include "uninstall-imports.def"
#undef WIN_IMPORT
#undef WIN_IMPORT_END
 WinCount
};
struct Imports {void *volatile slot[WinCount];unsigned char padding[8192-8*WinCount];};
__attribute__((section(".idata"),used)) struct Imports win_imports={0};
#define WIN(name,type) ((type)win_imports.slot[Win##name])
typedef U32 (API *FEnv)(const W*,W*,U32);
typedef U32 (API *FModule)(H,W*,U32);
typedef U32 (API *FFullPath)(const W*,U32,W*,W**);
typedef U32 (API *FAttributes)(const W*);
typedef int (API *FSetAttributes)(const W*,U32);
struct FindData {U32 attributes;U32 reserved[10];W name[260],alternate[14];};
typedef H (API *FFindFirst)(const W*,struct FindData*);
typedef int (API *FFindNext)(H,struct FindData*);
typedef int (API *FClose)(H);
typedef int (API *FDelete)(const W*);
typedef H (API *FCreateFile)(const W*,U32,U32,void*,U32,U32,H);
typedef int (API *FRead)(H,void*,U32,U32*,void*);
typedef U32 (API *FError)(void);
typedef void (API *FExit)(U32);
typedef int (API *FMessage)(H,const W*,const W*,U32);
struct ProcessEntry {U32 size,usage,pid;U64 heap;U32 module,threads,parent;I32 priority;U32 flags;W name[260];};
typedef H (API *FSnapshot)(U32,U32);
typedef int (API *FProcessNext)(H,struct ProcessEntry*);
typedef H (API *FOpenProcess)(U32,int,U32);
typedef int (API *FQueryProcess)(H,U32,W*,U32*);
typedef I32 (API *FFolder)(H,int,H,U32,W*);
typedef I32 (API *FCoInit)(void*,U32);
typedef void (API *FCoUninit)(void);
struct Guid {U32 a;unsigned short b,c;unsigned char d[8];};
typedef I32 (API *FCoCreate)(const struct Guid*,void*,U32,const struct Guid*,void**);
typedef I32 (API *FQueryInterface)(void*,const struct Guid*,void**);
typedef U32 (API *FRelease)(void*);
typedef I32 (API *FLoad)(void*,const W*,U32);
typedef I32 (API *FLinkPath)(void*,W*,int,struct FindData*,U32);
_Static_assert(sizeof(W)==2,"UTF-16 required");
_Static_assert(sizeof(struct FindData)==592,"WIN32_FIND_DATAW ABI");
_Static_assert(sizeof(struct ProcessEntry)==568,"PROCESSENTRY32W ABI");
_Static_assert(sizeof(struct Guid)==16,"GUID ABI");
static W legacy_root[CAP],work[CAP],scratch[CAP],target[CAP],canonical[CAP];
static unsigned char manifest[65537];
static U32 removed,retained,failed,recognized;
static const struct Guid CLSID_LINK={0x00021401,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const struct Guid IID_LINK={0x000214f9,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const struct Guid IID_FILE={0x0000010b,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static U32 length(const W*s){U32 n=0;while(s[n])n++;return n;}
static W lower(W c){return c>='A'&&c<='Z'?c+32:c;}
static int equal(const W*a,const W*b){U32 i=0;while(a[i]&&b[i]&&lower(a[i])==lower(b[i]))i++;return a[i]==0&&b[i]==0;}
static int prefix(const W*s,const W*p){for(U32 i=0;p[i];i++)if(lower(s[i])!=lower(p[i]))return 0;return 1;}
static int copy(W*d,const W*s){U32 n=length(s);if(n>=CAP)return 0;for(U32 i=0;i<=n;i++)d[i]=s[i];return 1;}
static int append(W*d,const W*s){U32 a=length(d),b=length(s);if(a+b>=CAP)return 0;for(U32 i=0;i<=b;i++)d[a+i]=s[i];return 1;}
static int join(W*d,const W*s){return append(d,(const W*)L"\\")&&append(d,s);}
static const W*basename_w(const W*s){const W*b=s;for(U32 i=0;s[i];i++)if(s[i]=='\\'||s[i]=='/')b=s+i+1;return b;}
static int inside_root(const W*s){U32 n=length(legacy_root);return n>0&&prefix(s,legacy_root)&&s[n]=='\\'&&s[n+1]!=0;}
static int old_name(const W*name){
 if(equal(name,(const W*)L"InkNote-0.2.0"))return 1;
#ifdef INKNOTE_CURRENT
 if(equal(name,(const W*)L"InkNote-0.3.1")||equal(name,(const W*)L"InkNote-0.3.2")||equal(name,(const W*)L"InkNote-0.3.3")||equal(name,(const W*)L"InkNote-0.4.0")||equal(name,(const W*)L"InkNote-0.5.0")||equal(name,(const W*)L"InkNote-0.6.0")||equal(name,(const W*)L"InkNote-0.6.1"))return 1;
#endif
 const W*p=(const W*)L".previous-";if(!prefix(name,p)||length(name)!=length(p)+32)return 0;
 for(U32 i=length(p);name[i];i++){W c=lower(name[i]);if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return 0;}return 1;
}
static int old_target(const W*s){
 if(!inside_root(s))return 0;const W*p=s+length(legacy_root)+1;U32 n=0;W name[80];
 while(p[n]&&p[n]!='\\'&&n<79){name[n]=p[n];n++;}name[n]=0;
 return old_name(name)&&p[n]=='\\'&&equal(p+n+1,(const W*)L"InkNote.exe");
}
static int document_file(const W*s){
 const W*b=basename_w(s),*ext=0;for(U32 i=0;b[i];i++)if(b[i]=='.')ext=b+i;
 if(!ext)return 0;
 const W*formats[]={ (const W*)L".inknote",(const W*)L".pdf",(const W*)L".epub",(const W*)L".fb2",(const W*)L".txt",(const W*)L".md",(const W*)L".mobi",(const W*)L".azw",(const W*)L".azw3",(const W*)L".cbz",(const W*)L".cbr",(const W*)L".zip",(const W*)L".7z",(const W*)L".rar",(const W*)L".png",(const W*)L".jpg",(const W*)L".jpeg",(const W*)L".gif",(const W*)L".webp",(const W*)L".bmp",(const W*)L".tif",(const W*)L".tiff",(const W*)L".heic",(const W*)L".doc",(const W*)L".docx",(const W*)L".xls",(const W*)L".xlsx",(const W*)L".ppt",(const W*)L".pptx",(const W*)L".mp3",(const W*)L".mp4",(const W*)L".wav",(const W*)L".m4a" };
 for(U32 i=0;i<sizeof(formats)/sizeof(formats[0]);i++)if(equal(ext,formats[i]))return 1;return 0;
}
static int ascii_has(const unsigned char*s,U32 n,const char*needle){U32 m=0;while(needle[m])m++;for(U32 i=0;i+m<=n;i++){U32 j=0;while(j<m&&s[i+j]==(unsigned char)needle[j])j++;if(j==m)return 1;}return 0;}
static int identifies_app(void){
 U32 base=length(work);if(!append(work,(const W*)L"\\resources\\app\\package.json"))return 0;
 U32 attrs=WIN(GetFileAttributesW,FAttributes)(work);if(attrs==ABSENT||(attrs&(ATTR_DIR|ATTR_REPARSE))){work[base]=0;return 0;}
 H f=WIN(CreateFileW,FCreateFile)(work,0x80000000,7,0,3,0x80,0);work[base]=0;if(f==INVALID)return 0;
 U32 n=0;int ok=WIN(ReadFile,FRead)(f,manifest,65536,&n,0);WIN(CloseHandle,FClose)(f);if(!ok||n>=65536)return 0;
 int version=ascii_has(manifest,n,"\"version\":\"0.2.0\"")||ascii_has(manifest,n,"\"version\": \"0.2.0\"");
#ifdef INKNOTE_CURRENT
 version=version||ascii_has(manifest,n,"\"version\":\"0.3.1\"")||ascii_has(manifest,n,"\"version\": \"0.3.1\"");
 version=version||ascii_has(manifest,n,"\"version\":\"0.3.2\"")||ascii_has(manifest,n,"\"version\": \"0.3.2\"");
 version=version||ascii_has(manifest,n,"\"version\":\"0.3.3\"")||ascii_has(manifest,n,"\"version\": \"0.3.3\"");
 version=version||ascii_has(manifest,n,"\"version\":\"0.4.0\"")||ascii_has(manifest,n,"\"version\": \"0.4.0\"");
 version=version||ascii_has(manifest,n,"\"version\":\"0.5.0\"")||ascii_has(manifest,n,"\"version\": \"0.5.0\"");
 version=version||ascii_has(manifest,n,"\"version\":\"0.6.0\"")||ascii_has(manifest,n,"\"version\": \"0.6.0\"");
 version=version||ascii_has(manifest,n,"\"version\":\"0.6.1\"")||ascii_has(manifest,n,"\"version\": \"0.6.1\"");
#endif
 return (ascii_has(manifest,n,"\"name\":\"inknote\"")||ascii_has(manifest,n,"\"name\": \"inknote\""))&&version;
}
/* work always starts in an identified legacy folder, and never follows links. */
static void remove_tree(U32 depth){
 U32 base=length(work),attrs=WIN(GetFileAttributesW,FAttributes)(work);
 if(attrs==ABSENT)return;if(attrs&ATTR_REPARSE){retained++;return;}
 if(!(attrs&ATTR_DIR)){
  if(document_file(work)){retained++;return;}
  if(attrs&1)WIN(SetFileAttributesW,FSetAttributes)(work,attrs&~1U);
  if(WIN(DeleteFileW,FDelete)(work))removed++;else failed++;return;
 }
 if(depth>=64){retained++;return;}
 if(!append(work,(const W*)L"\\*")){failed++;return;}
 struct FindData data={0};H find=WIN(FindFirstFileW,FFindFirst)(work,&data);work[base]=0;
 if(find!=INVALID){
  int more=1;while(more){
   if(!equal(data.name,(const W*)L".")&&!equal(data.name,(const W*)L"..")){
    if(join(work,data.name))remove_tree(depth+1);else failed++;work[base]=0;
   }
   more=WIN(FindNextFileW,FFindNext)(find,&data);
  }
  if(WIN(GetLastError,FError)()!=18)failed++;WIN(FindClose,FClose)(find);
 }else if(WIN(GetLastError,FError)()!=2){failed++;return;}
 if(!WIN(RemoveDirectoryW,FDelete)(work)&&WIN(GetLastError,FError)()!=145)failed++;
}
static int running_app(void){
 H snap=WIN(CreateToolhelp32Snapshot,FSnapshot)(2,0);if(snap==INVALID)return -1;
 struct ProcessEntry p={0};p.size=sizeof(p);int found=0,more=WIN(Process32FirstW,FProcessNext)(snap,&p);
 if(!more){WIN(CloseHandle,FClose)(snap);return -1;}
 while(more){if(equal(p.name,(const W*)L"InkNote.exe")){
  H proc=WIN(OpenProcess,FOpenProcess)(0x1000,0,p.pid);if(!proc){found=1;break;}
  U32 n=CAP;int ok=WIN(QueryFullProcessImageNameW,FQueryProcess)(proc,0,scratch,&n);WIN(CloseHandle,FClose)(proc);
  if(!ok||inside_root(scratch)){found=1;break;}
 }more=WIN(Process32NextW,FProcessNext)(snap,&p);}
 WIN(CloseHandle,FClose)(snap);return found;
}
static int message(const W*s,U32 flags){return WIN(MessageBoxW,FMessage)(0,s,(const W*)L"墨页 · 卸载工具",flags);}
#ifdef INKNOTE_CURRENT
typedef I32 (API *FRegOpen)(H,const W*,U32,U32,H*);
typedef I32 (API *FRegQuery)(H,const W*,U32*,U32*,unsigned char*,U32*);
typedef I32 (API *FRegClose)(H);
typedef I32 (API *FRegDelete)(H,const W*);
static const W registration_key[]=L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\InkNoteDesktop";
static void remove_registration(void){
 H key=0;H current_user=(H)(U64)0xffffffff80000001ULL;
 I32 result=WIN(RegOpenKeyExW,FRegOpen)(current_user,registration_key,0,0x20019,&key);
 if(result==2)return;if(result){failed++;return;}
 U32 type=0,bytes=sizeof(canonical);
 result=WIN(RegQueryValueExW,FRegQuery)(key,(const W*)L"InstallLocation",0,&type,(unsigned char*)canonical,&bytes);
 WIN(RegCloseKey,FRegClose)(key);
 if(result||type!=1||bytes<2||bytes>sizeof(canonical)||bytes%2||canonical[bytes/2-1]){retained++;return;}
 U32 n=WIN(GetFullPathNameW,FFullPath)(canonical,CAP,target,0);
 if(!n||n>=CAP||!append(target,(const W*)L"\\InkNote.exe")||!old_target(target)){retained++;return;}
 result=WIN(RegDeleteTreeW,FRegDelete)(current_user,registration_key);if(result&&result!=2)failed++;
}
#endif
static void remove_shortcut(const W*file){
 U32 attrs=WIN(GetFileAttributesW,FAttributes)(file);if(attrs==ABSENT)return;
 if(attrs&(ATTR_DIR|ATTR_REPARSE)){retained++;return;}
 void*link=0,*persist=0;
 if(WIN(CoCreateInstance,FCoCreate)(&CLSID_LINK,0,1,&IID_LINK,&link)<0||!link){failed++;return;}
 void**vt=*(void***)link;
 if(((FQueryInterface)vt[0])(link,&IID_FILE,&persist)<0||!persist){((FRelease)vt[2])(link);failed++;return;}
 void**pv=*(void***)persist;
 int ok=((FLoad)pv[5])(persist,file,0)>=0&&((FLinkPath)vt[3])(link,target,CAP,0,0)>=0;
 ((FRelease)pv[2])(persist);((FRelease)vt[2])(link);
 if(!ok){retained++;return;}U32 n=WIN(GetFullPathNameW,FFullPath)(target,CAP,canonical,0);
 if(!n||n>=CAP||!old_target(canonical)){retained++;return;}
 if(attrs&1)WIN(SetFileAttributesW,FSetAttributes)(file,attrs&~1U);
 if(WIN(DeleteFileW,FDelete)(file))removed++;else failed++;
}
static U32 uninstall_main(void){
 U32 n=WIN(GetEnvironmentVariableW,FEnv)((const W*)L"LOCALAPPDATA",legacy_root,CAP);
 if(!n||n>CAP-100||!append(legacy_root,(const W*)L"\\Programs\\InkNoteDesktop")){message((const W*)L"无法确定旧版安装位置，未删除任何文件。",0x10);return 1;}
 n=WIN(GetFullPathNameW,FFullPath)(legacy_root,CAP,canonical,0);if(!n||n>=CAP){message((const W*)L"旧版安装路径无效，未删除任何文件。",0x10);return 1;}copy(legacy_root,canonical);
 n=WIN(GetModuleFileNameW,FModule)(0,scratch,CAP);int tool_inside=inside_root(scratch);
#ifdef INKNOTE_CURRENT
 copy(target,legacy_root);append(target,(const W*)L"\\Uninstall-InkNote.exe");if(equal(scratch,target))tool_inside=0;
#endif
 if(!n||n>=CAP||tool_inside){message((const W*)L"请将此卸载工具放到桌面或下载文件夹后重新运行。",0x30);return 1;}
 U32 attrs=WIN(GetFileAttributesW,FAttributes)(legacy_root);
 if(attrs!=ABSENT&&(attrs&ATTR_REPARSE)){message((const W*)L"旧版目录是链接，为保护资料，本工具没有操作该目录。",0x30);return 1;}
 if(message((const W*)L"卸载墨页 InkNote？\n\n将移除已识别的程序和指向它的快捷方式。\n\n笔记资料、图片、电子书和备份会保留；AppData 中的笔记数据库与旧版浏览器资料不会删除。\n\n本工具无需联网。",0x24|0x100)!=6)return 0;
 int running=running_app();while(running>0){if(message((const W*)L"旧版墨页仍在运行。请先保存笔记并关闭墨页，再点“重试”。\n\n本工具不会强行结束进程。",0x35|0x100)!=4)return 0;running=running_app();}
 if(running<0){message((const W*)L"无法确认程序是否已经关闭，卸载已停止。未删除程序文件。",0x10);return 1;}
 if(attrs!=ABSENT){
  copy(work,legacy_root);append(work,(const W*)L"\\*");struct FindData data={0};H find=WIN(FindFirstFileW,FFindFirst)(work,&data);
  if(find!=INVALID){int more=1;while(more){if((data.attributes&ATTR_DIR)&&!(data.attributes&ATTR_REPARSE)&&old_name(data.name)){
   copy(work,legacy_root);if(join(work,data.name)&&identifies_app()){recognized++;remove_tree(0);}
  }more=WIN(FindNextFileW,FFindNext)(find,&data);}if(WIN(GetLastError,FError)()!=18)failed++;WIN(FindClose,FClose)(find);}
  else if(WIN(GetLastError,FError)()!=2)failed++;
 }
 I32 co=WIN(CoInitializeEx,FCoInit)(0,2);if(co>=0){
  if(WIN(SHGetFolderPathW,FFolder)(0,0x10,0,0,scratch)>=0&&join(scratch,(const W*)L"墨页 InkNote.lnk"))remove_shortcut(scratch);
  if(WIN(SHGetFolderPathW,FFolder)(0,0x02,0,0,scratch)>=0&&append(scratch,(const W*)L"\\InkNote\\墨页 InkNote.lnk"))remove_shortcut(scratch);
  WIN(CoUninitialize,FCoUninit)();
 }else failed++;
#ifdef INKNOTE_CURRENT
 if(!failed)remove_registration();
#endif
 if(failed){message((const W*)L"部分文件或快捷方式未能移除。请关闭墨页后重试。\n\n笔记、图片和备份资料已保留。",0x30);return 1;}
 if(!recognized&&!removed){message((const W*)L"没有发现本工具能够识别的旧版安装。\n\n未删除笔记和其他资料。若你使用的是解压版，关闭它后可删除原解压文件夹中的启动程序和程序文件；不要删除自己保存的笔记与备份。",0x40);return 0;}
 message((const W*)L"旧版卸载处理已完成。\n\n已清理识别出的程序文件和快捷方式。\n\n笔记数据库、图片、电子书和备份已保留；无法识别的链接，以及安装目录中的文档和图片不会被清理。\n\n现在可以关闭并删除这个卸载工具。",0x40);return 0;
}
#ifndef INKNOTE_TEST
void API entry(void){WIN(ExitProcess,FExit)(uninstall_main());}
__attribute__((used)) void*image_relocation_anchor=(void*)&entry;
#endif
