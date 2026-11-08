/* Executes the production traversal against an in-memory filesystem.
 * No Windows calls or real deletions occur in this test. */
#include <assert.h>
#include <stdio.h>
#define INKNOTE_TEST 1
#include "../installer/uninstall.c"
struct Node {const W*path;U32 attrs;int deleted;const char*contents;};
static struct Node nodes[]={
 {(const W*)L"C:\\Legacy",ATTR_DIR,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0",ATTR_DIR,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\InkNote.exe",0x20,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\chrome.dll",0x21,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\resources",ATTR_DIR,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\resources\\app",ATTR_DIR,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\resources\\app\\package.json",0x20,0,"{\"name\": \"inknote\",\"version\": \"0.2.0\"}"},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\resources\\app\\app.mjs",0x20,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\backup.inknote",0x20,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\photo.PNG",0x20,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\book.epub",0x20,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\my-notes.txt",0x20,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\linked-data",ATTR_DIR|ATTR_REPARSE,0,0},
 {(const W*)L"C:\\Legacy\\InkNote-0.2.0\\linked-data\\KEEP.exe",0x20,0,0},
 {(const W*)L"C:\\Legacy\\Other",ATTR_DIR,0,0},
 {(const W*)L"C:\\Legacy\\Other\\KEEP.exe",0x20,0,0},
 {(const W*)L"C:\\AppData\\InkNote",ATTR_DIR,0,0},
 {(const W*)L"C:\\AppData\\InkNote\\notes.ldb",0x20,0,0}
};
#define NODES (sizeof(nodes)/sizeof(nodes[0]))
static U32 last_error;static int readonly_cleared;
struct FindHandle {W directory[512];U32 next;};static struct FindHandle finds[64];static U32 find_count;
static int index_of(const W*p){for(U32 i=0;i<NODES;i++)if(!nodes[i].deleted&&equal(p,nodes[i].path))return (int)i;return -1;}
static int direct_child(const W*p,const W*parent){U32 n=length(parent);if(!prefix(p,parent)||p[n]!='\\'||!p[n+1])return 0;for(U32 i=n+1;p[i];i++)if(p[i]=='\\')return 0;return 1;}
static U32 API mock_attributes(const W*p){int i=index_of(p);return i<0?ABSENT:nodes[i].attrs;}
static int API mock_set_attributes(const W*p,U32 a){int i=index_of(p);assert(i>=0);nodes[i].attrs=a;readonly_cleared++;return 1;}
static int API mock_find_next(H handle,struct FindData*out){struct FindHandle*h=handle;while(h->next<NODES){U32 i=h->next++;if(!nodes[i].deleted&&direct_child(nodes[i].path,h->directory)){const W*name=basename_w(nodes[i].path);for(U32 k=0;k<=length(name);k++)out->name[k]=name[k];out->attributes=nodes[i].attrs;return 1;}}last_error=18;return 0;}
static H API mock_find_first(const W*pattern,struct FindData*out){assert(find_count<64);struct FindHandle*h=&finds[find_count++];U32 n=length(pattern);assert(n<512&&n>=2&&pattern[n-1]=='*');for(U32 i=0;i<n-2;i++)h->directory[i]=pattern[i];h->directory[n-2]=0;h->next=0;if(!mock_find_next(h,out)){last_error=2;return INVALID;}return h;}
static int API mock_close(H h){(void)h;return 1;}
static U32 API mock_error(void){return last_error;}
static int API mock_delete(const W*p){int i=index_of(p);assert(i>=0);assert(!(nodes[i].attrs&ATTR_DIR));assert(!(nodes[i].attrs&1));assert(!document_file(p));nodes[i].deleted=1;return 1;}
static int API mock_rmdir(const W*p){int i=index_of(p);assert(i>=0);for(U32 k=0;k<NODES;k++)if(!nodes[k].deleted&&direct_child(nodes[k].path,p)){last_error=145;return 0;}nodes[i].deleted=1;return 1;}
static H API mock_open(const W*p,U32 access,U32 share,void*security,U32 mode,U32 flags,H template){(void)access;(void)share;(void)security;(void)mode;(void)flags;(void)template;int i=index_of(p);return i<0?INVALID:&nodes[i];}
static int API mock_read(H f,void*out,U32 max,U32*n,void*overlapped){(void)overlapped;const char*s=((struct Node*)f)->contents;assert(s);*n=0;while(s[*n]&&*n<max){((char*)out)[*n]=s[*n];(*n)++;}return 1;}
#ifdef INKNOTE_CURRENT
static const W*registered_location;static int registrations_removed;static U32 registered_type=1;
static I32 API mock_reg_open(H root,const W*key,U32 options,U32 access,H*out){(void)root;(void)options;assert(equal(key,registration_key));assert(access==0x20019);if(!registered_location)return 2;*out=(H)1;return 0;}
static I32 API mock_reg_query(H key,const W*name,U32*reserved,U32*type,unsigned char*out,U32*bytes){(void)key;(void)reserved;assert(equal(name,(const W*)L"InstallLocation"));U32 size=(length(registered_location)+1)*2;assert(*bytes>=size);for(U32 i=0;i<=length(registered_location);i++)((W*)out)[i]=registered_location[i];*bytes=size;*type=registered_type;return 0;}
static I32 API mock_reg_close(H key){(void)key;return 0;}
static I32 API mock_reg_delete(H root,const W*key){(void)root;assert(equal(key,registration_key));registrations_removed++;return 0;}
static U32 API mock_full_path(const W*input,U32 max,W*out,W**part){(void)part;assert(length(input)<max);copy(out,input);return length(out);}
#endif
static void bind_mocks(void){
 win_imports.slot[WinGetFileAttributesW]=mock_attributes;win_imports.slot[WinSetFileAttributesW]=mock_set_attributes;
 win_imports.slot[WinFindFirstFileW]=mock_find_first;win_imports.slot[WinFindNextFileW]=mock_find_next;win_imports.slot[WinFindClose]=mock_close;
 win_imports.slot[WinDeleteFileW]=mock_delete;win_imports.slot[WinRemoveDirectoryW]=mock_rmdir;win_imports.slot[WinGetLastError]=mock_error;
 win_imports.slot[WinCreateFileW]=mock_open;win_imports.slot[WinReadFile]=mock_read;win_imports.slot[WinCloseHandle]=mock_close;
#ifdef INKNOTE_CURRENT
 win_imports.slot[WinRegOpenKeyExW]=mock_reg_open;win_imports.slot[WinRegQueryValueExW]=mock_reg_query;win_imports.slot[WinRegCloseKey]=mock_reg_close;win_imports.slot[WinRegDeleteTreeW]=mock_reg_delete;win_imports.slot[WinGetFullPathNameW]=mock_full_path;
#endif
}
int main(void){
 bind_mocks();copy(legacy_root,(const W*)L"C:\\Legacy");
 assert(old_target((const W*)L"c:\\legacy\\InkNote-0.2.0\\InkNote.exe"));
 assert(old_target((const W*)L"C:\\Legacy\\.previous-0123456789abcdef0123456789abcdef\\InkNote.exe"));
 assert(!old_target((const W*)L"C:\\LegacyOther\\InkNote-0.2.0\\InkNote.exe"));
 assert(!old_target((const W*)L"C:\\Legacy\\Other\\InkNote.exe"));
 assert(!old_target((const W*)L"C:\\Legacy\\InkNote-0.2.0\\another.exe"));
 assert(!old_name((const W*)L".previous-not-a-guid"));
 copy(work,nodes[1].path);assert(identifies_app());
 nodes[6].contents="{\"name\":\"other-app\",\"version\":\"0.2.0\"}";assert(!identifies_app());
#ifdef INKNOTE_CURRENT
 nodes[6].contents="{\"name\":\"inknote\",\"version\":\"0.4.0\"}";assert(identifies_app());
 nodes[6].contents="{\"name\":\"inknote\",\"version\":\"0.5.0\"}";assert(identifies_app());
 nodes[6].contents="{\"name\":\"inknote\",\"version\":\"0.6.0\"}";assert(identifies_app());
 nodes[6].contents="{\"name\":\"inknote\",\"version\":\"0.6.1\"}";assert(identifies_app());
 nodes[6].contents="{\"name\":\"inknote\",\"version\":\"0.6.2\"}";assert(!identifies_app());
#else
 nodes[6].contents="{\"name\":\"inknote\",\"version\":\"0.6.1\"}";assert(!identifies_app());
#endif
 nodes[6].contents="{\"name\":\"inknote\",\"version\":\"0.2.0\"}";
 remove_tree(0);assert(removed==4);assert(failed==0);assert(retained==5);assert(readonly_cleared==1);
 assert(nodes[2].deleted&&nodes[3].deleted&&nodes[6].deleted&&nodes[7].deleted);
 for(U32 i=8;i<NODES;i++)assert(!nodes[i].deleted);
 assert(!nodes[1].deleted); /* folder remains because it contains user files */
#ifdef INKNOTE_CURRENT
 assert(old_target((const W*)L"C:\\Legacy\\InkNote-0.3.1\\InkNote.exe"));
 assert(old_target((const W*)L"C:\\Legacy\\InkNote-0.3.2\\InkNote.exe"));
 assert(old_target((const W*)L"C:\\Legacy\\InkNote-0.3.3\\InkNote.exe"));
 assert(old_target((const W*)L"C:\\Legacy\\InkNote-0.4.0\\InkNote.exe"));
 assert(old_target((const W*)L"C:\\Legacy\\InkNote-0.5.0\\InkNote.exe"));
 assert(old_target((const W*)L"C:\\Legacy\\InkNote-0.6.0\\InkNote.exe"));
 assert(old_target((const W*)L"C:\\Legacy\\InkNote-0.6.1\\InkNote.exe"));
 assert(!old_target((const W*)L"C:\\Legacy\\InkNote-0.6.2\\InkNote.exe"));
 registered_location=(const W*)L"C:\\Other\\InkNote-0.3.1";remove_registration();assert(registrations_removed==0);
 registered_location=(const W*)L"C:\\LegacyOther\\InkNote-0.3.1";remove_registration();assert(registrations_removed==0);
 registered_location=(const W*)L"C:\\Legacy\\Unrelated";remove_registration();assert(registrations_removed==0);
 registered_location=(const W*)L"C:\\Legacy\\InkNote-0.3.1";registered_type=2;remove_registration();assert(registrations_removed==0);
 registered_type=1;remove_registration();assert(registrations_removed==1);
 registered_location=0;remove_registration();assert(registrations_removed==1);
 assert(failed==0);
#endif
 puts("Legacy uninstaller: program traversal, profile/document/image retention, link boundary and ownership checks passed.");
 return 0;
}
