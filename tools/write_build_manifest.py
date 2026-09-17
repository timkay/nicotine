#!/usr/bin/env python3
"""Record the checked-in Linux binaries and the source tree that accompanies them."""
import hashlib
import json
import platform
from pathlib import Path
import re
import subprocess
import package

root=Path(__file__).resolve().parents[1]
names=['nicotine','clock-app','clock-gtk.so','clock-qt.so','libnicotine-qt.so']
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
runtime,source,_=package.unpack(root/'build/clock-app')
assert runtime==(root/'build/nicotine').read_bytes(),'Bundled runtime is stale'
assert source==(root/'examples/clock.js').read_bytes(),'Bundled clock source is stale'
artifacts={}
for name in names:
    path=root/'build'/name
    dynamic=subprocess.check_output(['readelf','-d',str(path)],text=True)
    versions=subprocess.check_output(['readelf','--version-info',str(path)],text=True)
    artifacts[name]={'bytes':path.stat().st_size,'sha256':sha(path),
                     'needed':re.findall(r'Shared library: \[(.*?)\]',dynamic),
                     'glibc_versions':sorted(set(re.findall(r'GLIBC_[0-9.]+',versions)))}
sources={}
for folder in ['src','js','examples','tools','tests','vendor/quickjs']:
    for path in sorted((root/folder).rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            sources[str(path.relative_to(root))]=sha(path)
for name in ['Makefile','CMakeLists.txt','run-clock']:sources[name]=sha(root/name)
info={'format':1,'platform':platform.system(),'architecture':platform.machine(),
      'libc':platform.libc_ver(),
      'compiler':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],
      'quickjs':(root/'vendor/quickjs/VERSION').read_text().strip(),
      'artifacts':artifacts,'source_sha256':sources,
      'notes':['Binaries depend on the listed system shared libraries; these dependencies are not bundled.',
               'Source hashes identify this snapshot, not a guarantee of byte-for-byte reproducible builds.',
               'Windows and macOS ports are source-only and have not been validated on those platforms.']}
(root/'build/BUILDINFO.json').write_text(json.dumps(info,indent=2)+'\n')
(root/'build/SHA256SUMS').write_text(''.join(f'{sha(root/"build"/name)}  {name}\n' for name in [*names,'BUILDINFO.json']))
print('Verified source package and wrote build/BUILDINFO.json and build/SHA256SUMS')
