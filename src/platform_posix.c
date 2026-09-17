#include "platform.h"
#include <curl/curl.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
int n_init(void){return curl_global_init(CURL_GLOBAL_DEFAULT);}
void n_cleanup(void){curl_global_cleanup();}
void *n_library_open(const char *path){return dlopen(path,RTLD_NOW|RTLD_LOCAL);}
void *n_library_symbol(void *lib,const char *name){return dlsym(lib,name);}
void n_library_close(void *lib){dlclose(lib);}
const char *n_library_error(void){const char *e=dlerror();return e?e:"Unknown loader error";}
int n_thread_start(NThread *t,void *(*fn)(void *),void *arg){return pthread_create(t,NULL,fn,arg);}
void n_thread_join(NThread t){pthread_join(t,NULL);}
NThreadId n_thread_self(void){return pthread_self();}
int n_thread_equal(NThreadId a,NThreadId b){return pthread_equal(a,b);}
void n_sleep(void){struct timespec t={0,10000000};nanosleep(&t,NULL);}
double n_monotonic(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000.0+t.tv_nsec/1e6;}
int n_executable(char *path,size_t capacity){
#ifdef __APPLE__
    uint32_t size=(uint32_t)capacity;return _NSGetExecutablePath(path,&size);
#else
    ssize_t n=readlink("/proc/self/exe",path,capacity-1);
    if(n<0 || (size_t)n>=capacity-1)return -1;
    path[n]=0;return 0;
#endif
}
typedef struct {NResponse *response;size_t limit;} Transfer;
static size_t receive(char *p,size_t size,size_t count,void *opaque){
    Transfer *t=opaque;NResponse *r=t->response;
    if(size && count>SIZE_MAX/size)return 0;
    size_t n=size*count;if(n>t->limit-r->length)return 0;
    char *body=realloc(r->body,r->length+n+1);if(!body)return 0;
    r->body=body;memcpy(body+r->length,p,n);r->length+=n;body[r->length]=0;return n;
}
void n_http_get(const char *url,NResponse *r,size_t limit){
    CURL *c=curl_easy_init();if(!c){snprintf(r->error,sizeof(r->error),"Cannot initialize HTTP");return;}
    Transfer t={r,limit};
    curl_easy_setopt(c,CURLOPT_URL,url);
#if LIBCURL_VERSION_NUM >= 0x075500
    curl_easy_setopt(c,CURLOPT_PROTOCOLS_STR,"http,https");
    curl_easy_setopt(c,CURLOPT_REDIR_PROTOCOLS_STR,"http,https");
#else
    curl_easy_setopt(c,CURLOPT_PROTOCOLS,(long)(CURLPROTO_HTTP|CURLPROTO_HTTPS));
    curl_easy_setopt(c,CURLOPT_REDIR_PROTOCOLS,(long)(CURLPROTO_HTTP|CURLPROTO_HTTPS));
#endif
    curl_easy_setopt(c,CURLOPT_FOLLOWLOCATION,1L);curl_easy_setopt(c,CURLOPT_MAXREDIRS,5L);
    curl_easy_setopt(c,CURLOPT_TIMEOUT,30L);curl_easy_setopt(c,CURLOPT_NOSIGNAL,1L);
    curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,receive);curl_easy_setopt(c,CURLOPT_WRITEDATA,&t);
    CURLcode code=curl_easy_perform(c);
    curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&r->status);curl_easy_cleanup(c);
    if(code)snprintf(r->error,sizeof(r->error),"%s",curl_easy_strerror(code));
}
