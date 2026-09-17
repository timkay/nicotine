#!/usr/bin/env python3
"""Linux GUI examples: prefer installed SDKs, or explicitly use a local SDK tree."""
import argparse
from pathlib import Path
import shlex
import subprocess

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('backend',choices=['gtk','qt','qt-analog'])
parser.add_argument('--sysroot',type=Path,help='extracted native development headers; links installed system libraries')
args=parser.parse_args()
qt=args.backend.startswith('qt')
source={'gtk':'clock_gtk.c','qt':'clock_qt.cpp','qt-analog':'qt_adapter.cpp'}[args.backend]
output={'gtk':'clock-gtk.so','qt':'clock-qt.so','qt-analog':'libnicotine-qt.so'}[args.backend]
command=['c++','-std=c++17'] if qt else ['cc']
command+=['-Os','-fPIC','-shared',str(ROOT/'src'/source),'-o',str(ROOT/'build'/output)]
if args.sysroot:
    sdk=args.sysroot.resolve()
    if qt:
        base=sdk/'usr/include/x86_64-linux-gnu/qt6'
        command+=['-I'+str(base/s) for s in ['', 'QtWidgets','QtGui','QtCore']]
        command+=['-l:libQt6Widgets.so.6','-l:libQt6Gui.so.6','-l:libQt6Core.so.6']
    else:
        command+=['-I'+str(sdk/'usr/include'/s) for s in ['gtk-3.0','glib-2.0','pango-1.0','harfbuzz','cairo','gdk-pixbuf-2.0','atk-1.0']]
        command+=['-I'+str(sdk/'usr/lib/x86_64-linux-gnu/glib-2.0/include')]
        command+=['-l:libgtk-3.so.0','-l:libgobject-2.0.so.0','-l:libglib-2.0.so.0']
else:
    package='Qt6Widgets' if qt else 'gtk+-3.0'
    command+=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs',package],text=True))
subprocess.run(command,check=True)
subprocess.run(['strip',str(ROOT/'build'/output)],check=True)
