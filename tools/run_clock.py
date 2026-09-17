#!/usr/bin/env python3
"""Development launcher: recover the graphical session environment, then exec."""
import os
from pathlib import Path
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
env=os.environ.copy()
# Some remote/agent shells have WAYLAND_DISPLAY but omit DISPLAY/XAUTHORITY.
# Read only these two values; never evaluate systemd's environment as shell code.
if not env.get('DISPLAY'):
    try:
        result=subprocess.run(['systemctl','--user','show-environment'],capture_output=True,text=True,timeout=3)
        session=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        if session.get('DISPLAY'):
            env['DISPLAY']=session['DISPLAY']
            if session.get('XAUTHORITY'):env['XAUTHORITY']=session['XAUTHORITY']
    except (OSError,subprocess.TimeoutExpired):
        pass
if env.get('DISPLAY'):
    env.setdefault('GDK_BACKEND','x11')
    if '--qt' in sys.argv[1:]:env.setdefault('QT_QPA_PLATFORM','xcb')
os.chdir(root)
os.execve(root/'build/clock-app',[str(root/'build/clock-app'),*sys.argv[1:]],env)
