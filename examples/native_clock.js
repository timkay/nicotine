// Native controls created by direct OS calls. No app-specific native module.
// Run: nicotine examples/native_clock.js [--self-test]
(() => {
  const selfTest = nicotine.args.includes('--self-test');
  if (nicotine.args.includes('--qt') || nicotine.args.includes('--library')) {
    throw new Error('This example calls GTK, Win32, or Cocoa directly; no --qt or --library module is used');
  }
  const state = {running: false, started: 0, split: null};
  let ticks = 0;
  let failure = null;
  let ui;

  function elapsed() {
    return ((performance.now() - state.started) / 1000).toFixed(3) + ' s';
  }
  function startOrSplit() {
    if (state.running) {
      state.split = elapsed();
    } else {
      state.started = performance.now();
      state.running = true;
    }
  }
  function reset() {
    state.running = false;
    state.split = null;
  }
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  function tick() {
    // Native GUI loops must be stopped before propagating a JS exception.
    try {
      Native.pump();
      ticks++;
      if (selfTest) {
        // Exercise real native button dispatch, not just the JS handlers.
        if (ticks === 1) {
          ui.clickStart();
          check(state.running, 'start failed');
        } else if (ticks === 2) {
          ui.clickStart();
          check(state.split !== null, 'split failed');
        } else if (ticks === 3) {
          ui.clickReset();
          check(!state.running && state.split === null, 'reset failed');
        } else if (ticks === 5) {
          ui.close();
          return;
        }
      }
      const now = new Date();
      const stopwatch = state.running
        ? elapsed() + (state.split === null ? '' : `  Split: ${state.split}`)
        : 'Ready';
      ui.update([now.toTimeString().split(' ')[0], now.toDateString(), stopwatch]);
    } catch (error) {
      failure = error;
      ui.close();
    }
  }

  function gtkWindow() {
    check(native.gtk_init_check(null, null), 'Cannot initialize GTK');
    const window = native.ptr.gtk_window_new(0);
    native.void.gtk_window_set_title(window, 'Nicotine Clock — GTK');
    native.void.gtk_window_set_default_size(window, 420, 220);
    const box = native.ptr.gtk_box_new(1, 12); // GTK_ORIENTATION_VERTICAL
    native.void.gtk_container_set_border_width(box, Native.u32(24));
    native.void.gtk_container_add(window, box);
    const labels = [];
    for (let index = 0; index < 3; index++) {
      const label = native.ptr.gtk_label_new('');
      labels.push(label);
      native.void.gtk_box_pack_start(box, label, true, true, Native.u32(0));
    }
    const buttons = native.ptr.gtk_box_new(0, 12); // GTK_ORIENTATION_HORIZONTAL
    native.void.gtk_box_pack_start(box, buttons, false, false, 0);
    const startButton = native.ptr.gtk_button_new_with_label('Start / split');
    const resetButton = native.ptr.gtk_button_new_with_label('Reset');
    native.void.gtk_box_pack_start(buttons, startButton, true, true, 0);
    native.void.gtk_box_pack_start(buttons, resetButton, true, true, 0);

    // GTK owns widgets. Nicotine pins callbacks until runtime shutdown.
    native.u64.g_signal_connect_data(startButton, 'clicked',
      Native.callback('void', ['ptr', 'ptr'], startOrSplit), null, null, 0);
    native.u64.g_signal_connect_data(resetButton, 'clicked',
      Native.callback('void', ['ptr', 'ptr'], reset), null, null, 0);
    let closed = false;
    let timer = 0;
    native.u64.g_signal_connect_data(window, 'destroy',
      Native.callback('void', ['ptr', 'ptr'], () => {
        closed = true;
        native.void.gtk_main_quit();
      }), null, null, 0);
    return {
      update(values) {
        for (let index = 0; index < labels.length; index++) {
          native.void.gtk_label_set_text(labels[index], values[index]);
        }
      },
      clickStart() { native.void.gtk_button_clicked(startButton); },
      clickReset() { native.void.gtk_button_clicked(resetButton); },
      close() { if (!closed) native.void.gtk_widget_destroy(window); },
      run() {
        timer = native.u32.g_timeout_add(Native.u32(33),
          Native.callback('i32', ['ptr'], () => { tick(); return 1; }), null);
        check(timer !== 0, 'Cannot create GTK timer');
        try {
          native.void.gtk_widget_show_all(window);
          native.void.gtk_main();
        } finally {
          native.void.g_source_remove(Native.u32(timer));
          if (!closed) native.void.gtk_widget_destroy(window);
        }
      }
    };
  }

  function windowsWindow() {
    check(Native.pointerSize === 8, 'This Win32 example requires a 64-bit runtime');
    const user = Native.library('user32.dll');
    const kernel = Native.library('kernel32.dll');
    const gdi = Native.library('gdi32.dll');
    // Windows W APIs consume UTF-16, not the FFI's temporary UTF-8 strings.
    function wide(text) {
      const buffer = Native.buffer((text.length + 1) * 2);
      const view = new DataView(buffer);
      for (let index = 0; index < text.length; index++) {
        view.setUint16(index * 2, text.charCodeAt(index), true);
      }
      return buffer;
    }
    const instance = kernel.GetModuleHandleW.returns('ptr')(null);
    const className = wide('NicotineDirectClock');
    const labels = [];
    const buttons = [];
    let window = null;
    let closed = false;
    const WM_SIZE = 0x0005, WM_DESTROY = 0x0002, WM_COMMAND = 0x0111, WM_TIMER = 0x0113;
    const BM_CLICK = 0x00f5, WM_SETFONT = 0x0030;
    function layout(handle) {
      if (labels.length !== 3 || buttons.length !== 2) return;
      const rectangle = Native.buffer(16); // RECT: four signed 32-bit coordinates
      check(user.GetClientRect(handle, rectangle), 'GetClientRect failed');
      const width = new DataView(rectangle).getInt32(8, true);
      for (let index = 0; index < labels.length; index++) {
        user.MoveWindow(labels[index], 16, 20 + 38 * index, Math.max(1, width - 32), 32, true);
      }
      const half = Math.floor(width / 2);
      for (let index = 0; index < buttons.length; index++) {
        user.MoveWindow(buttons[index], 16 + index * half, 145, Math.max(1, half - 32), 32, true);
      }
    }
    const procedure = Native.callback('i64', ['ptr', 'u32', 'u64', 'i64'],
      (handle, message, word, parameter) => {
        try {
          if (message === WM_DESTROY) {
            closed = true;
            user.KillTimer(handle, Native.u64(1n));
            user.PostQuitMessage.returns('void')(0);
            return 0n;
          }
          if (message === WM_SIZE) { layout(handle); return 0n; }
          if (message === WM_TIMER) { tick(); return 0n; }
          if (message === WM_COMMAND && ((word >> 16n) & 0xffffn) === 0n) {
            if ((word & 0xffffn) === 101n) startOrSplit();
            if ((word & 0xffffn) === 102n) reset();
            return 0n;
          }
          return user.DefWindowProcW.returns('i64')(handle, Native.u32(message), Native.u64(word), parameter);
        } catch (error) {
          failure = error;
          if (!closed) user.DestroyWindow(handle);
          return 0n;
        }
      });
    // WNDCLASSW, 64-bit layout. All referenced buffers remain in this closure
    // until the window is destroyed and the class is unregistered.
    const windowClass = Native.buffer(72);
    const fields = new DataView(windowClass);
    fields.setBigUint64(8, Native.address(procedure), true); // lpfnWndProc
    fields.setBigUint64(24, Native.address(instance), true); // hInstance
    const cursor = user.LoadCursorW.returns('ptr')(null, Native.pointer(32512n)); // IDC_ARROW
    fields.setBigUint64(40, Native.address(cursor), true);
    fields.setBigUint64(48, 6n, true); // COLOR_WINDOW + 1
    fields.setBigUint64(64, Native.address(className), true);
    check(user.RegisterClassW(windowClass), 'RegisterClassW failed');
    function control(classText, title, style, id) {
      const handle = user.CreateWindowExW.returns('ptr')(Native.u32(0), wide(classText), wide(title),
        Native.u32(style), 0, 0, 1, 1, window, Native.pointer(BigInt(id)), instance, null);
      check(!Native.isNull(handle), `Cannot create ${classText}`);
      return handle;
    }
    return {
      update(values) {
        for (let index = 0; index < labels.length; index++) {
          check(user.SetWindowTextW(labels[index], wide(values[index])), 'SetWindowTextW failed');
        }
      },
      clickStart() { user.SendMessageW.returns('i64')(buttons[0], Native.u32(BM_CLICK), Native.u64(0n), 0n); },
      clickReset() { user.SendMessageW(buttons[1], Native.u32(BM_CLICK), Native.u64(0n), 0n); },
      close() { if (!closed && window) user.DestroyWindow(window); },
      run() {
        try {
          window = user.CreateWindowExW.returns('ptr')(Native.u32(0), className,
            wide('Nicotine Clock — Win32'), Native.u32(0x00cf0000), // WS_OVERLAPPEDWINDOW
            -2147483648, -2147483648, 460, 270, null, null, instance, null);
          check(!Native.isNull(window), 'CreateWindowExW failed');
          for (let index = 0; index < 3; index++) labels.push(control('STATIC', '', 0x50000001, 0));
          buttons.push(control('BUTTON', 'Start / split', 0x50010000, 101));
          buttons.push(control('BUTTON', 'Reset', 0x50010000, 102));
          const font = gdi.GetStockObject.returns('ptr')(17); // DEFAULT_GUI_FONT
          for (const handle of [...labels, ...buttons]) {
            user.SendMessageW.returns('i64')(handle, Native.u32(WM_SETFONT), Native.u64(Native.address(font)), 1n);
          }
          layout(window);
          check(user.SetTimer.returns('u64')(window, Native.u64(1n), Native.u32(33), null) !== 0n,
            'SetTimer failed');
          user.ShowWindow(window, 5); // SW_SHOW
          const message = Native.buffer(48); // MSG, 64-bit Windows layout
          let status;
          while ((status = user.GetMessageW(message, null, Native.u32(0), Native.u32(0))) > 0) {
            if (!user.IsDialogMessageW(window, message)) {
              user.TranslateMessage(message);
              user.DispatchMessageW.returns('i64')(message);
            }
          }
          check(status === 0, 'GetMessageW failed');
        } finally {
          if (window && !closed) user.DestroyWindow(window);
          user.UnregisterClassW(className, instance);
        }
      }
    };
  }

  function cocoaWindow() {
    check(Native.pointerSize === 8, 'This Cocoa example requires a 64-bit runtime');
    // Loading AppKit registers its Objective-C classes. NSApplicationLoad is
    // an ordinary exported C function, resolved on its first call.
    const appKit = Native.library('/System/Library/Frameworks/AppKit.framework/AppKit');
    check(appKit.NSApplicationLoad.returns('u8')(), 'Cannot initialize AppKit');
    const runtime = Native.library('/usr/lib/libobjc.A.dylib');
    function classPointer(name) {
      const pointer = runtime.objc_getClass.returns('ptr')(name);
      check(!Native.isNull(pointer), `Missing Objective-C class ${name}`);
      return pointer;
    }
    const strings = Native.objc(classPointer('NSString'));
    const textFields = Native.objc(classPointer('NSTextField'));
    const buttonClass = Native.objc(classPointer('NSButton'));
    function string(text) {
      return strings['stringWithUTF8String:'].returns('ptr')(text);
    }
    function rectangle(x, y, width, height) {
      const bytes = new Float64Array([x, y, width, height]).buffer;
      // NSRect is {NSPoint {double,double}, NSSize {double,double}} on 64-bit macOS.
      return Native.struct([['f64', 'f64'], ['f64', 'f64']], bytes);
    }
    const pool = runtime.objc_autoreleasePoolPush.returns('ptr')();
    const appPointer = Native.objc(classPointer('NSApplication')).sharedApplication.returns('ptr')();
    const app = Native.objc(appPointer);
    app['setActivationPolicy:'].returns('u8')(0n);
    const windowPointer = Native.objc(Native.objc(classPointer('NSWindow')).alloc.returns('ptr')())
      ['initWithContentRect:styleMask:backing:defer:'].returns('ptr')(
        rectangle(0, 0, 420, 220), Native.u64(7n), Native.u64(2n), Native.u8(0));
    check(!Native.isNull(windowPointer), 'Cannot create Cocoa window');
    const window = Native.objc(windowPointer);
    window['setReleasedWhenClosed:'].returns('void')(Native.u8(0));
    window['setTitle:'].returns('void')(string('Nicotine Clock — macOS'));
    const content = Native.objc(window.contentView.returns('ptr')());
    let closed = false;

    // Methods are callbacks installed in an Objective-C class at runtime.
    // Their encodings describe the callback ABI, not a catalog of OS functions.
    const delegateClass = runtime.objc_allocateClassPair.returns('ptr')(
      classPointer('NSObject'), 'NicotineClockDelegate', Native.u64(0n));
    check(!Native.isNull(delegateClass), 'Cannot create Cocoa delegate class');
    const callbacks = [
      ['start:', startOrSplit], ['reset:', reset], ['windowWillClose:', () => { closed = true; }]
    ];
    for (const [name, handler] of callbacks) {
      const callback = Native.callback('void', ['ptr', 'ptr', 'ptr'], () => {
        try { handler(); } catch (error) { failure = error; closed = true; }
      });
      check(runtime.class_addMethod.returns('u8')(delegateClass,
        runtime.sel_registerName.returns('ptr')(name), callback, 'v@:@'), `Cannot add ${name}`);
    }
    runtime.objc_registerClassPair.returns('void')(delegateClass);
    const delegatePointer = Native.objc(delegateClass).new.returns('ptr')();
    window['setDelegate:'].returns('void')(delegatePointer);
    const labels = [];
    for (let index = 0; index < 3; index++) {
      const labelPointer = textFields['labelWithString:'].returns('ptr')(string(''));
      const label = Native.objc(labelPointer);
      label['setAlignment:'].returns('void')(1n); // NSTextAlignmentCenter
      label['setFrame:'].returns('void')(rectangle(20, 170 - index * 40, 380, 30));
      content['addSubview:'].returns('void')(labelPointer);
      labels.push(label);
    }
    const buttons = [];
    for (const [index, title, action] of [[0, 'Start / split', 'start:'], [1, 'Reset', 'reset:']]) {
      const buttonPointer = buttonClass['buttonWithTitle:target:action:'].returns('ptr')(
        string(title), delegatePointer, runtime.sel_registerName(action));
      const button = Native.objc(buttonPointer);
      button['setFrame:'].returns('void')(rectangle(30 + index * 200, 20, 160, 35));
      content['addSubview:'](buttonPointer);
      buttons.push(button);
    }
    const dates = Native.objc(classPointer('NSDate'));
    const runLoopMode = string('kCFRunLoopDefaultMode'); // NSDefaultRunLoopMode's string value
    return {
      update(values) {
        for (let index = 0; index < labels.length; index++) {
          labels[index]['setStringValue:'].returns('void')(string(values[index]));
        }
      },
      clickStart() { buttons[0]['performClick:'].returns('void')(null); },
      clickReset() { buttons[1]['performClick:'].returns('void')(null); },
      close() { if (!closed) window.close.returns('void')(); },
      run() {
        try {
          window.center.returns('void')();
          window['makeKeyAndOrderFront:'].returns('void')(null);
          app.finishLaunching.returns('void')();
          app['activateIgnoringOtherApps:'].returns('void')(Native.u8(1));
          while (!closed) {
            const iterationPool = runtime.objc_autoreleasePoolPush();
            try {
              const deadline = dates['dateWithTimeIntervalSinceNow:'].returns('ptr')(Native.f64(0.033));
              const event = app['nextEventMatchingMask:untilDate:inMode:dequeue:'].returns('ptr')(
                Native.u64(0xffffffffffffffffn), deadline, runLoopMode, Native.u8(1));
              if (!Native.isNull(event)) app['sendEvent:'].returns('void')(event);
              if (!closed) { tick(); app.updateWindows.returns('void')(); }
            } finally {
              runtime.objc_autoreleasePoolPop.returns('void')(iterationPool);
            }
          }
        } finally {
          window['setDelegate:'](null);
          window['orderOut:'].returns('void')(null);
          window.release.returns('void')();
          Native.objc(delegatePointer).release.returns('void')();
          runtime.objc_autoreleasePoolPop(pool);
        }
      }
    };
  }

  switch (nicotine.platform) {
    case 'linux': ui = gtkWindow(); break;
    case 'windows': ui = windowsWindow(); break;
    case 'macos': ui = cocoaWindow(); break;
    default: throw new Error(`Unsupported platform: ${nicotine.platform}`);
  }
  ui.run();
  if (failure) throw failure;
  if (selfTest) console.log(`native clock ${nicotine.platform} direct-call self-test passed`);
})();
