/* Native Windows x64 GUI bootstrapper. The application archive is appended by
 * build-online-exe.py. No CRT, console or batch file is required. */
typedef unsigned short W;
typedef unsigned int U32;
typedef unsigned long long U64;
typedef void* H;
#define API __attribute__((ms_abi))
struct Imports { void * volatile slot[32]; unsigned char padding[7936]; };
__attribute__((section(".idata"),used)) struct Imports win_imports={0};
typedef U32 (API *GetModuleFileNameW_t)(H,W*,U32);
typedef U32 (API *GetTempPathW_t)(U32,W*);
typedef U32 (API *GetSystemDirectoryW_t)(W*,U32);
typedef U32 (API *GetCurrentProcessId_t)(void);
typedef int (API *CreateDirectoryW_t)(const W*,void*);
typedef H (API *CreateFileW_t)(const W*,U32,U32,void*,U32,U32,H);
typedef int (API *WriteFile_t)(H,const void*,U32,U32*,void*);
typedef int (API *CloseHandle_t)(H);
typedef int (API *DeleteFileW_t)(const W*);
typedef int (API *RemoveDirectoryW_t)(const W*);
typedef int (API *CreateProcessW_t)(const W*,W*,void*,void*,int,U32,void*,const W*,void*,void*);
typedef U32 (API *WaitForSingleObject_t)(H,U32);
typedef int (API *GetExitCodeProcess_t)(H,U32*);
typedef void (API *ExitProcess_t)(U32);
typedef int (API *MessageBoxW_t)(H,const W*,const W*,U32);
#define CALL(n,t) ((t)win_imports.slot[n])
static W module_path[32768],temp_path[32768],script_path[32768],ps_path[32768],command[32768];
struct Startup { U32 cb; W *reserved,*desktop,*title; U32 x,y,xs,ys,xc,yc,fill,flags; unsigned short show,reserved_count; unsigned char *reserved_data; H in,out,err; };
struct Process { H process,thread; U32 pid,tid; };
_Static_assert(sizeof(struct Startup)==104,"STARTUPINFOW ABI");
_Static_assert(sizeof(struct Process)==24,"PROCESS_INFORMATION ABI");
#include "setup-bytes.h"
static U32 len(const W*s){U32 n=0;while(s[n])n++;return n;}
static void append(W*dst,const W*src){U32 n=len(dst),i=0;while(src[i]&&n<32760)dst[n++]=src[i++];dst[n]=0;}
static void copy(W*dst,const W*src){dst[0]=0;append(dst,src);}
static void fail(const W*message){CALL(16,MessageBoxW_t)(0,message,(const W*)L"InkNote Setup",0x10);CALL(13,ExitProcess_t)(1);}
void API entry(void){
 U32 size=CALL(0,GetModuleFileNameW_t)(0,module_path,32768);if(!size||size>=32768)fail((const W*)L"Cannot locate the installer.");
 size=CALL(1,GetTempPathW_t)(32768,temp_path);if(!size||size>32600)fail((const W*)L"Cannot locate the temporary folder.");
 append(temp_path,(const W*)L"InkNote-Setup-");U32 pid=CALL(3,GetCurrentProcessId_t)();W digits[16];U32 i=0;do{digits[i++]=(W)('0'+pid%10);pid/=10;}while(pid);W ordered[17];for(U32 j=0;j<i;j++)ordered[j]=digits[i-1-j];ordered[i]=0;append(temp_path,ordered);
 if(!CALL(4,CreateDirectoryW_t)(temp_path,0))fail((const W*)L"Cannot create the temporary installation folder. Please run the installer again.");
 copy(script_path,temp_path);append(script_path,(const W*)L"\\setup.ps1");
 H file=CALL(5,CreateFileW_t)(script_path,0x40000000,0,0,1,0x80,0);if(file==(H)(U64)-1)fail((const W*)L"Cannot write the installer script.");
 U32 written=0;int ok=CALL(6,WriteFile_t)(file,setup_bytes,setup_bytes_length,&written,0);CALL(7,CloseHandle_t)(file);if(!ok||written!=setup_bytes_length)fail((const W*)L"Cannot write the installer script.");
 size=CALL(2,GetSystemDirectoryW_t)(ps_path,32768);if(!size||size>32600)fail((const W*)L"Cannot locate Windows PowerShell.");append(ps_path,(const W*)L"\\WindowsPowerShell\\v1.0\\powershell.exe");
 append(command,(const W*)L"\"");append(command,ps_path);append(command,(const W*)L"\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"");append(command,script_path);append(command,(const W*)L"\" -BundlePath \"");append(command,module_path);append(command,(const W*)L"\"");
 struct Startup startup={0};startup.cb=sizeof(startup);struct Process process={0};
 if(!CALL(10,CreateProcessW_t)(ps_path,command,0,0,0,0x08000000,0,0,&startup,&process))fail((const W*)L"Windows could not start the installation process.");
 CALL(11,WaitForSingleObject_t)(process.process,0xffffffff);U32 exit_code=1;CALL(12,GetExitCodeProcess_t)(process.process,&exit_code);CALL(7,CloseHandle_t)(process.thread);CALL(7,CloseHandle_t)(process.process);
 CALL(8,DeleteFileW_t)(script_path);CALL(9,RemoveDirectoryW_t)(temp_path);CALL(13,ExitProcess_t)(exit_code);
}
/* Keep a relocation entry so Windows may relocate the image with ASLR. */
__attribute__((used)) void *image_relocation_anchor=(void*)&entry;
