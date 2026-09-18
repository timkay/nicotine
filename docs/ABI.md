# Nicotine ABI 0.1 (prototype)

`nicotine.abi`, `nicotine.platform` (`linux`, `windows`, `macos`), and
`nicotine.args` identify the host and app arguments. `performance.now()`
is monotonic milliseconds. JSON and RegExp are standard QuickJS built-ins.

```js
const result = native.exported_function(42); // search standard libraries
const pointer = native.ptr.create_object();
const precise = native.f64.some_function; // return type is on the left
precise(pointer, 1.25);
```

`native` searches the platform's ordered standard-library list. An app can
provide another ordered list with `native.search(['library-a', 'library-b'])`;
the first library exporting a symbol supplies the call. `Native.library(path)`
remains available when a symbol collision must be qualified. The runtime opens
and searches libraries only when a symbol is first used.

Supported types: `void` (results only), `i32`, `u32`, `i64`, `u64`, `ptr`,
`str` (UTF-8), `f32`, `f64`. Symbol wrappers and inferred signatures are
installed on first use.

Integers within signed int32 range infer i32; booleans infer i32; BigInt
infers i64; string infers str; null, native pointers, and ArrayBuffers infer
ptr. Other numbers require `Native.f32`, `Native.f64`, or `Native.u32`.
Explicit `.as` bindings convert according to their supplied signature.
Results default to i32. Use `native.ptr.function(...)`,
`native.f64.function(...)`, or another fixed type namespace when the result is
not an i32. The equivalent `.returns('ptr')` form remains available for
generated or compatibility code. `.as(result, ...types)` is the escape hatch
for a complete explicit signature.

```js
const output = Native.buffer(8);
lib.write_result.returns('void')(Native.ref(output));
const answer = new DataView(output).getBigUint64(0, true);
const callback = Native.callback('i32', ['i32'], n => n + 1);
```

ArrayBuffers passed as pointers remain owned by JavaScript. Applications
must retain them if native code retains their address. Native pointers are
opaque and cannot be converted to arbitrary JS memory views. `Native.isNull`
checks null. No arbitrary integer-to-pointer conversion is exposed.

Callback exceptions are retained and rethrown after the enclosing native call
returns. A callback in a GUI loop must arrange to terminate the loop on error
if immediate shutdown is desired; see native_clock.js. String return types
are disallowed for callbacks because their storage lifetime is ambiguous.

`fetch(url)` returns a Promise with `{status, ok, text(), json()}`. Non-2xx
HTTP responses resolve normally; transport failures reject. Bodies can be
consumed once. `Native.pump()` runs completion handlers and pending Promise
jobs on the JS owner thread. The host pumps automatically after entry-source
execution; a native GUI loop must pump periodically itself.

## App-specific native clock ABI

All four clock modules export:

```c
int nicotine_clock_run(void (*action)(int), void (*tick)(void));
void nicotine_clock_update(const char *time, const char *date, const char *elapsed);
void nicotine_clock_quit(void);
```

Action 1 starts/splits; action 2 resets. Tick occurs approximately every 33 ms.
Strings are copied before update returns. Run owns one native window and
returns after it closes. The JS app keeps state; the native module owns
controls, presentation, and event dispatch. This ABI belongs to this example,
not the generic runtime, and does not attempt to normalize widget toolkits.
