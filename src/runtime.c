/* QuickJS + libffi host. GUI modules remain outside the runtime. */
#include "quickjs.h"
#include "bootstrap.h"
#include "platform.h"
#include <ffi.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_ARGS 32
#define MAX_SOURCE (16u * 1024u * 1024u)
#define MAX_STRUCT_BYTES 256
#define MAX_STRUCT_NODES 64
typedef enum { VOID, I32, U32, I64, U64, PTR, STR, F32, F64, I8, U8, STRUCT } Type;
typedef struct StructType {
    ffi_type type;
    ffi_type *fields[MAX_ARGS + 1];
    struct StructType *next;
} StructType;
typedef union { int8_t i8; unsigned char structure[MAX_STRUCT_BYTES]; uint8_t u8; int32_t i32; uint32_t u32; int64_t i64; uint64_t u64; void *ptr; float f32; double f64; ffi_arg word; } Slot;
typedef struct Binding {
    ffi_cif cif; ffi_type *types[MAX_ARGS]; Type args[MAX_ARGS], result;
    StructType *structures; unsigned structure_count;
    unsigned count; void *address; struct Binding *next;
} Binding;
typedef struct Callback {
    Binding binding; ffi_closure *closure; void *code; JSValue fn;
    struct Callback *next;
} Callback;
typedef struct Library { void *handle; struct Library *next; } Library;
typedef struct Request {
    NThread thread; _Atomic int done; char *url; NResponse response; JSValue resolve, reject; struct Request *next;
} Request;
static JSClassID pointer_class;
static JSContext *context;
static NThreadId owner;
static Binding *bindings;
static Callback *callbacks;
static Library *libraries;
static Request *requests;
static JSValue callback_error;
static _Atomic int foreign_callback;

static JSValue pointer(JSContext *ctx, void *p) {
    if (!p) return JS_NULL;
    JSValue obj = JS_NewObjectClass(ctx,pointer_class);
    if (!JS_IsException(obj)) JS_SetOpaque(obj,p);
    return obj;
}
static Type parse_type(JSContext *ctx, JSValueConst v) {
    if (JS_IsArray(ctx,v)) return STRUCT;
    const char *s = JS_ToCString(ctx,v);
    static const char *names[] = {"void","i32","u32","i64","u64","ptr","str","f32","f64","i8","u8"};
    int found = -1;
    if (s) { for (int i=0;i<11;i++) if (!strcmp(names[i],s)) found=i; JS_FreeCString(ctx,s); }
    return (Type)found;
}
static ffi_type *ffi_for(Type type) {
    switch(type) {
      case VOID:return &ffi_type_void; case I32:return &ffi_type_sint32;
      case U32:return &ffi_type_uint32; case I64:return &ffi_type_sint64;
      case U64:return &ffi_type_uint64; case PTR:case STR:return &ffi_type_pointer;
      case I8:return &ffi_type_sint8; case U8:return &ffi_type_uint8;
      case F32:return &ffi_type_float; case F64:return &ffi_type_double;
      default:return NULL;
    }
}
static void free_structures(Binding *binding) {
    while (binding->structures) {
        StructType *node = binding->structures;
        binding->structures = node->next;
        free(node);
    }
}
/* libffi owns ABI layout decisions; descriptors contain fields, never offsets.
 * Bound depth/node/byte counts also reject cyclic or pathological descriptors. */
static ffi_type *descriptor(JSContext *ctx, Binding *binding, JSValueConst value, unsigned depth) {
    Type type = parse_type(ctx,value);
    if (type != STRUCT) return ffi_for(type);
    if (depth >= 8 || binding->structure_count >= MAX_STRUCT_NODES) return NULL;
    JSValue length = JS_GetPropertyStr(ctx,value,"length");
    uint32_t count;
    int rc = JS_ToUint32(ctx,&count,length);
    JS_FreeValue(ctx,length);
    if (rc || !count || count > MAX_ARGS) return NULL;
    StructType *node = calloc(1,sizeof(*node));
    if (!node) return NULL;
    node->next = binding->structures;
    binding->structures = node;
    binding->structure_count++;
    node->type.type = FFI_TYPE_STRUCT;
    node->type.elements = node->fields;
    for (unsigned i=0;i<count;i++) {
        JSValue field = JS_GetPropertyUint32(ctx,value,i);
        Type field_type = parse_type(ctx,field);
        node->fields[i] = descriptor(ctx,binding,field,depth+1);
        JS_FreeValue(ctx,field);
        if (!node->fields[i] || field_type == VOID || field_type == STR) return NULL;
    }
    if (ffi_get_struct_offsets(FFI_DEFAULT_ABI,&node->type,NULL) != FFI_OK ||
        node->type.size > MAX_STRUCT_BYTES) return NULL;
    return &node->type;
}
static int signature(JSContext *ctx, Binding *b, JSValueConst ret, JSValueConst types) {
    b->result = parse_type(ctx,ret);
    ffi_type *result = descriptor(ctx,b,ret,0);
    if (!result || !JS_IsArray(ctx,types)) goto bad;
    JSValue length=JS_GetPropertyStr(ctx,types,"length");
    uint32_t n; int rc=JS_ToUint32(ctx,&n,length); JS_FreeValue(ctx,length);
    if (rc || n>MAX_ARGS) goto bad;
    b->count=n;
    for (unsigned i=0;i<n;i++) {
        JSValue v=JS_GetPropertyUint32(ctx,types,i);
        b->args[i]=parse_type(ctx,v);
        b->types[i]=descriptor(ctx,b,v,0);
        JS_FreeValue(ctx,v);
        if (!b->types[i] || b->args[i]==VOID) goto bad;
    }
    if (ffi_prep_cif(&b->cif,FFI_DEFAULT_ABI,n,result,b->types)!=FFI_OK) goto bad;
    return 0;
bad:
    free_structures(b);
    JS_ThrowTypeError(ctx,"Invalid native signature (32 arguments, 256-byte structures, depth 8)");
    return -1;
}
static int to_slot(JSContext *ctx, Type type, ffi_type *layout, JSValueConst v, Slot *out, const char **string) {
    switch(type) {
      case VOID:return 0;
      case I8:case U8: {
        int32_t value;
        if (JS_ToInt32(ctx,&value,v)) return -1;
        out->u8=(uint8_t)value;
        return 0;
      }
      case STRUCT: {
        size_t size;
        uint8_t *bytes=JS_GetArrayBuffer(ctx,&size,v);
        if (!bytes) return -1;
        if (size != layout->size) {
            JS_ThrowTypeError(ctx,"Structure buffer must match native layout size (%zu)",layout->size);
            return -1;
        }
        memcpy(out->structure,bytes,size);
        return 0;
      }
      case I32:return JS_ToInt32(ctx,&out->i32,v);
      case U32:return JS_ToUint32(ctx,&out->u32,v);
      case I64:case U64:return JS_ToBigInt64(ctx,&out->i64,v);
      case F64:return JS_ToFloat64(ctx,&out->f64,v);
      case F32: { double d; if (JS_ToFloat64(ctx,&d,v)) return -1; out->f32=(float)d; return 0; }
      case STR:
        if (JS_IsNull(v)) { out->ptr=NULL; return 0; }
        *string=JS_ToCString(ctx,v); out->ptr=(void*)*string; return *string?0:-1;
      case PTR:
        if (JS_IsNull(v)) { out->ptr=NULL; return 0; }
        if ((out->ptr=JS_GetOpaque(v,pointer_class))) return 0;
        { size_t n; out->ptr=JS_GetArrayBuffer(ctx,&n,v); if (out->ptr) return 0; }
        return -1;
      default:return -1;
    }
}
static JSValue from_slot(JSContext *ctx, Type type, ffi_type *layout, const void *p) {
    switch(type) {
      case VOID:return JS_UNDEFINED;
      case I8:return JS_NewInt32(ctx,*(const int8_t*)p);
      case U8:return JS_NewUint32(ctx,*(const uint8_t*)p);
      case STRUCT:return JS_NewArrayBufferCopy(ctx,p,layout->size);
      case I32:return JS_NewInt32(ctx,*(const int32_t*)p);
      case U32:return JS_NewUint32(ctx,*(const uint32_t*)p);
      case I64:return JS_NewBigInt64(ctx,*(const int64_t*)p);
      case U64:return JS_NewBigUint64(ctx,*(const uint64_t*)p);
      case F32:return JS_NewFloat64(ctx,*(const float*)p);
      case F64:return JS_NewFloat64(ctx,*(const double*)p);
      case PTR:return pointer(ctx,*(void*const*)p);
      case STR:{ const char *s=*(char*const*)p; return s?JS_NewString(ctx,s):JS_NULL; }
      default:return JS_UNDEFINED;
    }
}
static JSValue invoke(JSContext *ctx, JSValueConst self,int argc,JSValueConst *argv,int magic,JSValue *data) {
    Binding *b=JS_GetOpaque(data[0],pointer_class);
    if (!b || argc!=(int)b->count) return JS_ThrowTypeError(ctx,"Native argument count mismatch");
    Slot slots[MAX_ARGS]={{0}}, result={0}; void *values[MAX_ARGS]; const char *strings[MAX_ARGS]={0};
    int failed=0;
    for(unsigned i=0;i<b->count;i++) {
        values[i]=&slots[i];
        if(to_slot(ctx,b->args[i],b->types[i],argv[i],&slots[i],&strings[i])) { failed=1; break; }
    }
    if(!failed) ffi_call(&b->cif,FFI_FN(b->address),&result,values);
    for(unsigned i=0;i<b->count;i++) if(strings[i]) JS_FreeCString(ctx,strings[i]);
    if(failed) return JS_EXCEPTION;
    if(!JS_IsUndefined(callback_error)) { JSValue e=callback_error;callback_error=JS_UNDEFINED;return JS_Throw(ctx,e); }
    if(atomic_exchange(&foreign_callback,0)) return JS_ThrowInternalError(ctx,"Native callback arrived on a foreign thread");
    return from_slot(ctx,b->result,b->cif.rtype,&result);
}
static JSValue host_open(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    if(argc!=1) return JS_ThrowTypeError(ctx,"library(path) requires a path");
    const char *path=JS_ToCString(ctx,argv[0]); if(!path) return JS_EXCEPTION;
    void *handle=n_library_open(path); JS_FreeCString(ctx,path);
    if(!handle) return JS_ThrowReferenceError(ctx,"Cannot load library: %s",n_library_error());
    Library *l=calloc(1,sizeof(*l)); if(!l) { n_library_close(handle);return JS_ThrowOutOfMemory(ctx); }
    l->handle=handle;l->next=libraries;libraries=l; return pointer(ctx,handle);
}
static JSValue host_symbol(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    if(argc!=2) return JS_ThrowTypeError(ctx,"symbol requires library and name");
    void *handle=JS_GetOpaque2(ctx,argv[0],pointer_class);if(!handle) return JS_EXCEPTION;
    const char *name=JS_ToCString(ctx,argv[1]);if(!name) return JS_EXCEPTION;
    void *address=n_library_symbol(handle,name);const char *error=address?NULL:n_library_error();
    JS_FreeCString(ctx,name);
    if(error) return JS_ThrowReferenceError(ctx,"Cannot resolve symbol: %s",error);
    return pointer(ctx,address);
}
static JSValue host_bind(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    if(argc!=3) return JS_ThrowTypeError(ctx,"bind requires address and signature");
    Binding *b=calloc(1,sizeof(*b)); if(!b) return JS_ThrowOutOfMemory(ctx);
    b->address=JS_GetOpaque2(ctx,argv[0],pointer_class);
    if(!b->address || signature(ctx,b,argv[1],argv[2])) { free(b);return JS_EXCEPTION; }
    b->next=bindings;bindings=b;
    JSValue data=pointer(ctx,b), fn=JS_NewCFunctionData(ctx,invoke,b->count,0,1,&data);
    JS_FreeValue(ctx,data);return fn;
}
static void dispatch_callback(ffi_cif *cif,void *result,void **args,void *opaque) {
    Callback *cb=opaque; Binding *b=&cb->binding;
    if(b->result!=VOID) memset(result,0,cif->rtype->size<sizeof(ffi_arg)?sizeof(ffi_arg):cif->rtype->size);
    if(!n_thread_equal(n_thread_self(),owner)) { atomic_store(&foreign_callback,1);return; }
    JSValue values[MAX_ARGS];
    for(unsigned i=0;i<b->count;i++) values[i]=from_slot(context,b->args[i],b->types[i],args[i]);
    JSValue value=JS_Call(context,cb->fn,JS_UNDEFINED,b->count,values);
    for(unsigned i=0;i<b->count;i++) JS_FreeValue(context,values[i]);
    if(!JS_IsException(value) && b->result!=VOID) {
        Slot slot={0};const char *s=NULL;
        if(to_slot(context,b->result,b->cif.rtype,value,&slot,&s)) { JS_FreeValue(context,value);value=JS_EXCEPTION; }
        else {
            if(b->result==I8) *(ffi_sarg*)result=slot.i8;
            else if(b->result==U8) *(ffi_arg*)result=slot.u8;
            else if(b->result==I32) *(ffi_sarg*)result=slot.i32;
            else if(b->result==U32) *(ffi_arg*)result=slot.u32;
            else memcpy(result,&slot,cif->rtype->size);
        }
    }
    if(JS_IsException(value)) {
        JSValue e=JS_GetException(context);
        if(JS_IsUndefined(callback_error)) callback_error=e; else JS_FreeValue(context,e);
    }
    JS_FreeValue(context,value);
}
static JSValue host_callback(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    if(argc!=3 || !JS_IsFunction(ctx,argv[2])) return JS_ThrowTypeError(ctx,"callback(result, types, function)");
    Callback *cb=calloc(1,sizeof(*cb)); if(!cb) return JS_ThrowOutOfMemory(ctx);
    if(signature(ctx,&cb->binding,argv[0],argv[1])) {free(cb);return JS_EXCEPTION;}
    if(cb->binding.result==STR) {free_structures(&cb->binding);free(cb);return JS_ThrowTypeError(ctx,"String callback results need explicit native storage");}
    cb->closure=ffi_closure_alloc(sizeof(ffi_closure),&cb->code);
    if(!cb->closure) {free_structures(&cb->binding);free(cb);return JS_ThrowOutOfMemory(ctx);}
    if(ffi_prep_closure_loc(cb->closure,&cb->binding.cif,dispatch_callback,cb,cb->code)!=FFI_OK) {
        ffi_closure_free(cb->closure);free_structures(&cb->binding);free(cb);return JS_ThrowInternalError(ctx,"Cannot create native callback");
    }
    cb->fn=JS_DupValue(ctx,argv[2]);cb->next=callbacks;callbacks=cb;return pointer(ctx,cb->code);
}
/* Addresses are explicit ABI values, not ownership transfers. The app must
 * keep backing buffers alive while native code retains their addresses. */
static JSValue host_address(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    Slot slot={0}; const char *unused=NULL;
    if (argc!=1) return JS_ThrowTypeError(ctx,"address requires a pointer or buffer");
    if (to_slot(ctx,PTR,&ffi_type_pointer,argv[0],&slot,&unused)) return JS_EXCEPTION;
    return JS_NewBigUint64(ctx,(uintptr_t)slot.ptr);
}
static JSValue host_pointer(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    int64_t address;
    if (argc!=1 || !JS_IsBigInt(ctx,argv[0])) return JS_ThrowTypeError(ctx,"pointer requires a BigInt address");
    if (JS_ToBigInt64(ctx,&address,argv[0])) return JS_EXCEPTION;
    if (sizeof(void*)<8 && (uint64_t)address>UINTPTR_MAX)
        return JS_ThrowRangeError(ctx,"Address exceeds native pointer width");
    return pointer(ctx,(void*)(uintptr_t)address);
}
static JSValue host_is_pointer(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    return JS_NewBool(ctx,argc && JS_GetOpaque(argv[0],pointer_class)!=NULL);
}
static JSValue host_is_null(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    return JS_NewBool(ctx,argc && JS_IsNull(argv[0]));
}
static JSValue host_print(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    for(int i=0;i<argc;i++) { const char *s=JS_ToCString(ctx,argv[i]);if(!s)return JS_EXCEPTION;
        if(i) fputc(' ',stdout);
        fputs(s,stdout);JS_FreeCString(ctx,s); }
    fputc('\n',stdout);fflush(stdout);return JS_UNDEFINED;
}
static void *fetch_worker(void *opaque) {
    Request *r=opaque;n_http_get(r->url,&r->response,MAX_SOURCE);
    atomic_store(&r->done,1);return NULL;
}
static JSValue host_now(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    return JS_NewFloat64(ctx,n_monotonic());
}
static JSValue host_fetch(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    if(argc!=1) return JS_ThrowTypeError(ctx,"fetch requires URL");
    const char *url=JS_ToCString(ctx,argv[0]);if(!url)return JS_EXCEPTION;
    Request *r=calloc(1,sizeof(*r));
    if(!r) {JS_FreeCString(ctx,url);return JS_ThrowOutOfMemory(ctx);}
    r->url=strdup(url);JS_FreeCString(ctx,url);
    if(!r->url) {free(r);return JS_ThrowOutOfMemory(ctx);}
    JSValue functions[2];JSValue promise=JS_NewPromiseCapability(ctx,functions);
    if(JS_IsException(promise)) {free(r->url);free(r);return promise;}
    r->resolve=functions[0];r->reject=functions[1];
    if(n_thread_start(&r->thread,fetch_worker,r)) {
        JS_FreeValue(ctx,promise);JS_FreeValue(ctx,r->resolve);JS_FreeValue(ctx,r->reject);
        free(r->url);free(r);return JS_ThrowInternalError(ctx,"Cannot start HTTP worker");
    }
    r->next=requests;requests=r;return promise;
}
static int pump(JSContext *ctx) {
    Request **link=&requests;
    while(*link) {
        Request *r=*link;
        if(!atomic_load(&r->done)) {link=&r->next;continue;}
        n_thread_join(r->thread);*link=r->next;
        JSValue value;
        if(r->response.error[0]) value=JS_NewString(ctx,r->response.error);
        else { value=JS_NewObject(ctx);
            JS_SetPropertyStr(ctx,value,"status",JS_NewInt32(ctx,r->response.status));
            JS_SetPropertyStr(ctx,value,"body",JS_NewStringLen(ctx,r->response.body?r->response.body:"",r->response.length)); }
        JSValue result=JS_Call(ctx,r->response.error[0]?r->reject:r->resolve,JS_UNDEFINED,1,&value);
        JS_FreeValue(ctx,value);JS_FreeValue(ctx,r->resolve);JS_FreeValue(ctx,r->reject);
        free(r->url);free(r->response.body);free(r);
        if(JS_IsException(result))return -1;
        JS_FreeValue(ctx,result);
    }
    JSContext *jobctx;int rc;
    while((rc=JS_ExecutePendingJob(JS_GetRuntime(ctx),&jobctx))>0) {}
    return rc;
}
static JSValue host_pump(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    return pump(ctx)<0?JS_EXCEPTION:JS_UNDEFINED;
}
static void report_error(JSContext *ctx,JSValueConst e) {
    const char *s=JS_ToCString(ctx,e);fprintf(stderr,"nicotine: %s\n",s?s:"exception");JS_FreeCString(ctx,s);
    JSValue stack=JS_GetPropertyStr(ctx,e,"stack");
    if(!JS_IsUndefined(stack)) {s=JS_ToCString(ctx,stack);if(s)fprintf(stderr,"%s\n",s);JS_FreeCString(ctx,s);}
    JS_FreeValue(ctx,stack);
}
static uint64_t little64(const unsigned char *p) {
    uint64_t v=0;for(int i=7;i>=0;i--)v=(v<<8)|p[i];return v;
}
static char *load_source(const char *path,int packaged,size_t *length) {
    FILE *f=fopen(path,"rb");if(!f)return NULL;
    if(fseek(f,0,SEEK_END)) {fclose(f);return NULL;}
    long end=ftell(f);uint64_t offset=0,n=end;
    if(end<0) {fclose(f);return NULL;}
    if(packaged) {
        unsigned char tail[24];
        if(end<24 || fseek(f,end-24,SEEK_SET) || fread(tail,1,24,f)!=24 || memcmp(tail+16,"NICOPK01",8)) {fclose(f);return NULL;}
        n=little64(tail);uint64_t manifest=little64(tail+8);
        if(n>MAX_SOURCE || manifest>MAX_SOURCE || n+manifest+24>(uint64_t)end) {fclose(f);return NULL;}
        offset=end-24-manifest-n;
    }
    if(n>MAX_SOURCE || fseek(f,offset,SEEK_SET)) {fclose(f);return NULL;}
    char *s=malloc(n+1);if(!s) {fclose(f);return NULL;}
    if(fread(s,1,n,f)!=n) {free(s);fclose(f);return NULL;}
    fclose(f);s[n]=0;*length=n;return s;
}
int main(int argc,char **argv) {
    if(argc==2 && !strcmp(argv[1],"--version")) {puts("nicotine ABI 0.1 / QuickJS 2026-06-04 / " N_PLATFORM);return 0;}
    size_t length;const char *filename="<bundled main.js>";
    char executable[32768];
    char *source=n_executable(executable,sizeof(executable))?NULL:load_source(executable,1,&length);int first_arg=1;
    if(!source && argc>1) {filename=argv[1];source=load_source(filename,0,&length);first_arg=2;}
    if(!source) {fprintf(stderr,"Usage: nicotine app.js [arguments]\nNo valid bundled application found.\n");return 2;}
    if(n_init()) {free(source);return 2;}
    owner=n_thread_self();JSRuntime *rt=JS_NewRuntime();context=rt?JS_NewContext(rt):NULL;
    if(!context) {free(source);if(rt)JS_FreeRuntime(rt);n_cleanup();return 2;}
    callback_error=JS_UNDEFINED;
    JS_NewClassID(&pointer_class);JSClassDef def={.class_name="NativePointer"};JS_NewClass(rt,pointer_class,&def);
    JSValue global=JS_GetGlobalObject(context),host=JS_NewObject(context),args=JS_NewArray(context);
    for(int i=first_arg;i<argc;i++)JS_SetPropertyUint32(context,args,i-first_arg,JS_NewString(context,argv[i]));
    JS_SetPropertyStr(context,host,"args",args);
    JS_SetPropertyStr(context,host,"platform",JS_NewString(context,N_PLATFORM));
#define ADD(name,fn,n) JS_SetPropertyStr(context,host,name,JS_NewCFunction(context,fn,name,n))
    ADD("open",host_open,1);ADD("symbol",host_symbol,2);ADD("bind",host_bind,3);
    ADD("address",host_address,1);ADD("pointer",host_pointer,1);
    JS_SetPropertyStr(context,host,"pointerSize",JS_NewInt32(context,sizeof(void*)));
    ADD("callback",host_callback,3);ADD("isPointer",host_is_pointer,1);ADD("isNull",host_is_null,1);
    ADD("now",host_now,0);ADD("print",host_print,1);ADD("fetch",host_fetch,1);ADD("pump",host_pump,0);
    JS_SetPropertyStr(context,global,"__host",host);JS_FreeValue(context,global);
    JSValue boot=JS_Eval(context,(const char*)bootstrap,sizeof(bootstrap)-1,"<nicotine>",JS_EVAL_TYPE_GLOBAL);
    int status=0;JSValue result=JS_UNDEFINED;
    if(JS_IsException(boot)) status=1;
    else result=JS_Eval(context,source,length,filename,JS_EVAL_TYPE_GLOBAL);
    free(source);JS_FreeValue(context,boot);
    if(JS_IsException(result))status=1;
    if(status) {JSValue e=JS_GetException(context);report_error(context,e);JS_FreeValue(context,e);}
    while(!status) {
        if(pump(context)<0) {JSValue e=JS_GetException(context);report_error(context,e);JS_FreeValue(context,e);status=1;break;}
        if(!requests)break;
        n_sleep();
    }
    if(!status && JS_PromiseState(context,result)==JS_PROMISE_REJECTED) {
        JSValue e=JS_PromiseResult(context,result);report_error(context,e);JS_FreeValue(context,e);status=1;
    }
    if(!status && !JS_IsUndefined(callback_error)) {report_error(context,callback_error);status=1;}
    JS_FreeValue(context,result);JS_FreeValue(context,callback_error);
    while(requests) {Request *r=requests;requests=r->next;n_thread_join(r->thread);
        JS_FreeValue(context,r->resolve);JS_FreeValue(context,r->reject);free(r->response.body);free(r->url);free(r);}
    while(callbacks) {Callback *c=callbacks;callbacks=c->next;JS_FreeValue(context,c->fn);ffi_closure_free(c->closure);free_structures(&c->binding);free(c);}
    JS_FreeContext(context);JS_FreeRuntime(rt);
    while(bindings) {Binding *b=bindings;bindings=b->next;free_structures(b);free(b);}
    while(libraries) {Library *l=libraries;libraries=l->next;n_library_close(l->handle);free(l);}
    n_cleanup();return status;
}
