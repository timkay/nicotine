#ifndef NICOTINE_PLATFORM_H
#define NICOTINE_PLATFORM_H
#include <stddef.h>
#ifdef _WIN32
#include <windows.h>
typedef HANDLE NThread;
typedef DWORD NThreadId;
#define N_PLATFORM "windows"
#else
#include <pthread.h>
typedef pthread_t NThread;
typedef pthread_t NThreadId;
#ifdef __APPLE__
#define N_PLATFORM "macos"
#else
#define N_PLATFORM "linux"
#endif
#endif
typedef struct { char *body; size_t length; long status; char error[256]; } NResponse;
int n_init(void);
void n_cleanup(void);
void *n_library_open(const char *path);
void *n_library_symbol(void *library,const char *name);
void n_library_close(void *library);
const char *n_library_error(void);
int n_thread_start(NThread *thread,void *(*fn)(void *),void *arg);
void n_thread_join(NThread thread);
NThreadId n_thread_self(void);
int n_thread_equal(NThreadId a,NThreadId b);
void n_sleep(void);
double n_monotonic(void);
int n_executable(char *path,size_t capacity);
void n_http_get(const char *url,NResponse *response,size_t limit);
#endif
