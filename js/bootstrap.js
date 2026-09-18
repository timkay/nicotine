// Nicotine ABI 0.1. No toolkit-specific behavior belongs in this file.
(() => {
  const h = globalThis.__host;
  const marker = Symbol('native argument');
  const valid = new Set(['void', 'i32', 'u32', 'i64', 'u64', 'ptr', 'str', 'f32', 'f64', 'i8', 'u8']);
  function typed(type, value) { return {[marker]:type, value}; }
  function infer(value) {
    if (value && value[marker]) return [value[marker],value.value];
    if (value === null || value instanceof ArrayBuffer || h.isPointer(value)) return ['ptr',value];
    if (typeof value === 'string') return ['str',value];
    if (typeof value === 'bigint') return ['i64',value];
    if (typeof value === 'boolean') return ['i32',Number(value)];
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return ['i32',value];
    throw new TypeError('Use Native.f64, Native.u32 or BigInt for non-int32 arguments');
  }
  // The proxy is a prototype, not the object the app calls. Once an own
  // method is installed, normal property lookup never visits this trap.
  function methods(resolve) {
    const object = Object.create(new Proxy(Object.create(null), {
      get(_, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        let native;
        const results = new Map();
        const explicit = new Map();
        const resolveOnce = () => native || (native = resolve(name));
        function decorate(method) {
          method.returns = result => {
            if (!validType(result)) throw new TypeError('Unknown native return type');
            const key = JSON.stringify(result);
            if (!results.has(key)) results.set(key, pending(result));
            return results.get(key);
          };
          // Compatibility escape hatch. Ordinary calls need no declaration.
          method.as = (result, ...types) => {
            const key = JSON.stringify([result, types]);
            if (!explicit.has(key)) {
              const {address, prefix = []} = resolveOnce();
              explicit.set(key, makeThunk(address, result,
                [...prefix.map(infer).map(item => item[0]), ...types], prefix));
            }
            return explicit.get(key);
          };
          // Return-type namespaces can be written on the call itself:
          // library.function['ptr'](arg). Keep the names limited and visible.
          return new Proxy(method, {get(target, property, receiver) {
            if (typeof property === 'string' && validType(property)) {
              return target.returns(property);
            }
            return Reflect.get(target, property, receiver);
          }});
        }
        function pending(result) {
          let installed;
          return decorate(function firstCall(...args) {
            // A reference saved before installation still forwards correctly.
            if (installed) return installed(...args);
            const {address, prefix = []} = resolveOnce();
            const types = [...prefix, ...args].map(infer).map(item => item[0]);
            installed = decorate(makeThunk(address, result, types, prefix));
            results.set(JSON.stringify(result), installed);
            Object.defineProperty(object, name, {value: installed, configurable: true});
            return installed(...args);
          });
        }
        const first = pending('i32');
        results.set(JSON.stringify('i32'), first);
        Object.defineProperty(object, name, {value: first, configurable: true});
        return first;
      }
    }));
    return object;
  }
  function makeThunk(address, result, types, prefix) {
    const call = h.bind(address, result, types);
    // Only convert values according to the fixed signature. Never infer types
    // or resolve a symbol here. Type hints may be omitted after the first call.
    return (...args) => call(...prefix, ...args.map((value, index) => {
      if (!value || !value[marker]) return value;
      if (JSON.stringify(value[marker]) !== JSON.stringify(types[prefix.length + index]))
        throw new TypeError('Native argument hint differs from installed signature');
      return value.value;
    }));
  }
  function library(path) {
    let handle;
    return scoped(methods(name => {
      if (!handle) handle = h.open(path);
      return {address: h.symbol(handle, name)};
    }));
  }
  function search(paths) {
    if (!Array.isArray(paths) || !paths.length) throw new TypeError('search requires native library paths');
    const handles = new Map();
    return scoped(methods(name => {
      let lastError = '';
      for (const path of paths) {
        let handle = handles.get(path);
        try {
          if (!handle) { handle = h.open(path); handles.set(path, handle); }
          return {address: h.symbol(handle, name)};
        } catch (error) {
          lastError = String(error && error.message || error);
        }
      }
      throw new ReferenceError(`Cannot resolve native symbol ${name}; searched ${paths.join(', ')}${lastError ? ` (${lastError})` : ''}`);
    }));
  }
  function validType(type, depth = 0) {
    return valid.has(type) || (depth < 8 && Array.isArray(type) && type.length > 0 &&
      type.length <= 32 && type.every(field => field !== 'void' && field !== 'str' && validType(field, depth + 1)));
  }
  function platformLibraries() {
    if (h.platform === 'windows') return ['user32.dll', 'kernel32.dll', 'gdi32.dll', 'comdlg32.dll', 'shell32.dll'];
    if (h.platform === 'macos') return [
      '/System/Library/Frameworks/AppKit.framework/AppKit',
      '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation',
      '/usr/lib/libobjc.A.dylib'
    ];
    return ['libgtk-3.so.0', 'libgobject-2.0.so.0', 'libglib-2.0.so.0',
      'libgdk-3.so.0', 'libcairo.so.2', 'libX11.so.6', 'libm.so.6', 'libc.so.6'];
  }
  const system = search(platformLibraries());
  function typedNamespace(type, object = system) {
    return new Proxy(Object.create(null), {get(_, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (!validType(type)) throw new TypeError(`Unknown native return type: ${type}`);
      return object[name].returns(type);
    }});
  }
  function scoped(object) {
    return new Proxy(object, {get(target, name, receiver) {
      if (typeof name === 'string' && validType(name)) return typedNamespace(name, target);
      return Reflect.get(target, name, receiver);
    }});
  }
  const native = new Proxy({search, library, system}, {get(target, name, receiver) {
    if (Reflect.has(target, name)) return Reflect.get(target, name, receiver);
    if (typeof name === 'string' && validType(name)) return typedNamespace(name);
    return system[name];
  }});
  let objectiveC, messageAddress, objectiveCRuntime;
  function objc(receiver) {
    if (h.platform !== 'macos') throw new Error('Objective-C messaging requires macOS');
    if (!objectiveC) {
      objectiveC = h.open('/usr/lib/libobjc.A.dylib');
      objectiveCRuntime = library('/usr/lib/libobjc.A.dylib');
    }
    if (!messageAddress) messageAddress = h.symbol(objectiveC, 'objc_msgSend');
    return methods(selector => ({
      address: messageAddress,
      prefix: [receiver, objectiveCRuntime.sel_registerName.returns('ptr')(selector)]
    }));
  }
  globalThis.native = native;
  globalThis.Native = Object.freeze({
    library, search, objc, callback:h.callback, isNull:p=>p === null || h.isNull(p),
    buffer:n=>new ArrayBuffer(n), ref:b=>typed('ptr',b),
    address:h.address, pointer:h.pointer, pointerSize:h.pointerSize,
    struct:(fields, buffer)=>{
      if (!Array.isArray(fields) || !validType(fields)) throw new TypeError('Invalid structure fields');
      return typed(JSON.parse(JSON.stringify(fields)), buffer);
    },
    i8:v=>typed('i8',v), u8:v=>typed('u8',v),
    i32:v=>typed('i32',v), u32:v=>typed('u32',v),
    f32:v=>typed('f32',v), f64:v=>typed('f64',v),
    i64:v=>typed('i64',v), u64:v=>typed('u64',v),
    pump:h.pump
  });
  globalThis.nicotine = Object.freeze({abi:'0.1', platform:h.platform, args:h.args});
  globalThis.performance = Object.freeze({now:h.now});
  globalThis.console = Object.freeze({log:h.print, error:h.print});
  globalThis.fetch = async (url, options={}) => {
    if (Object.keys(options).some(k=>k!=='method') || (options.method && options.method!=='GET'))
      throw new TypeError('Prototype fetch supports GET only');
    const response = await h.fetch(String(url));
    const body = response.body;
    let used = false;
    async function text() {
      if (used) throw new TypeError('Response body already consumed');
      used = true;
      return body;
    }
    return Object.freeze({status:response.status, ok:response.status>=200 && response.status<300,
      text, json:async()=>JSON.parse(await text())});
  };
  delete globalThis.__host;
})();
