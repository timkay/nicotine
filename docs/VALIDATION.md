# Validated Linux snapshot

The committed binaries include the persistent geometry and Always on top
checkbox changes, plus the GNOME/XWayland launch fix.

- `make test`: 10 runtime and package tests passed.
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
