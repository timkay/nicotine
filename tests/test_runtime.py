#!/usr/bin/env python3
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT=Path(__file__).resolve().parents[1]
RUNTIME=ROOT/'build/nicotine'
PACKAGE=ROOT/'tools/package.py'

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=b'{"answer":42}'
        self.send_response(404 if self.path=='/missing' else 200)
        self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
    def log_message(self,*args):pass

class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.directory=Path(cls.temp.name)
        cls.fixture=cls.directory/'fixture.so'
        subprocess.run(['cc','-shared','-fPIC',str(ROOT/'tests/native_fixture.c'),'-o',str(cls.fixture)],check=True)
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.temp.cleanup()
    def script(self,code,ok=True):
        source=self.directory/'test.js';source.write_text(code)
        p=subprocess.run([str(RUNTIME),str(source)],text=True,capture_output=True,timeout=10)
        if ok:self.assertEqual(p.returncode,0,p.stderr)
        else:self.assertNotEqual(p.returncode,0,p.stdout)
        return p
    def test_core_and_monotonic(self):
        p=self.script("if(JSON.parse('{\"n\":42}').n!==42 || !/sensor/.test('sensor'))throw Error('core');"
                      "if(performance.now()>performance.now())throw Error('time');console.log(nicotine.platform)")
        self.assertEqual(p.stdout.strip(),'linux')
    def test_binding_types_buffers_and_cache(self):
        self.script(f"""const lib=Native.library({json.dumps(str(self.fixture))});
          if(lib.fixture_abi!==lib.fixture_abi || lib.fixture_abi()!==1)throw Error('cache');
          if(lib.echo_u64.as('u64','u64')(18446744073709551615n)!==18446744073709551615n)throw Error('u64');
          if(lib.add_double.returns('f64')(Native.f64(1.5),Native.f64(2.25))!==3.75)throw Error('double');
          const b=Native.buffer(4);lib.write_u32.as('void','ptr','u32')(b,0xffffffff);
          if(new DataView(b).getUint32(0,true)!==0xffffffff)throw Error('buffer');
        """)

    def test_type_namespace_and_library_search(self):
        self.script(f"""const all= native.search([{json.dumps(str(self.fixture))}]);
          if(all.fixture_abi()!==1)throw Error('searched default result');
          if(all.u64.echo_u64(18446744073709551615n)!==18446744073709551615n)throw Error('left type');
          if(native.search([{json.dumps(str(self.fixture))}]).u64.echo_u64(9n)!==9n)throw Error('repeat search');
        """)
    def test_method_installation_bypasses_missing_handler_and_inference(self):
        bootstrap=(ROOT/'js/bootstrap.js').read_text()
        self.script("""
          let resolutions=0, definitions=0, calls=0, inferences=0;
          const host={platform:'linux',args:[],pointerSize:8,
            open:()=>({}), symbol:()=>{resolutions++;return {};},
            isPointer:()=>{inferences++;return false;},
            bind:(address,result,types)=>{
              definitions++;
              if(result!=='i32' || types.join(',')!=='i32')throw Error('wrong signature');
              return value=>{calls++;return value+1;};
            }};
          globalThis.__host=host;
        """+bootstrap+"""
          const library=Native.library('fixture');
          const first=library.increment;
          if(resolutions || definitions)throw Error('resolved before first call');
          if(first(41)!==42)throw Error('first call');
          const installed=library.increment;
          if(first===installed || !Object.hasOwn(library,'increment'))throw Error('not installed');
          host.symbol=host.bind=host.isPointer=()=>{throw Error('slow path after installation');};
          Object.setPrototypeOf(library,new Proxy({}, {get(){throw Error('missing handler called');}}));
          if(library.increment(9)!==10 || first(2)!==3)throw Error('installed call');
          if(resolutions!==1 || definitions!==1 || calls!==3 || inferences!==1)throw Error('wrong counts');
        """)
    def test_structures_and_pointer_fields(self):
        self.script(f"""const lib=Native.library({json.dumps(str(self.fixture))});
          const Point=['f64','f64'];
          const point=new Float64Array([10,20]).buffer;
          const first=lib.offset_point;
          const shifted=lib.offset_point.returns(Point)(Native.struct(Point,point),Native.f64(2));
          if(first===lib.offset_point)throw Error('method not installed');
          if(new Float64Array(shifted).join(',')!=='12,18')throw Error('struct return');
          if(new Float64Array(lib.offset_point(point,3)).join(',')!=='13,17')throw Error('fixed signature');
          const rect=new Float64Array([1,2,3,4]).buffer;
          if(lib.rectangle_area.returns('f64')(Native.struct([Point,Point],rect))!==12)throw Error('nested');
          const callback=Native.callback(Point,[Point],buffer=>{{
            const values=new Float64Array(buffer);values[0]+=5;return buffer;
          }});
          const result=lib.call_point_callback.returns(Point)(callback,Native.struct(Point,point));
          if(new Float64Array(result).join(',')!=='15,20')throw Error('struct callback');
          const tagged=Native.buffer(16),view=new DataView(tagged);
          view.setUint8(0,7);view.setFloat64(8,1.25,true);
          const changed=new DataView(lib.update_tagged.returns(['u8','f64'])(Native.struct(['u8','f64'],tagged)));
          if(changed.getUint8(0)!==8 || changed.getFloat64(8,true)!==2.5)throw Error('struct alignment');
          if(lib.echo_i8.returns('i8')(Native.i8(-42))!==-42)throw Error('signed byte');
          if(lib.echo_u8.returns('u8')(Native.u8(255))!==255)throw Error('unsigned byte');
          const output=Native.buffer(4);
          lib.write_u32.returns('void')(Native.pointer(Native.address(output)),Native.u32(123));
          if(new DataView(output).getUint32(0,true)!==123)throw Error('pointer field');
          if(!Native.isNull(Native.pointer(0n)) || Native.address(null)!==0n)throw Error('null');
        """)
    def test_bad_structure_and_changed_hint(self):
        prefix=f"const lib=Native.library({json.dumps(str(self.fixture))});"
        p=self.script(prefix+"lib.offset_point(Native.struct(['f64','f64'],Native.buffer(8)),Native.f64(1));",False)
        self.assertIn('Structure buffer must match',p.stderr)
        self.script(prefix+"lib.fixture_abi.as(['void'])();",False)
        self.script(prefix+"const cycle=[];cycle.push(cycle);lib.fixture_abi.as(cycle)();",False)
        p=self.script(prefix+"lib.echo_u64.returns('u64')(Native.u64(1n));lib.echo_u64(Native.i64(2n));",False)
        self.assertIn('differs from installed signature',p.stderr)
    def test_callback(self):
        self.script(f"""const l=Native.library({json.dumps(str(self.fixture))});
        const cb=Native.callback('i32',['i32'],x=>x+7);
        if(l.call_callback(cb,35)!==42)throw Error('callback');""")
    def test_callback_error(self):
        p=self.script(f"""const l=Native.library({json.dumps(str(self.fixture))});
        l.call_callback(Native.callback('i32',['i32'],()=>{{throw Error('callback-test')}}),1);""",False)
        self.assertIn('callback-test',p.stderr)
    def test_missing_symbol(self):
        p=self.script(f"Native.library({json.dumps(str(self.fixture))}).no_such_symbol()",False)
        self.assertIn('Cannot resolve symbol',p.stderr)
    def test_bad_signature(self):
        self.script(f"Native.library({json.dumps(str(self.fixture))}).fixture_abi.as('unknown')()",False)
    def test_fetch(self):
        url=f'http://127.0.0.1:{self.server.server_port}'
        self.script(f"""(async()=>{{
          const r=await fetch('{url}');if(!r.ok || (await r.json()).answer!==42)throw Error('fetch');
          let consumed=false;try{{await r.text()}}catch(e){{consumed=true}}if(!consumed)throw Error('body reuse');
          const missing=await fetch('{url}/missing');if(missing.ok || missing.status!==404)throw Error('status');
        }})()""")
    def test_rejected_fetch(self):
        self.script("(async()=>{await fetch('file:///etc/hostname')})()",False)
    def test_unsupported_method(self):
        self.script("fetch('http://127.0.0.1',{method:'POST'})",False)
    def test_pack_extract_and_tamper(self):
        source=self.directory/'app.js';source.write_text("console.log('bundled '+nicotine.args.join(','))")
        out=self.directory/'packaged'
        subprocess.run([sys.executable,str(PACKAGE),'pack',str(RUNTIME),str(source),str(out)],check=True)
        p=subprocess.run([str(out),'hello'],text=True,capture_output=True,timeout=10,check=True)
        self.assertEqual(p.stdout.strip(),'bundled hello')
        dest=self.directory/'extracted'
        subprocess.run([sys.executable,str(PACKAGE),'extract',str(out),str(dest),'--trusted-runtime',str(RUNTIME)],check=True,capture_output=True)
        self.assertEqual((dest/'main.js').read_bytes(),source.read_bytes())
        data=bytearray(out.read_bytes());data[RUNTIME.stat().st_size]^=1;out.write_bytes(data)
        p=subprocess.run([sys.executable,str(PACKAGE),'inspect',str(out)],capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0);self.assertIn('Source hash mismatch',p.stderr)

if __name__=='__main__':unittest.main()
