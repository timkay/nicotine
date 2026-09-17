#include "platform.h"
#include <winhttp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static char loader_error[128];
static wchar_t *wide(const char *text){
    int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,-1,NULL,0);
    if(!n)return NULL;
    wchar_t *s=malloc(n*sizeof(*s));if(s)MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,-1,s,n);return s;
}
int n_init(void){return 0;}
void n_cleanup(void){}
void *n_library_open(const char *path){wchar_t *s=wide(path);if(!s)return NULL;HMODULE h=LoadLibraryW(s);free(s);return h;}
void *n_library_symbol(void *h,const char *name){return (void*)GetProcAddress((HMODULE)h,name);}
void n_library_close(void *h){FreeLibrary((HMODULE)h);}
const char *n_library_error(void){snprintf(loader_error,sizeof(loader_error),"Windows error %lu",GetLastError());return loader_error;}
typedef struct {void *(*fn)(void *);void *arg;} Start;
static DWORD WINAPI start_thread(void *p){Start s=*(Start*)p;free(p);s.fn(s.arg);return 0;}
int n_thread_start(NThread *t,void *(*fn)(void *),void *arg){
    Start *s=malloc(sizeof(*s));if(!s)return -1;s->fn=fn;s->arg=arg;
    *t=CreateThread(NULL,0,start_thread,s,0,NULL);if(!*t){free(s);return -1;}return 0;
}
void n_thread_join(NThread t){WaitForSingleObject(t,INFINITE);CloseHandle(t);}
NThreadId n_thread_self(void){return GetCurrentThreadId();}
int n_thread_equal(NThreadId a,NThreadId b){return a==b;}
void n_sleep(void){Sleep(10);}
double n_monotonic(void){LARGE_INTEGER t,f;QueryPerformanceCounter(&t);QueryPerformanceFrequency(&f);return (double)t.QuadPart*1000.0/f.QuadPart;}
int n_executable(char *path,size_t capacity){
    wchar_t w[32768];DWORD n=GetModuleFileNameW(NULL,w,32768);
    if(!n || n>=32768)return -1;
    return WideCharToMultiByte(CP_UTF8,0,w,-1,path,(int)capacity,NULL,NULL)?0:-1;
}
void n_http_get(const char *url,NResponse *r,size_t limit){
    wchar_t *u=wide(url),*host=NULL;HINTERNET session=NULL,connection=NULL,request=NULL;
    DWORD failure=0;URL_COMPONENTS parts={0};parts.dwStructSize=sizeof(parts);
    parts.dwHostNameLength=parts.dwUrlPathLength=parts.dwExtraInfoLength=(DWORD)-1;
    if(!u || !WinHttpCrackUrl(u,0,0,&parts))goto fail;
    if(parts.nScheme!=INTERNET_SCHEME_HTTP && parts.nScheme!=INTERNET_SCHEME_HTTPS){SetLastError(ERROR_INVALID_PARAMETER);goto fail;}
    host=calloc(parts.dwHostNameLength+1,sizeof(*host));if(!host)goto fail;
    memcpy(host,parts.lpszHostName,parts.dwHostNameLength*sizeof(*host));
    session=WinHttpOpen(L"Nicotine/0.1",WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,NULL,NULL,0);if(!session)goto fail;
    WinHttpSetTimeouts(session,10000,10000,30000,30000);
    connection=WinHttpConnect(session,host,parts.nPort,0);if(!connection)goto fail;
    const wchar_t *path=parts.dwUrlPathLength?parts.lpszUrlPath:L"/";
    request=WinHttpOpenRequest(connection,L"GET",path,NULL,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,
                             parts.nScheme==INTERNET_SCHEME_HTTPS?WINHTTP_FLAG_SECURE:0);
    if(!request || !WinHttpSendRequest(request,NULL,0,NULL,0,0,0) || !WinHttpReceiveResponse(request,NULL))goto fail;
    DWORD status=0,n=sizeof(status);
    if(!WinHttpQueryHeaders(request,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,NULL,&status,&n,NULL))goto fail;
    r->status=status;
    for(;;){
        char buffer[8192];DWORD got=0;if(!WinHttpReadData(request,buffer,sizeof(buffer),&got))goto fail;
        if(!got)break;
        if(got>limit-r->length){SetLastError(ERROR_FILE_TOO_LARGE);goto fail;}
        char *body=realloc(r->body,r->length+got+1);if(!body){SetLastError(ERROR_NOT_ENOUGH_MEMORY);goto fail;}
        r->body=body;memcpy(body+r->length,buffer,got);r->length+=got;body[r->length]=0;
    }
    goto done;
fail:
    failure=GetLastError();snprintf(r->error,sizeof(r->error),"WinHTTP error %lu",failure);
done:
    if(request)WinHttpCloseHandle(request);if(connection)WinHttpCloseHandle(connection);if(session)WinHttpCloseHandle(session);
    free(host);free(u);
}
