# Validated Linux snapshot and macOS handoff

The committed binaries include the persistent geometry and Always on top
checkbox changes, plus the GNOME/XWayland launch fix.

- `make test`: 14 runtime and package tests passed. This includes structure
  calls, pointer conversion, the left-side return-type namespaces, ordered
  library search, and proof that an installed method bypasses the missing-call
  path on subsequent calls.
- `make gui-test`: analog GTK, analog Qt, native-controls GTK, and
  native-controls Qt self-tests passed. Checkbox persistence passed for GTK
  and Qt. A real X11 move/resize followed by a fresh GTK process restored
  the actual saved geometry.
- Packaged clock extraction matched `examples/clock.js` and the trusted
  runtime bytes. Packaged Qt self-test passed.
- On the user's GNOME Wayland desktop, native Wayland ignored keep-above.
  Relaunch through XWayland was checked with `xprop`; GNOME reported
  `_NET_WM_STATE_ABOVE` on the new clock window. The checked checkbox alone
  was not treated as proof of window-manager behavior.

GUI tests isolate their display/configuration and do not modify user settings.
The desktop check used the real compositor. Automated Xvfb tests do not
independently prove compositor stacking policy.

Windows and macOS source ports remain uncompiled/unexecuted here. There is
no signing or installer in this prototype; see README.md for packaging and
trust limits.

## macOS handoff

The Linux tree is clean, committed, pushed, and contains the tested Linux
runtime and packaged clock. On a Mac, use the checked-in source and build a
native runtime locally:

```sh
cd /path/to/nicotine
cmake -S . -B build/macos -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build build/macos
./build/macos/nicotine examples/native_clock.js --self-test
```

The portable example calls AppKit and Objective-C through `native`, whose
standard search list includes AppKit, CoreFoundation, and libobjc. It does not
require a clock-specific native module. The Linux `build/nicotine` binary is
not a Mac binary and must not be copied over the Mac build. Verify the Mac
runtime and source package on that machine before signing or distributing it.
