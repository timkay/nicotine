/* App-specific ABI, separate from Nicotine's generic Native interface.
 * All functions and callbacks run on the GUI/main thread. Strings are copied
 * during update; callback pointers must live until run returns. One window.
 */
#ifndef NICOTINE_CLOCK_UI_H
#define NICOTINE_CLOCK_UI_H
#ifdef __cplusplus
extern "C" {
#endif
#ifdef _WIN32
#define CLOCK_API __declspec(dllexport)
#else
#define CLOCK_API __attribute__((visibility("default")))
#endif
typedef void (*ClockAction)(int action); /* 1=start/split, 2=reset */
typedef void (*ClockTick)(void);
CLOCK_API int nicotine_clock_run(ClockAction action,ClockTick tick);
CLOCK_API void nicotine_clock_update(const char *time,const char *date,const char *elapsed);
CLOCK_API void nicotine_clock_quit(void);
#ifdef __cplusplus
}
#endif
#endif
