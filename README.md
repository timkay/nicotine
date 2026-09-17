# Nicotine

A small QuickJS host with JSON, regex, asynchronous HTTP GET, lazy native
bindings, native callbacks, and extractable JavaScript application packages.
GUI libraries are separate from the runtime executable.

## Included binaries

This repository includes Linux x86-64 binaries under `build/`: `nicotine`,
`clock-app`, `clock-gtk.so`, `clock-qt.so`, and `libnicotine-qt.so`.
They were built on this workstation and require compatible system libraries
(including libffi/libcurl for the host and GTK/Cairo or Qt for the chosen GUI).
They are not universal Linux binaries. `build/BUILDINFO.json` records sizes,
dependencies, required glibc symbol versions, compiler, and source hashes.
Verify the files with:

```sh
cd build
sha256sum -c SHA256SUMS
```

Build intermediates, downloaded SDKs, logs, and user settings are excluded.
After rebuilding and repackaging the clock, regenerate binary metadata with
`python3 tools/write_build_manifest.py` before committing updated binaries.

## Run here (Linux)

From the repository directory (locally `/home/timkay/work/nicotine`):

```sh
./run-clock
```

This launches the bundled clock with the graphical session's environment.
On GNOME Wayland it selects XWayland when available, because GTK's native
Wayland backend cannot implement the clock's always-on-top and positioning
requests. The launcher reads DISPLAY/XAUTHORITY from the user service manager
when they are missing from the invoking shell. It is a Python-based development
helper, not part of the packaged runtime. `./run-clock --qt` selects Qt/XCB.
To run source directly, use `./build/nicotine examples/clock.js` from a desktop
terminal; GTK now prefers X11 when DISPLAY is available. Explicit backend
environment settings are respected.

This is the original analog clock, using GTK 3 and Cairo. Click the face or
press Space to start/split the stopwatch; R resets it. Its menu and About
overlay remain in JavaScript. To use the optional Qt image-surface adapter:

```sh
./build/nicotine examples/clock.js --qt
```

The analog clock remembers its window size, position, and hamburger-menu
**Always on top** checkbox. Settings live outside the application package:

- GTK: `$XDG_CONFIG_HOME/nicotine/clock-gtk.ini`
- Qt: `$XDG_CONFIG_HOME/nicotine/clock-qt.ini`

`XDG_CONFIG_HOME` defaults to `~/.config`. GTK stores readable `x`, `y`,
`width`, `height`, and `always_on_top` values in the `[window]` section.
Qt stores its native geometry encoding and the checkbox value. Geometry is
saved after 250 ms without changes and on normal exit; checkbox changes save
immediately. Invalid geometry falls back to defaults, and restored windows
are kept within a current monitor's usable area. Wayland compositors may
ignore application requests for exact position or always-on-top placement.
On native GTK/Wayland, the checkbox reports that the XWayland launcher is
needed instead of showing a checked state that the compositor cannot honor.
Delete the appropriate settings file while the clock is closed to reset it.
These settings currently apply to `clock.js`, not the separate native-controls
demonstration. Already-running clocks must be restarted after an update.

To render a PNG without opening a window:

```sh
./build/nicotine examples/clock.js --fixed-time --render build/clock.png
```

The new cross-platform source example uses native labels and buttons with
app-specific native GUI modules, not a general widget abstraction:

```sh
./build/nicotine examples/native_clock.js
./build/nicotine examples/native_clock.js --qt
```

The shared JS owns stopwatch state, time formatting, and update logic.
`src/clock_gtk.c`, `src/clock_qt.cpp`, `src/clock_win32.c`, and
`src/clock_macos.m` own each platform's controls and event loop. Their small
app-specific ABI is in `src/clock_ui.h`. This is a native-controls example,
not a cross-platform port of the complete analog clock's drawing/menu UI.

## Build and test on Linux

The core needs a C compiler, make, Python 3, libffi development files, and
libcurl development files. QuickJS source is vendored, version 2026-06-04.

```sh
make -j2
make test
```

Optional GUI builds normally use installed development packages:

```sh
make gtk native-qt qt
make gui-test
```

This workstation instead has locally extracted GTK/Qt development headers
under `build/sysroot`; system runtime libraries are already installed.
Nothing was installed globally. Rebuild here using:

```sh
make gtk native-qt qt SYSROOT=build/sysroot
```

`make test` checks native scalar conversion (including full-width uint64),
buffers, lazy binding caching, callbacks and their exceptions, JSON/regex,
monotonic time, local asynchronous HTTP, error handling, package execution,
independent extraction, and tamper detection.

`make gui-test` opens an isolated Xvfb display and uses Qt's offscreen
platform. It runs GTK and Qt self-tests for both clock examples, including
start, split, reset, and normal shutdown. It does not drive the user's desktop.
It also checks checkbox persistence and uses X11 to move/resize the GTK clock,
then verifies that a second process restores the actual geometry. All GUI
tests use a temporary configuration directory, leaving user settings alone.
Xvfb can be installed normally or extracted under `build/sysroot` as here.

## Windows and macOS

Source/build paths are provided; neither platform has been compiled or run
on this Linux workstation. Linux core and both Linux GUI backends are tested.

CMake chooses WinHTTP plus Windows threads/loading on Windows; POSIX uses
system libcurl, pthreads, and dlopen. No Qt/GTK dependency enters the core.
Native Windows uses Win32 controls; macOS uses AppKit/Cocoa controls.

Windows: use an x64 MinGW-w64 toolchain with libffi, CMake, and Python. The
upstream QuickJS sources are not configured for MSVC in this project.

```sh
cmake -S . -B build/windows -G Ninja -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build build/windows
./build/windows/nicotine.exe examples/native_clock.js --library ./build/windows/clock-win32.dll
```

macOS: use Xcode command-line tools, CMake, Python, libffi development files,
and system libcurl headers/library (or an explicitly configured libcurl).
If libffi is outside the SDK, pass `-DFFI_INCLUDE_DIR=... -DFFI_LIBRARY=...`.

```sh
cmake -S . -B build/macos -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build build/macos
./build/macos/nicotine examples/native_clock.js --library ./build/macos/clock-macos.dylib
```

Optional CMake switches `-DNICOTINE_GTK=ON` and `-DNICOTINE_QT=ON` build
the respective native-controls module when its SDK is installed.
The original `clock.js` uses Linux GTK/Cairo and is not the portable example.

## Source packages and review

```sh
python3 tools/package.py pack build/nicotine examples/clock.js build/clock-app
python3 tools/package.py inspect build/clock-app --trusted-runtime build/nicotine
python3 tools/package.py extract build/clock-app build/extracted --trusted-runtime build/nicotine
./build/clock-app
```

The output is the runtime followed by UTF-8 application source, a JSON
manifest, and a fixed footer. The inspector never executes the package.
The source and runtime hashes must match the manifest; `--trusted-runtime`
additionally compares the runtime bytes with the specified trusted binary.
Outputs are created exclusively, avoiding accidental overwrites.

This prototype handles one JS entry file. Platform GUI modules are separate
artifacts, selected by `--library`, and are not covered by this manifest.
There is no signing, certificate validation, installer, approved-runtime
registry, or sandbox yet. The executable itself reads the source footer;
the independent inspection step performs manifest/hash validation. Hashes
establish integrity, not the publisher's identity. Treat native GUI modules
as part of the trusted platform build and review their source too.

## Current limits

- Native calls use a single platform's default ABI, at most 32 arguments;
  no variadic calls, structure-by-value descriptors, or alternate x86 ABIs.
- Default inferred result is int32. Select pointer, uint64, floating, and
  void results explicitly. Signatures cannot be discovered from symbols.
- Native strings are UTF-8 C strings valid for the duration of a call.
  Retained pointers require app-owned buffers kept alive until native release.
- Callbacks are held until runtime shutdown and must arrive on the owner
  thread. Foreign-thread callbacks are rejected without entering QuickJS.
- `fetch` supports GET, status/ok, and one-shot text/json bodies, capped at
  16 MiB. It is not the entire web Fetch specification. HTTPS uses the host
  certificate policy. GUI loops call `Native.pump()` to service completion.
- JavaScript files run as global scripts, not ES modules. No npm or Node API.
- Executable size excludes dynamically linked system libraries and GUI
  modules. Deployment-size comparisons must account for the target machine.

See [docs/ABI.md](docs/ABI.md) for the scripting interface.
