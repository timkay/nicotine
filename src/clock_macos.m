#import <Cocoa/Cocoa.h>
#include "clock_ui.h"
static NSWindow *window;
static NSTextField *labels[3];
static ClockAction action;
static ClockTick tick;
@interface ClockDelegate : NSObject <NSWindowDelegate>
@end
@implementation ClockDelegate
- (void)clicked:(NSButton *)sender { action((int)sender.tag); }
- (void)refresh:(NSTimer *)timer { (void)timer;tick(); }
- (void)windowWillClose:(NSNotification *)note {
    (void)note;[NSApp stop:nil];
    [NSApp postEvent:[NSEvent otherEventWithType:NSEventTypeApplicationDefined location:NSZeroPoint
        modifierFlags:0 timestamp:0 windowNumber:0 context:nil subtype:0 data1:0 data2:0] atStart:NO];
}
@end
void nicotine_clock_update(const char *time,const char *date,const char *elapsed){
    if(!window)return;const char *values[]={time,date,elapsed};
    for(int i=0;i<3;i++)labels[i].stringValue=[NSString stringWithUTF8String:values[i]] ?: @"";
}
void nicotine_clock_quit(void){[window close];}
int nicotine_clock_run(ClockAction on_action,ClockTick on_tick){
    if(window || !on_action || !on_tick)return 1;
    @autoreleasepool {
        action=on_action;tick=on_tick;[NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        ClockDelegate *delegate=[ClockDelegate new];
        window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,420,220)
            styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable
            backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed=NO;window.title=@"Nicotine Clock — macOS";window.delegate=delegate;
        for(int i=0;i<3;i++){
            labels[i]=[NSTextField labelWithString:@""];labels[i].alignment=NSTextAlignmentCenter;
            labels[i].frame=NSMakeRect(20,170-i*40,380,30);[window.contentView addSubview:labels[i]];
        }
        NSArray *titles=@[@"Start / split",@"Reset"];
        for(int i=0;i<2;i++){
            NSButton *button=[NSButton buttonWithTitle:titles[i] target:delegate action:@selector(clicked:)];
            button.tag=i+1;button.frame=NSMakeRect(30+i*200,20,160,35);[window.contentView addSubview:button];
        }
        NSTimer *timer=[NSTimer scheduledTimerWithTimeInterval:0.033 target:delegate selector:@selector(refresh:) userInfo:nil repeats:YES];
        [window center];[window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];[NSApp run];
        [timer invalidate];[window orderOut:nil];window.delegate=nil;window=nil;
        for(int i=0;i<3;i++)labels[i]=nil;
    }
    return 0;
}
