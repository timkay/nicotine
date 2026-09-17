// Native port of clock.timkay.com v0.7.15. App logic and drawing live in source.
// GTK: direct native calls. Qt: optional native image-surface adapter.
(() => {
  const A = nicotine.args;
  const test = A.includes('--self-test');
  const monotonic = () => performance.now();
  const state = {running:false,start:0,split:null,menu:false,overlay:'',notice:'',ticks:0,topmost:false};
  const days = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
  const months = 'January February March April May June July August September October November December'.split(' ');
  const elapsed = () => ((monotonic()-state.start)/1000).toFixed(3)+'s';
  function startOrSplit() {
    if(!state.running) {state.running=true;state.start=monotonic();state.split=null;}
    else state.split=elapsed();
  }
  function reset(){state.running=false;state.split=null;}
  function digital(d) {
    return `${String(d.getHours()%12||12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
  }
  const cairo = Native.library('libcairo.so.2');
  function bind(name,result,...args){return cairo[name].as(result,...args);}
  const C = {
    operator:bind('cairo_set_operator','void','ptr','i32'),clip:bind('cairo_clip','void','ptr'),
    save:bind('cairo_save','void','ptr'), restore:bind('cairo_restore','void','ptr'),
    translate:bind('cairo_translate','void','ptr','f64','f64'), scale:bind('cairo_scale','void','ptr','f64','f64'),
    color:bind('cairo_set_source_rgba','void','ptr','f64','f64','f64','f64'),
    arc:bind('cairo_arc','void','ptr','f64','f64','f64','f64','f64'),
    move:bind('cairo_move_to','void','ptr','f64','f64'), line:bind('cairo_line_to','void','ptr','f64','f64'),
    width:bind('cairo_set_line_width','void','ptr','f64'), cap:bind('cairo_set_line_cap','void','ptr','i32'),
    stroke:bind('cairo_stroke','void','ptr'),fill:bind('cairo_fill','void','ptr'),
    fillPreserve:bind('cairo_fill_preserve','void','ptr'),path:bind('cairo_new_path','void','ptr'),
    rect:bind('cairo_rectangle','void','ptr','f64','f64','f64','f64'), paint:bind('cairo_paint','void','ptr'),
    font:bind('cairo_select_font_face','void','ptr','str','i32','i32'),fontSize:bind('cairo_set_font_size','void','ptr','f64'),
    text:bind('cairo_show_text','void','ptr','str'),extent:bind('cairo_text_extents','void','ptr','str','ptr'),
    gradient:bind('cairo_pattern_create_radial','ptr','f64','f64','f64','f64','f64','f64'),
    stop:bind('cairo_pattern_add_color_stop_rgb','void','ptr','f64','f64','f64','f64'),
    source:bind('cairo_set_source','void','ptr','ptr'),patternFree:bind('cairo_pattern_destroy','void','ptr'),
    image:bind('cairo_image_surface_create','ptr','i32','i32','i32'),
    imageData:bind('cairo_image_surface_create_for_data','ptr','ptr','i32','i32','i32','i32'),
    context:bind('cairo_create','ptr','ptr'),destroy:bind('cairo_destroy','void','ptr'),
    surfaceFree:bind('cairo_surface_destroy','void','ptr'),flush:bind('cairo_surface_flush','void','ptr'),
    png:bind('cairo_surface_write_to_png','i32','ptr','str')
  };
  const extents=Native.buffer(48),extentsView=new DataView(extents);
  let width=360,height=360,quit=()=>{},requestDraw=()=>{},setTopmost=()=>{},observeGeometry=()=>{};
  function color(cr,hex,alpha=1) {
    const n=parseInt(hex.replace('#',''),16);C.color(cr,((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,alpha);
  }
  function circle(cr,x,y,r){C.path(cr);C.arc(cr,x,y,r,0,2*Math.PI);}
  function text(cr,s,x,y,size,hex='282318',bold=true,center=true) {
    C.font(cr,'sans-serif',0,bold?1:0);C.fontSize(cr,size);color(cr,hex);
    C.extent(cr,s,extents);
    const offset=center?extentsView.getFloat64(0,true)+extentsView.getFloat64(16,true)/2:0;
    C.move(cr,x-offset,y);C.text(cr,s);
  }
  function line(cr,x1,y1,x2,y2,w,hex,alpha=1) {
    C.path(cr);color(cr,hex,alpha);C.width(cr,w);C.move(cr,x1,y1);C.line(cr,x2,y2);C.stroke(cr);
  }
  function draw(cr,w,h) {
    width=w;height=h;const size=Math.min(w,h),scale=size/250;
    C.save(cr);C.operator(cr,0);C.paint(cr);C.operator(cr,2);
    C.translate(cr,(w-size)/2,(h-size)/2);C.scale(cr,scale,scale);C.cap(cr,1);
    circle(cr,125,125,123.5);C.clip(cr);
    const gradient=C.gradient(95,75,0,125,125,162.5);
    C.stop(gradient,0,1,244/255,163/255);C.stop(gradient,1,243/255,207/255,63/255);
    circle(cr,125,125,122);C.source(cr,gradient);C.fillPreserve(cr);C.patternFree(gradient);
    color(cr,'b9432d');C.width(cr,3);C.stroke(cr);
    for(let i=0;i<60;i++) {
      const a=i*Math.PI/30-Math.PI/2,major=i%5===0,outer=113,inner=outer-(major?8.75:3.5);
      line(cr,125+Math.cos(a)*inner,125+Math.sin(a)*inner,125+Math.cos(a)*outer,125+Math.sin(a)*outer,major?2:.875,'5b3e1a',major?.58:.24);
    }
    const d=A.includes('--fixed-time')?new Date(2026,8,17,10,9,30):new Date();
    for(const [fraction,length] of [[(d.getHours()+d.getMinutes()/60)/12,.375],[(d.getMinutes()+d.getSeconds()/60)/60,.75],[d.getSeconds()/60,.95]]) {
      const a=fraction*2*Math.PI-Math.PI/2;
      line(cr,125,125,125+125*length*Math.cos(a),125+125*length*Math.sin(a),4.2,'cc0000',.53);
    }
    text(cr,days[d.getDay()],125,55,20);
    text(cr,`${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,125,75,15.7,'282318',false);
    text(cr,digital(d),125,113,27.9);
    if(state.running) {
      text(cr,state.split||elapsed(),125,160,21.8);
      if(state.split)text(cr,elapsed(),125,179,14.6,'282318',false);
      line(cr,120,191,130,201,2,'7a3d27');line(cr,130,191,120,201,2,'7a3d27');
    }
    for(const x of [45,205]){circle(cr,x,45,11);color(cr,'ffffff',.8);C.fill(cr);}
    for(let y=41;y<=49;y+=4)line(cr,40,y,50,y,1.2,'3d3525');
    line(cr,201,41,209,49,1.3,'3d3525');line(cr,209,41,201,49,1.3,'3d3525');
    text(cr,'v0.7.15 · native',125,232,7,'6b6045',false);
    if(state.menu) {
      C.rect(cr,36,60,178,143);color(cr,'2c261c',.97);C.fill(cr);
      text(cr,'CLOCK',48,76,9,'aaaaaa',true,false);
      C.path(cr);C.rect(cr,48,86,10,10);color(cr,'ffffff');C.width(cr,1);C.stroke(cr);
      if(state.topmost){line(cr,50,91,53,94,1.5,'ffffff');line(cr,53,94,57,88,1.5,'ffffff');}
      text(cr,'Always on top',66,96,12,'ffffff',false,false);
      ['Test notification','Reload','About','Close'].forEach((s,i)=>text(cr,s,48,119+i*23,12,'ffffff',false,false));
    }
    if(state.overlay) {
      circle(cr,125,125,121);color(cr,'111111',.94);C.fill(cr);
      if(state.overlay==='about') {
        text(cr,'Clock',125,93,27,'ffffff');text(cr,'v0.7.15 · Nicotine',125,116,12,'aaaaaa',false);
        text(cr,'Analog clock & stopwatch',125,145,12,'ffffff',false);
        text(cr,'clock.timkay.com',125,166,12,'77aaff',false);
      } else {
        text(cr,state.overlay==='notify'?'Test notification':state.overlay==='topmost'?'Always on top':'Update available',125,112,20,'ffffff');
        text(cr,state.notice||'Click or press a key to dismiss',125,150,10,'aaaaaa',false);
      }
      text(cr,'Click to dismiss',125,196,10,'aaaaaa',false);
    }
    C.restore(cr);
  }
  function click(x,y) {
    const size=Math.min(width,height);x=(x-(width-size)/2)*250/size;y=(y-(height-size)/2)*250/size;
    if(state.overlay){state.overlay='';state.notice='';return;}
    if(Math.hypot(x-205,y-45)<=13){quit();return;}
    if(Math.hypot(x-45,y-45)<=13){state.menu=!state.menu;return;}
    if(state.menu) {
      if(x>=36 && x<=214 && y>=82 && y<197) {
        const item=Math.floor((y-82)/23);
        if(item===0){const next=!state.topmost;if(setTopmost(next)!==false)state.topmost=next;requestDraw();return;}
        if(item===1)state.overlay='notify';
        if(item===2){reset();requestDraw();}
        if(item===3)state.overlay='about';
        if(item===4)quit();
      }
      state.menu=false;
      return;
    }
    if(y>222){state.overlay='about';return;}
    if(state.running && x>108 && x<142 && y>183 && y<212){reset();return;}
    startOrSplit();
  }
  function key(code) {
    if(state.overlay){state.overlay='';state.notice='';return;}
    if(code===27){state.menu=false;return;}
    if(code===32 || code===13 || code===65293)startOrSplit();
    if(code===82 || code===114)reset();
    if(code===78 || code===110)state.overlay='notify';
  }
  function check(ok,message){if(!ok)throw new Error('Clock self-test: '+message);}
  function tick() {
    Native.pump();observeGeometry();state.ticks++;
    if(test) {
      if(state.ticks===1){key(32);check(state.running,'start');}
      if(state.ticks===2){key(32);check(state.split!==null,'split');}
      if(state.ticks===3){key(82);check(!state.running,'reset');}
      if(state.ticks===4){key(78);check(state.overlay==='notify','notification');key(27);}
      if(state.ticks===5){
        const before=state.topmost;state.menu=true;
        const size=Math.min(width,height);
        click((width-size)/2+100*size/250,(height-size)/2+92*size/250);
        check(state.topmost!==before && state.menu,'always on top checkbox');
      }
      if(state.ticks===6){console.log('clock self-test passed');quit();return 0;}
    }
    requestDraw();return 1;
  }
  const render=A.indexOf('--render');
  if(render!==-1) {
    if(!A[render+1])throw new Error('--render needs a PNG path');
    const surface=C.image(0,500,500),cr=C.context(surface);draw(cr,500,500);
    check(C.png(surface,A[render+1])===0,'PNG write');C.destroy(cr);C.surfaceFree(surface);return;
  }
  if(A.includes('--qt')) {
    const qi=A.indexOf('--qt-library');
    const qt=Native.library(qi>=0?A[qi+1]:'./build/libnicotine-qt.so');
    quit=qt.nicotine_qt_quit.as('void');
    state.topmost=!!qt.nicotine_qt_get_topmost();
    setTopmost=value=>qt.nicotine_qt_set_topmost.as('void','i32')(Number(value));
    const paint=Native.callback('void',['ptr','i32','i32','i32'],(data,w,h,stride)=>{
      const surface=C.imageData(data,0,w,h,stride),cr=C.context(surface);
      draw(cr,w,h);C.destroy(cr);C.flush(surface);C.surfaceFree(surface);
    });
    qt.nicotine_qt_run.as('i32','ptr','ptr','ptr','ptr')(paint,
      Native.callback('void',['f64','f64'],click),Native.callback('void',['i32'],key),Native.callback('void',[],tick));
  } else {
    const gtk=Native.library('libgtk-3.so.0'),g=Native.library('libgobject-2.0.so.0'),glib=Native.library('libglib-2.0.so.0');
    const gdk=Native.library('libgdk-3.so.0');
    // GNOME's native Wayland backend cannot honor keep-above/position hints.
    // Prefer X11 (including XWayland) when the session offers it.
    gdk.gdk_set_allowed_backends.as('void','str')('x11,wayland');
    if(!gtk.gtk_init_check(null,null))throw new Error('No GTK display. Use a desktop session or --render file.png.');
    const window=gtk.gtk_window_new.returns('ptr')(0),area=gtk.gtk_drawing_area_new.returns('ptr')();
    gtk.gtk_window_set_title(window,'Clock — Nicotine / GTK');gtk.gtk_window_set_default_size(window,360,360);
    gtk.gtk_window_set_decorated(window,0);
    // GdkGeometry: eight ints, two doubles, then a gravity enum.
    const geometry=Native.buffer(56),geometryView=new DataView(geometry);
    geometryView.setInt32(0,180,true);geometryView.setInt32(4,180,true);
    geometryView.setFloat64(32,1,true);geometryView.setFloat64(40,1,true);
    gtk.gtk_window_set_geometry_hints.as('void','ptr','ptr','ptr','i32')(window,null,geometry,2|16);
    gtk.gtk_widget_set_app_paintable(window,1);
    const screen=gtk.gtk_widget_get_screen.returns('ptr')(window);
    const visual=gdk.gdk_screen_get_rgba_visual.returns('ptr')(screen);
    if(!Native.isNull(visual))gtk.gtk_widget_set_visual(window,visual);
    gtk.gtk_container_add(window,area);gtk.gtk_widget_add_events(area,256|512|4);
    const connect=g.g_signal_connect_data.as('u64','ptr','str','ptr','ptr','ptr','i32');
    const widgetWidth=gtk.gtk_widget_get_allocated_width.as('i32','ptr'),widgetHeight=gtk.gtk_widget_get_allocated_height.as('i32','ptr');
    // Per-user state stays outside the executable/source package.
    const activeDisplay=gtk.gtk_widget_get_display.returns('ptr')(window);
    const canKeepAbove=!!g.g_type_check_instance_is_a.as('i32','ptr','u64')(activeDisplay,gdk.gdk_x11_display_get_type.as('u64')());
    const settingsDir=glib.g_get_user_config_dir.as('str')()+'/nicotine';
    const settingsPath=settingsDir+'/clock-gtk.ini';
    const settings=glib.g_key_file_new.returns('ptr')();
    const getSetting=name=>glib.g_key_file_get_integer(settings,'window',name,null);
    let saved=null,saveTimer=0,warned=false;
    setTopmost=value=>{
      if(value && !canKeepAbove){state.overlay='topmost';state.notice='Launch with ./run-clock to enable';return false;}
      gtk.gtk_window_set_keep_above.as('void','ptr','i32')(window,Number(value));
      glib.g_key_file_set_integer.as('void','ptr','str','str','i32')(settings,'window','always_on_top',Number(value));
      saveGeometry();
    };
    if(glib.g_key_file_load_from_file(settings,settingsPath,0,null)) {
      state.topmost=canKeepAbove && getSetting('always_on_top')===1;
      gtk.gtk_window_set_keep_above.as('void','ptr','i32')(window,Number(state.topmost));
      const w=getSetting('width'),h=getSetting('height');
      if(w>=180 && h>=180 && w<=8192 && h<=8192) {
        let x=getSetting('x'),y=getSetting('y'),rw=w,rh=h;
        const d=gtk.gtk_widget_get_display.returns('ptr')(window);
        const monitor=gdk.gdk_display_get_monitor_at_point.returns('ptr')(d,x,y);
        if(!Native.isNull(monitor)) {
          const rect=Native.buffer(16),v=new DataView(rect);
          gdk.gdk_monitor_get_workarea.as('void','ptr','ptr')(monitor,rect);
          const mx=v.getInt32(0,true),my=v.getInt32(4,true),mw=v.getInt32(8,true),mh=v.getInt32(12,true);
          if(mw>0 && mh>0) {
            rw=Math.max(180,Math.min(w,mw));rh=Math.max(180,Math.min(h,mh));
            x=Math.max(mx,Math.min(x,mx+mw-rw));y=Math.max(my,Math.min(y,my+mh-rh));
          }
        }
        gtk.gtk_window_set_default_size(window,rw,rh);gtk.gtk_window_move(window,x,y);
      }
    }
    function saveGeometry() {
      if(!saved && !state.topmost)return;
      if(glib.g_mkdir_with_parents(settingsDir,448)!==0 || !glib.g_key_file_save_to_file(settings,settingsPath,null)) {
        if(!warned){console.error('Cannot save clock geometry:',settingsPath);warned=true;}
      }
    }
    const persist=Native.callback('i32',['ptr'],()=>{saveTimer=0;saveGeometry();return 0;});
    const posX=Native.buffer(4),posY=Native.buffer(4),sizeW=Native.buffer(4),sizeH=Native.buffer(4);
    observeGeometry=()=>{
      gtk.gtk_window_get_position.as('void','ptr','ptr','ptr')(window,posX,posY);
      gtk.gtk_window_get_size.as('void','ptr','ptr','ptr')(window,sizeW,sizeH);
      const values=[posX,posY,sizeW,sizeH].map(b=>new DataView(b).getInt32(0,true));
      if(values[2]<180 || values[3]<180)return 0;
      if(saved && values.every((v,i)=>v===saved[i]))return 0;
      saved=values;
      ['x','y','width','height'].forEach((key,i)=>glib.g_key_file_set_integer.as('void','ptr','str','str','i32')(settings,'window',key,values[i]));
      if(saveTimer)glib.g_source_remove(saveTimer);
      saveTimer=glib.g_timeout_add(250,persist,null);
      return 0;
    };
    connect(window,'configure-event',Native.callback('i32',['ptr','ptr','ptr'],observeGeometry),null,null,0);
    const mainQuit=gtk.gtk_main_quit.as('void');
    quit=()=>{saveGeometry();mainQuit();};requestDraw=()=>gtk.gtk_widget_queue_draw(area);
    connect(window,'destroy',Native.callback('void',['ptr','ptr'],quit),null,null,0);
    const regionCreate=cairo.cairo_region_create.as('ptr');
    const regionUnion=cairo.cairo_region_union_rectangle.as('i32','ptr','ptr');
    const regionFree=cairo.cairo_region_destroy.as('void','ptr');
    let shapedWidth=0,shapedHeight=0;
    function shape(w,h) {
      if(w===shapedWidth && h===shapedHeight)return;
      const region=regionCreate(),rectangle=Native.buffer(16),v=new DataView(rectangle);
      const radius=Math.min(w,h)*123.5/250;
      for(let y=0;y<h;y++) {
        const dy=y+.5-h/2;
        if(Math.abs(dy)>=radius)continue;
        const dx=Math.sqrt(radius*radius-dy*dy),left=Math.floor(w/2-dx),right=Math.ceil(w/2+dx);
        v.setInt32(0,left,true);v.setInt32(4,y,true);v.setInt32(8,right-left,true);v.setInt32(12,1,true);
        regionUnion(region,rectangle);
      }
      gtk.gtk_widget_shape_combine_region(window,region);
      gtk.gtk_widget_input_shape_combine_region(window,region);
      regionFree(region);shapedWidth=w;shapedHeight=h;
    }
    connect(area,'draw',Native.callback('i32',['ptr','ptr','ptr'],(_,cr)=>{
      const w=widgetWidth(area),h=widgetHeight(area);shape(w,h);draw(cr,w,h);return 0;
    }),null,null,0);
    const keyval=Native.buffer(4),kv=new DataView(keyval);
    const button=Native.buffer(4),buttonView=new DataView(button);
    const eventTime=gdk.gdk_event_get_time.as('u32','ptr');
    const beginMove=gtk.gtk_window_begin_move_drag.as('void','ptr','i32','i32','i32','u32');
    const beginResize=gtk.gtk_window_begin_resize_drag.as('void','ptr','i32','i32','i32','i32','u32');
    function rimEdge(point) {
      const w=widgetWidth(area),h=widgetHeight(area),dx=point.x-w/2,dy=point.y-h/2;
      const radius=Math.min(w,h)*123.5/250;
      if(Math.hypot(dx,dy)<radius-8)return -1;
      const sector=(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8;
      return [4,7,6,5,3,0,1,2][sector];
    }
    const display=gtk.gtk_widget_get_display.returns('ptr')(window);
    const cursorNames=['nw-resize','n-resize','ne-resize','w-resize','e-resize','sw-resize','s-resize','se-resize'];
    const cursors=cursorNames.map(name=>gdk.gdk_cursor_new_from_name.returns('ptr')(display,name));
    let cursorEdge=-2;
    function showCursor(edge) {
      if(edge===cursorEdge)return;
      const surface=gtk.gtk_widget_get_window.returns('ptr')(area);
      if(!Native.isNull(surface))gdk.gdk_window_set_cursor(surface,edge<0?null:cursors[edge]);
      cursorEdge=edge;
    }
    function eventPoint(event,root=false) {
      const xb=Native.buffer(8),yb=Native.buffer(8);
      const get=root?gdk.gdk_event_get_root_coords:gdk.gdk_event_get_coords;
      if(!get(event,xb,yb))return null;
      return {x:new DataView(xb).getFloat64(0,true),y:new DataView(yb).getFloat64(0,true)};
    }
    let pressed=null;
    connect(area,'button-press-event',Native.callback('i32',['ptr','ptr','ptr'],(_,event)=>{
      if(!gdk.gdk_event_get_button(event,button) || buttonView.getUint32(0,true)!==1)return 0;
      const point=eventPoint(event),root=eventPoint(event,true);
      if(point && root) {
        const edge=rimEdge(point);
        if(edge>=0) {
          pressed=null;
          beginResize(window,edge,1,Math.round(root.x),Math.round(root.y),eventTime(event));
          return 1;
        }
      }
      pressed=point && root?{point,root,time:eventTime(event)}:null;
      return 1;
    }),null,null,0);
    connect(area,'motion-notify-event',Native.callback('i32',['ptr','ptr','ptr'],(_,event)=>{
      const point=eventPoint(event);
      if(point)showCursor(rimEdge(point));
      if(!pressed)return 0;
      const root=eventPoint(event,true);
      if(root && Math.hypot(root.x-pressed.root.x,root.y-pressed.root.y)>=5) {
        const start=pressed;pressed=null;
        beginMove(window,1,Math.round(start.root.x),Math.round(start.root.y),start.time);
      }
      return 1;
    }),null,null,0);
    connect(area,'button-release-event',Native.callback('i32',['ptr','ptr','ptr'],(_,event)=>{
      if(!gdk.gdk_event_get_button(event,button) || buttonView.getUint32(0,true)!==1)return 0;
      const start=pressed;pressed=null;
      const root=eventPoint(event,true);
      if(start && root && Math.hypot(root.x-start.root.x,root.y-start.root.y)<5) {
        click(start.point.x,start.point.y);requestDraw();
      }
      return 1;
    }),null,null,0);
    connect(window,'key-press-event',Native.callback('i32',['ptr','ptr','ptr'],(_,event)=>{
      if(gdk.gdk_event_get_keyval(event,keyval))key(kv.getUint32(0,true));requestDraw();return 1;
    }),null,null,0);
    const timer=glib.g_timeout_add(33,Native.callback('i32',['ptr'],tick),null);
    gtk.gtk_widget_show_all(window);gtk.gtk_main();
    if(!test)glib.g_source_remove(timer);
    if(saveTimer)glib.g_source_remove(saveTimer);
    saveGeometry();glib.g_key_file_free.as('void','ptr')(settings);
    for(const cursor of cursors)if(!Native.isNull(cursor))g.g_object_unref(cursor);
  }
})();
