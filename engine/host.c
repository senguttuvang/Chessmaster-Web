/* Minimal Win32 environment for The King 3.23. Guest code remains generated C.
 * Only explicit services are implemented; unknown imports trap in the runtime. */
#include "runtime.h"
#include <pthread.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
EM_JS(int, browser_read, (uint32_t buffer, uint32_t length), {
    const ring = Module['inputRing'];
    if (!ring) throw new Error('Missing engine input ring');
    const state = new Int32Array(ring, 0, 4), bytes = new Uint8Array(ring, 16);
    for (;;) {
        const read = Atomics.load(state, 0), write = Atomics.load(state, 1);
        if (read !== write) {
            const count = Math.min(length, (write - read + bytes.length) % bytes.length);
            for (let i = 0; i < count; i++) HEAPU8[buffer + i] = bytes[(read + i) % bytes.length];
            Atomics.store(state, 0, (read + count) % bytes.length);
            return count;
        }
        Atomics.wait(state, 1, write);
    }
});
EM_JS(int, browser_available, (), {
    const ring=Module['inputRing']; if(!ring)return 0;
    const state=new Int32Array(ring,0,4), size=ring.byteLength-16;
    return (Atomics.load(state,1)-Atomics.load(state,0)+size)%size;
});
#endif

#define A(i) R32(c->esp + 4 + 4 * (i))
#define S(a) ((char *)HP(a))
#define W(name) static void w_##name(CPU *c)
#define RET(n,v) do { c->eax = (uint32_t)(v); c->esp += 4 + 4*(n); return; } while (0)
#define ITEM(name) {"KERNEL32.DLL!" #name, w_##name}
typedef struct { int kind, manual, signaled, fd; pthread_t thread; pthread_mutex_t mutex; pthread_cond_t cond; } Handle;
static Handle handles[256];
static pthread_mutex_t handle_lock = PTHREAD_MUTEX_INITIALIZER;
static __thread uint32_t thread_id = 1, tls_values[64], last_error;
static uint32_t next_tls, next_thread = 2, command_line, environment;
static uint64_t boot_ms;

static uint64_t millis(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000; }
static uint32_t allocate(uint32_t size) {
    pthread_mutex_lock(&handle_lock); uint32_t a=guest_alloc(size); pthread_mutex_unlock(&handle_lock);
    if ((uint64_t)a+size >= GUEST_HEAP_HI) { fprintf(stderr,"Engine allocation exceeds guest heap\n"); abort(); }
    memset(HP(a),0,size); return a;
}
static uint32_t handle_new(int kind) {
    pthread_mutex_lock(&handle_lock);
    for (int i=4;i<256;i++) if (!handles[i].kind) {
        Handle *h=&handles[i]; h->kind=kind; h->fd=-1;
        pthread_mutex_init(&h->mutex,NULL); pthread_cond_init(&h->cond,NULL);
        pthread_mutex_unlock(&handle_lock); return i;
    }
    pthread_mutex_unlock(&handle_lock); abort();
}
static Handle *handle(uint32_t i) { if(i>=256 || !handles[i].kind) { fprintf(stderr,"Invalid handle %u\n",i); abort(); } return &handles[i]; }
static void systemtime(uint32_t a, int local) {
    time_t now=time(NULL); struct tm t; if(local) localtime_r(&now,&t); else gmtime_r(&now,&t);
    uint16_t v[8]={(uint16_t)(t.tm_year+1900),(uint16_t)(t.tm_mon+1),(uint16_t)t.tm_wday,(uint16_t)t.tm_mday,(uint16_t)t.tm_hour,(uint16_t)t.tm_min,(uint16_t)t.tm_sec,0}; memcpy(HP(a),v,16);
}
W(GetStdHandle) { RET(1,A(0)==(uint32_t)-10?1:A(0)==(uint32_t)-11?2:3); }
W(SetStdHandle) { RET(2,1); }
W(GetFileType) { RET(1,A(0)<=3?3:1); }
W(GetConsoleMode) { last_error=6; RET(2,0); } /* stdin is a pipe, not console events */
W(SetConsoleMode) { RET(2,1); }
W(SetConsoleCtrlHandler) { RET(2,1); }
W(GetNumberOfConsoleInputEvents) { W32(A(1),0); RET(2,1); }
W(ReadConsoleInputA) { W32(A(3),0); RET(4,1); }
W(ReadFile) {
    int count;
    if (A(0)==1) {
#ifdef __EMSCRIPTEN__
        count=browser_read((uint32_t)(uintptr_t)HP(A(1)),A(2));
#else
        count=(int)read(STDIN_FILENO,HP(A(1)),A(2));
#endif
    } else count=(int)read(handle(A(0))->fd,HP(A(1)),A(2));
    if(A(3)) W32(A(3),count<0?0:count); RET(5,count>=0);
}
static uint32_t write_output(uint32_t h,uint32_t p,uint32_t n) {
    if(h==2 || h==3) { FILE *f=h==2?stdout:stderr; uint32_t done=fwrite(HP(p),1,n,f); fflush(f); return done; }
    int count=(int)write(handle(h)->fd,HP(p),n); return count<0?0:(uint32_t)count;
}
W(WriteFile) { uint32_t n=write_output(A(0),A(1),A(2)); if(A(3))W32(A(3),n); RET(5,n==A(2)); }
W(WriteConsoleA) { uint32_t n=write_output(A(0),A(1),A(2)); if(A(3))W32(A(3),n); RET(5,n==A(2)); }
W(PeekNamedPipe) {
    static int notified;
    if(!notified){notified=1;fputs("__CM_ENGINE_READY__\n",stdout);fflush(stdout);}
    int available=0;
#ifdef __EMSCRIPTEN__
    available=browser_available();
#else
    if(ioctl(STDIN_FILENO,FIONREAD,&available)<0){last_error=6;RET(6,0);}
#endif
    if(A(4))W32(A(4),(uint32_t)available);if(A(3))W32(A(3),0);if(A(5))W32(A(5),0);
    if(A(1) && A(2)){fprintf(stderr,"PeekNamedPipe buffer copy not requested by verified engine path\n");abort();}
    RET(6,1);
}
W(GetCommandLineA) { RET(0,command_line); }
W(GetEnvironmentStrings) { RET(0,environment); }
W(GetVersion) { RET(0,0x0a280105); }
W(GetCurrentProcessId) { RET(0,1); }
W(GetCurrentThreadId) { RET(0,thread_id); }
W(GetCurrentThread) { RET(0,0xfffffffe); }
W(GetLastError) { RET(0,last_error); }
W(GetTickCount) { RET(0,(uint32_t)(millis()-boot_ms)); }
W(GetSystemTime) { systemtime(A(0),0); RET(1,0); }
W(GetLocalTime) { systemtime(A(0),1); RET(1,0); }
W(SystemTimeToFileTime) {
    uint16_t v[8]; memcpy(v,HP(A(0)),16); struct tm t={0};t.tm_year=v[0]-1900;t.tm_mon=v[1]-1;t.tm_mday=v[3];t.tm_hour=v[4];t.tm_min=v[5];t.tm_sec=v[6];
    uint64_t ft=((uint64_t)timegm(&t)+11644473600ull)*10000000ull+v[7]*10000ull; W64(A(1),ft); RET(2,1);
}
W(GetTimeZoneInformation) { memset(HP(A(0)),0,172); RET(1,0); }
W(Sleep) { struct timespec t={A(0)/1000,(A(0)%1000)*1000000L}; nanosleep(&t,NULL); RET(1,0); }
W(VirtualAlloc) {
    uint32_t size=A(1), requested=A(0);
    if(requested) { if(requested<GUEST_HEAP_BASE || (uint64_t)requested+size>=GUEST_HEAP_HI){last_error=487;RET(4,0);}RET(4,requested); }
    if(!size || size>GUEST_HEAP_HI-GUEST_HEAP_BASE-65536){last_error=8;RET(4,0);}
    uint32_t raw=allocate(size+65535);RET(4,(raw+65535)&~65535u);
}
W(VirtualFree) { RET(3,1); } /* process-lifetime arena, reset by replacing the worker */
W(TlsAlloc) { pthread_mutex_lock(&handle_lock);uint32_t i=next_tls++;pthread_mutex_unlock(&handle_lock); if(i>=64)abort(); RET(0,i); }
W(TlsFree) { RET(1,1); }
W(TlsGetValue) { if(A(0)>=64)abort(); RET(1,tls_values[A(0)]); }
W(TlsSetValue) { if(A(0)>=64)abort(); tls_values[A(0)]=A(1); RET(2,1); }
W(CreateEventA) { uint32_t i=handle_new(1);handles[i].manual=A(1);handles[i].signaled=A(2);RET(4,i); }
W(SetEvent) { Handle *h=handle(A(0)); pthread_mutex_lock(&h->mutex);h->signaled=1;pthread_cond_broadcast(&h->cond);pthread_mutex_unlock(&h->mutex);RET(1,1); }
W(CreateMutexA) { uint32_t i=handle_new(2); if(A(1))pthread_mutex_lock(&handles[i].mutex);RET(3,i); }
W(ReleaseMutex) { pthread_mutex_unlock(&handle(A(0))->mutex);RET(1,1); }
W(WaitForSingleObject) {
    Handle *h=handle(A(0)); uint32_t timeout=A(1),result=0;
    if(h->kind==2) { if(timeout==0)result=pthread_mutex_trylock(&h->mutex)?258:0;else pthread_mutex_lock(&h->mutex); }
    else if(h->kind==1) {
        pthread_mutex_lock(&h->mutex);
        if(timeout==0 && !h->signaled)result=258;
        else while(!h->signaled) {
            if(timeout==0xffffffffu)pthread_cond_wait(&h->cond,&h->mutex);
            else { struct timespec t;clock_gettime(CLOCK_REALTIME,&t);t.tv_sec+=timeout/1000;t.tv_nsec+=(timeout%1000)*1000000L;if(t.tv_nsec>=1000000000){t.tv_sec++;t.tv_nsec-=1000000000;}if(pthread_cond_timedwait(&h->cond,&h->mutex,&t)==ETIMEDOUT){result=258;break;} }
        }
        if(!result && !h->manual)h->signaled=0;pthread_mutex_unlock(&h->mutex);
    } else { fprintf(stderr,"Unsupported wait handle kind %d\n",h->kind);abort(); }
    RET(2,result);
}
typedef struct { CPU cpu;uint32_t start,param,id; } Thread;
static void *thread_run(void *p) { Thread *t=p;thread_id=t->id;fpu_sync_rounding(&t->cpu);PUSH32(&t->cpu,t->param);PUSH32(&t->cpu,GUEST_RETURN_SENTINEL);call_indirect(&t->cpu,t->start);free(t);return NULL; }
W(CreateThread) {
    if(A(4)) { fprintf(stderr,"Suspended threads unsupported\n");abort(); }
    uint32_t i=handle_new(3);Thread *t=calloc(1,sizeof *t);t->cpu=*c;t->cpu.esp=allocate(4*1024*1024)+4*1024*1024-16;t->start=A(2);t->param=A(3);
    pthread_mutex_lock(&handle_lock);t->id=next_thread++;pthread_mutex_unlock(&handle_lock);
    if(A(5))W32(A(5),t->id);if(pthread_create(&handles[i].thread,NULL,thread_run,t))abort();RET(6,i);
}
W(ExitThread) { pthread_exit(NULL); }
W(ExitProcess) {
    const char *trace_path=getenv("ENGINE_TRACE_FILE");
    if(trace_path && g_trace){FILE *file=fopen(trace_path,"wb");if(!file)abort();for(uint32_t i=0;i<g_trace_len;i++){fwrite(&g_trace[i].addr,4,1,file);fwrite(g_trace[i].regs,4,8,file);}fclose(file);}
    if(getenv("ENGINE_TRACE"))for(uint32_t i=g_trace_len>32?g_trace_len-32:0;i<g_trace_len;i++)fprintf(stderr,"TRACE %08x eax=%08x esp=%08x\n",g_trace[i].addr,g_trace[i].regs[0],g_trace[i].regs[4]);
    exit((int)A(0));
}
W(CloseHandle) { /* Win32 closing a thread handle doesn't terminate its thread. */ RET(1,1); }
W(GetModuleHandleA) { RET(1,A(0)?0xf0000000:0x400000); }
W(LoadLibraryA) { last_error=126;RET(1,0); } /* no optional plugin libraries in engine-only build */
W(GetProcAddress) { RET(2,0); }
W(GetModuleFileNameA) { const char *name="C:\\Chessmaster9000\\THEKING.EXE";uint32_t n=(uint32_t)strlen(name);if(n>=A(2))n=A(2)?A(2)-1:0;if(A(2)){memcpy(HP(A(1)),name,n);W8(A(1)+n,0);}RET(3,n); }
W(CreateFileA) { last_error=2;RET(7,0xffffffffu); } /* opening books/tablebases belong to UI later */
W(DeleteFileA) { last_error=2;RET(1,0); }
W(SetFilePointer) { RET(4,0xffffffffu); }
W(RtlUnwind) { guest_trap(c,R32(c->esp),"RtlUnwind reached"); }
W(FormatMessageA) { RET(7,0); }
W(GetActiveWindow) { RET(0,0); }
W(wsprintfA) { guest_trap(c,R32(c->esp),"wsprintfA reached; implement its actual format before use"); }

static ImportHandler imports[]={ITEM(GetStdHandle),ITEM(SetStdHandle),ITEM(GetFileType),ITEM(GetConsoleMode),ITEM(SetConsoleMode),ITEM(SetConsoleCtrlHandler),ITEM(GetNumberOfConsoleInputEvents),ITEM(ReadConsoleInputA),ITEM(ReadFile),ITEM(WriteFile),ITEM(WriteConsoleA),ITEM(PeekNamedPipe),ITEM(GetCommandLineA),ITEM(GetEnvironmentStrings),ITEM(GetVersion),ITEM(GetCurrentProcessId),ITEM(GetCurrentThreadId),ITEM(GetCurrentThread),ITEM(GetLastError),ITEM(GetTickCount),ITEM(GetSystemTime),ITEM(GetLocalTime),ITEM(SystemTimeToFileTime),ITEM(GetTimeZoneInformation),ITEM(Sleep),ITEM(VirtualAlloc),ITEM(VirtualFree),ITEM(TlsAlloc),ITEM(TlsFree),ITEM(TlsGetValue),ITEM(TlsSetValue),ITEM(CreateEventA),ITEM(SetEvent),ITEM(CreateMutexA),ITEM(ReleaseMutex),ITEM(WaitForSingleObject),ITEM(CreateThread),ITEM(ExitThread),ITEM(ExitProcess),ITEM(CloseHandle),ITEM(GetModuleHandleA),ITEM(LoadLibraryA),ITEM(GetProcAddress),ITEM(GetModuleFileNameA),ITEM(CreateFileA),ITEM(DeleteFileA),ITEM(SetFilePointer),ITEM(RtlUnwind),ITEM(FormatMessageA),{"USER32.DLL!GetActiveWindow",w_GetActiveWindow},{"USER32.DLL!wsprintfA",w_wsprintfA}};

/* Oracle bridge: execute original x86 in Unicorn against the same platform services. */
static CPU reference_cpu;
uint32_t cm_reference_init(const char *path) {
    boot_ms=millis();runtime_init(&reference_cpu);command_line=allocate(64);strcpy(S(command_line),"THEKING.EXE");environment=allocate(4);
    set_import_handlers(imports,sizeof imports/sizeof *imports);LoadedImage image;if(load_image(path,&image))return 0;return image.entry;
}
void *cm_reference_memory(void) { return g_mem; }
void cm_reference_import(uint32_t address,uint32_t *registers) { memcpy(&reference_cpu,registers,32);call_indirect(&reference_cpu,address);memcpy(registers,&reference_cpu,32); }

int main(int argc,char **argv) {
    setvbuf(stdout,NULL,_IONBF,0);boot_ms=millis();CPU cpu;runtime_init(&cpu);
    command_line=allocate(64);strcpy(S(command_line),"THEKING.EXE");environment=allocate(4);
    set_import_handlers(imports,sizeof imports/sizeof *imports);
    LoadedImage image;if(load_image(argc>1?argv[1]:"/THEKING.EXE",&image))return 1;
    register_all_functions();GuestFn entry=lookup_function(image.entry);if(!entry){fprintf(stderr,"Entry not translated\n");return 1;}
    fprintf(stderr,"The King original-code runtime: %u imports, entry %08x\n",image.num_imports,image.entry);
    if(getenv("ENGINE_TRACE")){g_trace_cap=1000000;g_trace=calloc(g_trace_cap,sizeof *g_trace);}
    PUSH32(&cpu,GUEST_RETURN_SENTINEL);entry(&cpu);
    const char *trace_path=getenv("ENGINE_TRACE_FILE");
    if(trace_path && g_trace){FILE *file=fopen(trace_path,"wb");if(!file)abort();for(uint32_t i=0;i<g_trace_len;i++){fwrite(&g_trace[i].addr,4,1,file);fwrite(g_trace[i].regs,4,8,file);}fclose(file);}
    fprintf(stderr,"Engine entry returned to %08x (expected %08x)\n",cpu.return_address,GUEST_RETURN_SENTINEL);
    if(g_trace)for(uint32_t i=g_trace_len>32?g_trace_len-32:0;i<g_trace_len;i++)fprintf(stderr,"TRACE %08x eax=%08x esp=%08x\n",g_trace[i].addr,g_trace[i].regs[0],g_trace[i].regs[4]);
    return (int)cpu.eax;
}
