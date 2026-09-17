#!/usr/bin/env python3
"""Inspect/extract without executing the package. Hashes prove integrity, not trust."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

FOOTER = struct.Struct('<QQ8s')
MAGIC = b'NICOPK01'
LIMIT = 16 * 1024 * 1024

def digest(data): return hashlib.sha256(data).hexdigest()

def unpack(path):
    data = Path(path).read_bytes()
    if len(data) < FOOTER.size: raise ValueError('Missing footer')
    ns,nm,magic = FOOTER.unpack(data[-FOOTER.size:])
    if magic != MAGIC or ns > LIMIT or nm > LIMIT or ns+nm+FOOTER.size >= len(data):
        raise ValueError('Invalid package footer')
    boundary = len(data)-FOOTER.size-nm-ns
    runtime,source = data[:boundary],data[boundary:boundary+ns]
    manifest = json.loads(data[boundary+ns:-FOOTER.size])
    if manifest.get('format') != 1 or manifest.get('abi') != '0.1': raise ValueError('Unsupported ABI')
    if manifest.get('runtime_sha256') != digest(runtime): raise ValueError('Runtime hash mismatch')
    if manifest.get('source_sha256') != digest(source): raise ValueError('Source hash mismatch')
    source.decode('utf-8')
    return runtime,source,manifest

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('pack');p.add_argument('runtime');p.add_argument('source');p.add_argument('output')
    p=sub.add_parser('inspect');p.add_argument('package');p.add_argument('--trusted-runtime')
    p=sub.add_parser('extract');p.add_argument('package');p.add_argument('directory');p.add_argument('--trusted-runtime')
    args=parser.parse_args()
    if args.command=='pack':
        runtime=Path(args.runtime).read_bytes();source=Path(args.source).read_bytes();source.decode('utf-8')
        if len(source)>LIMIT: raise ValueError('Source too large')
        manifest=dict(format=1,abi='0.1',entry='main.js',runtime_sha256=digest(runtime),source_sha256=digest(source))
        metadata=json.dumps(manifest,sort_keys=True,indent=2).encode()
        out=Path(args.output)
        with out.open('xb') as f:f.write(runtime+source+metadata+FOOTER.pack(len(source),len(metadata),MAGIC))
        out.chmod(0o755)
    else:
        runtime,source,manifest=unpack(args.package)
        trusted=getattr(args,'trusted_runtime',None)
        if trusted and runtime!=Path(trusted).read_bytes():raise ValueError('Runtime differs from trusted executable')
        print(json.dumps({**manifest,'runtime_bytes':len(runtime),'source_bytes':len(source),
                          'trusted_runtime_matched':bool(trusted)},indent=2))
        if args.command=='extract':
            dest=Path(args.directory);dest.mkdir(parents=True,exist_ok=False)
            (dest/'main.js').write_bytes(source)
            (dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__': main()
