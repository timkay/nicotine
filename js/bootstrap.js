// Nicotine ABI 0.1. No toolkit-specific behavior belongs in this file.
(() => {
  const h = globalThis.__host;
  const marker = Symbol('native argument');
  const valid = new Set(['void', 'i32', 'u32', 'i64', 'u64', 'ptr', 'str', 'f32', 'f64']);
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
  function library(path) {
    const handle = h.open(path);
    const symbols = Object.create(null);
    return new Proxy(symbols, {get(target,name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (Object.hasOwn(target,name)) return target[name];
      const address = h.symbol(handle,name);
      const bindings = new Map();
      function withResult(result) {
        return (...args) => {
          const converted = args.map(infer);
          const types = converted.map(x=>x[0]);
          const key = result+':'+types.join(',');
          if (!bindings.has(key)) bindings.set(key,h.bind(address,result,types));
          return bindings.get(key)(...converted.map(x=>x[1]));
        };
      }
      const fn = withResult('i32');
      fn.returns = result => {
        if (!valid.has(result)) throw new TypeError('Unknown native return type');
        return withResult(result);
      };
      fn.as = (result,...types) => h.bind(address,result,types);
      target[name] = fn;
      return fn;
    }});
  }
  globalThis.Native = Object.freeze({
    library, callback:h.callback, isNull:p=>p === null || h.isNull(p),
    buffer:n=>new ArrayBuffer(n), ref:b=>typed('ptr',b),
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
