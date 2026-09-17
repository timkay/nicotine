#define UNICODE
#define _UNICODE
#include "clock_ui.h"
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>
static HWND window,labels[3],buttons[2];
static ClockAction action;
static ClockTick tick;
static void text(HWND control,const char *value){
    int n=MultiByteToWideChar(CP_UTF8,0,value,-1,NULL,0);
    wchar_t *wide=malloc(n*sizeof(*wide));if(!wide)return;
    MultiByteToWideChar(CP_UTF8,0,value,-1,wide,n);SetWindowTextW(control,wide);free(wide);
}
void nicotine_clock_update(const char *time,const char *date,const char *elapsed){
    if(!window)return;const char *values[]={time,date,elapsed};
    for(int i=0;i<3;i++)text(labels[i],values[i]);
}
void nicotine_clock_quit(void){if(window)DestroyWindow(window);}
static void layout(HWND hwnd){
    RECT r;GetClientRect(hwnd,&r);int width=r.right;
    for(int i=0;i<3;i++)MoveWindow(labels[i],16,20+38*i,width-32,32,TRUE);
    for(int i=0;i<2;i++)MoveWindow(buttons[i],16+i*(width/2),145,width/2-32,32,TRUE);
}
static LRESULT CALLBACK procedure(HWND hwnd,UINT message,WPARAM w,LPARAM l){
    switch(message){
    case WM_SIZE:layout(hwnd);return 0;
    case WM_TIMER:tick();return 0;
    case WM_COMMAND:if(HIWORD(w)==BN_CLICKED && LOWORD(w)>=101 && LOWORD(w)<=102)action(LOWORD(w)-100);return 0;
    case WM_DESTROY:KillTimer(hwnd,1);window=NULL;PostQuitMessage(0);return 0;
    default:return DefWindowProcW(hwnd,message,w,l);
    }
}
int nicotine_clock_run(ClockAction on_action,ClockTick on_tick){
    if(window || !on_action || !on_tick)return 1;
    action=on_action;tick=on_tick;HINSTANCE instance=GetModuleHandleW(NULL);
    WNDCLASSW wc={0};wc.lpfnWndProc=procedure;wc.hInstance=instance;
    wc.lpszClassName=L"NicotineClock";wc.hCursor=LoadCursorW(NULL,IDC_ARROW);wc.hbrBackground=(HBRUSH)(COLOR_WINDOW+1);
    if(!RegisterClassW(&wc) && GetLastError()!=ERROR_CLASS_ALREADY_EXISTS)return 1;
    window=CreateWindowExW(0,wc.lpszClassName,L"Nicotine Clock — Win32",WS_OVERLAPPEDWINDOW,
                           CW_USEDEFAULT,CW_USEDEFAULT,460,270,NULL,NULL,instance,NULL);
    if(!window)return 1;
    for(int i=0;i<3;i++)labels[i]=CreateWindowW(L"STATIC",L"",WS_CHILD|WS_VISIBLE|SS_CENTER,0,0,1,1,window,NULL,instance,NULL);
    const wchar_t *titles[]={L"Start / split",L"Reset"};
    for(int i=0;i<2;i++)buttons[i]=CreateWindowW(L"BUTTON",titles[i],WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_PUSHBUTTON,
                    0,0,1,1,window,(HMENU)(INT_PTR)(101+i),instance,NULL);
    for(int i=0;i<3;i++)SendMessageW(labels[i],WM_SETFONT,(WPARAM)GetStockObject(DEFAULT_GUI_FONT),TRUE);
    for(int i=0;i<2;i++)SendMessageW(buttons[i],WM_SETFONT,(WPARAM)GetStockObject(DEFAULT_GUI_FONT),TRUE);
    layout(window);SetTimer(window,1,33,NULL);ShowWindow(window,SW_SHOW);
    MSG msg;int rc;
    while((rc=GetMessageW(&msg,NULL,0,0))>0){if(!window || !IsDialogMessageW(window,&msg)){TranslateMessage(&msg);DispatchMessageW(&msg);}}
    if(window)DestroyWindow(window);UnregisterClassW(wc.lpszClassName,instance);return rc<0?1:0;
}
