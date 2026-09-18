#!/usr/bin/env python3
"""Linux integration tests with an isolated X display; no user desktop input."""
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import configparser
import ctypes as C
import time

ROOT=Path(__file__).resolve().parents[1]
xvfb=shutil.which('Xvfb') or str(ROOT/'build/sysroot/usr/bin/Xvfb')
read_fd,write_fd=os.pipe()
server=subprocess.Popen([xvfb,'-displayfd',str(write_fd),'-screen','0','800x600x24','-nolisten','tcp'],
                        pass_fds=(write_fd,),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
os.close(write_fd)
settings=tempfile.TemporaryDirectory()
try:
    if not select.select([read_fd],[],[],10)[0]:raise RuntimeError('Xvfb did not initialize')
    display=os.read(read_fd,32).decode().strip()
    if not display:raise RuntimeError('Xvfb failed: '+server.stderr.read().decode())
    env={**os.environ,'DISPLAY':':'+display,'GDK_BACKEND':'x11','QT_QPA_PLATFORM':'offscreen','XDG_CONFIG_HOME':settings.name}
    for app,options in [('clock.js',[]),('clock.js',['--qt']),('native_clock.js',[])]:
        p=subprocess.run([str(ROOT/'build/nicotine'),'examples/'+app,'--self-test',*options],
                         cwd=ROOT,env=env,capture_output=True,text=True,timeout=10,check=True)
        assert 'self-test passed' in p.stdout,p.stdout
        print(app,' '.join(options),p.stdout.strip())
    config=Path(settings.name)/'nicotine'
    ini=configparser.ConfigParser();ini.read(config/'clock-gtk.ini')
    assert ini.getint('window','always_on_top')==1
    assert 180<=ini.getint('window','width')<=800
    assert (config/'clock-qt.ini').is_file()
    # A second invocation must restore the checkbox and toggle it OFF.
    for options,name in [([], 'clock-gtk.ini'),(['--qt'],'clock-qt.ini')]:
        subprocess.run([str(ROOT/'build/nicotine'),'examples/clock.js','--self-test',*options],
                       cwd=ROOT,env=env,capture_output=True,text=True,timeout=10,check=True)
        ini=configparser.ConfigParser();ini.read(config/name)
        assert ini.get('window','always_on_top') in ('0','false'),dict(ini['window'])

    # Exercise the real GTK window through X11, wait for debounced persistence,
    # and verify the next process restores its actual geometry.
    x=C.CDLL('libX11.so.6');display_type=C.c_void_p;window_type=C.c_ulong
    x.XOpenDisplay.argtypes=[C.c_char_p];x.XOpenDisplay.restype=display_type
    x.XDefaultRootWindow.argtypes=[display_type];x.XDefaultRootWindow.restype=window_type
    x.XQueryTree.argtypes=[display_type,window_type,C.POINTER(window_type),C.POINTER(window_type),C.POINTER(C.POINTER(window_type)),C.POINTER(C.c_uint)]
    x.XFetchName.argtypes=[display_type,window_type,C.POINTER(C.c_void_p)]
    x.XInternAtom.argtypes=[display_type,C.c_char_p,C.c_int];x.XInternAtom.restype=window_type
    x.XGetWindowProperty.argtypes=[display_type,window_type,window_type,C.c_long,C.c_long,C.c_int,window_type,C.POINTER(window_type),C.POINTER(C.c_int),C.POINTER(C.c_ulong),C.POINTER(C.c_ulong),C.POINTER(C.c_void_p)]
    x.XFree.argtypes=[C.c_void_p]
    x.XMoveResizeWindow.argtypes=[display_type,window_type,C.c_int,C.c_int,C.c_uint,C.c_uint]
    x.XSync.argtypes=[display_type,C.c_int]
    x.XGetGeometry.argtypes=[display_type,window_type,C.POINTER(window_type),C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint)]
    x.XCloseDisplay.argtypes=[display_type]
    connection=x.XOpenDisplay(env['DISPLAY'].encode());assert connection
    def clock_window():
        root=window_type();parent=window_type();children=C.POINTER(window_type)();count=C.c_uint()
        x.XQueryTree(connection,x.XDefaultRootWindow(connection),C.byref(root),C.byref(parent),C.byref(children),C.byref(count))
        found=None
        for i in range(count.value):
            name=C.c_void_p();actual=window_type();fmt=C.c_int();n=C.c_ulong();after=C.c_ulong()
            atom=x.XInternAtom(connection,b'_NET_WM_NAME',0)
            x.XGetWindowProperty(connection,children[i],atom,0,1024,0,0,C.byref(actual),C.byref(fmt),C.byref(n),C.byref(after),C.byref(name))
            if name.value:
                if b'Clock' in C.string_at(name,n.value):found=int(children[i])
                x.XFree(name)
        if children:x.XFree(children)
        return found
    def wait_for(predicate):
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            value=predicate()
            if value:return value
            time.sleep(.025)
        raise AssertionError('Timed out waiting for window/settings')
    def saved_geometry():
        ini=configparser.ConfigParser();ini.read(config/'clock-gtk.ini')
        return [ini.getint('window',key,fallback=-1) for key in ['x','y','width','height']]==[90,80,420,420]
    try:
        for iteration in range(2):
            process=subprocess.Popen([str(ROOT/'build/nicotine'),'examples/clock.js'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                window=wait_for(clock_window)
                if iteration==0:
                    x.XMoveResizeWindow(connection,window,90,80,420,420);x.XSync(connection,0)
                    wait_for(saved_geometry)
                else:
                    root=window_type();px=C.c_int();py=C.c_int();w=C.c_uint();h=C.c_uint();border=C.c_uint();depth=C.c_uint()
                    x.XGetGeometry(connection,window,C.byref(root),C.byref(px),C.byref(py),C.byref(w),C.byref(h),C.byref(border),C.byref(depth))
                    assert [px.value,py.value,w.value,h.value]==[90,80,420,420]
            finally:
                process.terminate();stdout,stderr=process.communicate(timeout=5)
                if stderr:print(stderr.decode(),flush=True)
                wait_for(lambda:clock_window() is None)
    finally:x.XCloseDisplay(connection)
    print('Geometry restore and always-on-top persistence passed')
finally:
    settings.cleanup()
    os.close(read_fd);server.terminate()
    try:server.communicate(timeout=5)
    except subprocess.TimeoutExpired:server.kill();server.communicate()
