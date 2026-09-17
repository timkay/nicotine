// Same source, app-specific native controls on Win32, Cocoa, GTK, or Qt.
(() => {
  const args=nicotine.args;
  const backend=args.includes('--qt')?'qt':({windows:'win32',macos:'macos',linux:'gtk'})[nicotine.platform];
  const ext=nicotine.platform==='windows'?'dll':nicotine.platform==='macos'?'dylib':'so';
  const index=args.indexOf('--library');
  if(index>=0 && !args[index+1])throw new Error('--library requires a path');
  const ui=Native.library(index>=0?args[index+1]:`./build/clock-${backend}.${ext}`);
  const update=ui.nicotine_clock_update.as('void','str','str','str');
  const quit=ui.nicotine_clock_quit.as('void');
  let running=false,start=0,split=null,ticks=0,failed=null;
  const elapsed=()=>((performance.now()-start)/1000).toFixed(3)+' s';
  function action(code) {
    if(code===1){if(running)split=elapsed();else {start=performance.now();running=true;}}
    if(code===2){running=false;split=null;}
  }
  function check(ok,message){if(!ok)throw new Error(message);}
  function tick(){
    // Never leave a native GUI loop running after a script error.
    try {
      Native.pump();ticks++;
      if(args.includes('--self-test')) {
        if(ticks===1){action(1);check(running,'start failed');}
        if(ticks===2){action(1);check(split!==null,'split failed');}
        if(ticks===3){action(2);check(!running && split===null,'reset failed');}
        if(ticks===5){console.log(`native clock ${backend} self-test passed`);quit();return;}
      }
      const now=new Date();
      update(now.toTimeString().split(' ')[0],now.toDateString(),
        running?`${elapsed()}${split===null?'':`  Split: ${split}`}`:'Ready');
    } catch(error){failed=error;quit();}
  }
  const status=ui.nicotine_clock_run.as('i32','ptr','ptr')(
    Native.callback('void',['i32'],action),Native.callback('void',[],tick));
  if(failed)throw failed;
  if(status)throw new Error(`Cannot start ${backend} GUI (${status})`);
})();
