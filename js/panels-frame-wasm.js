// NTH SHELF V2.79.04 — OPTIONAL WEBASSEMBLY RAIL-EVALUATION KERNEL
//
// The module owns no panel-selection policy. It evaluates the exact luminance,
// continuity, contrast and finite-span math used by the JavaScript rail search.
// Loading or execution failure simply leaves `ready` false, preserving the
// complete V2.79.03 JavaScript path.

const PanelFrameWasm={
  ready:false,
  error:null,
  calls:0,
  hits:0,
  _exports:null,
  _memory:null,
  _source:null,
  _sourceWidth:0,
  _sourceHeight:0,
  _outPtr:0,
  _view:null,

  attach(compiled){
    const instance=compiled?.instance||compiled;
    const exports=instance?.exports;
    if(!exports?.memory||typeof exports.evaluate!=='function')throw new Error('invalid rail-kernel exports');
    this._exports=exports;
    this._memory=exports.memory;
    this._view=new DataView(this._memory.buffer);
    this.ready=true;
    this.error=null;
    return this;
  },

  async init(url){
    if(this.ready)return this;
    try{
      const response=await fetch(url);
      if(!response.ok)throw new Error(`rail kernel HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      this.attach(await WebAssembly.instantiate(bytes));
    }catch(error){
      this.error=String(error?.message||error);
      this.ready=false;
    }
    return this;
  },

  begin(smooth,width,height){
    if(!this.ready||!(smooth instanceof Float32Array))return false;
    const outPtr=(smooth.byteLength+7)&~7;
    if(outPtr+88>this._memory.buffer.byteLength)return false;
    if(this._source!==smooth||this._sourceWidth!==width||this._sourceHeight!==height){
      new Float32Array(this._memory.buffer,0,smooth.length).set(smooth);
      this._source=smooth;
      this._sourceWidth=width;
      this._sourceHeight=height;
    }
    this._outPtr=outPtr;
    if(this._view.buffer!==this._memory.buffer)this._view=new DataView(this._memory.buffer);
    return true;
  },

  evaluate(horizontal,negative,width,height,tx,ty,tapCross,seedCross,
    outward,inward,a0,a1,step,crossSpan,alongSpan,m,anchor){
    this.calls++;
    const ok=this._exports.evaluate(horizontal?1:0,negative?1:0,width,height,
      tx,ty,tapCross,seedCross,outward,inward,a0,a1,step,crossSpan,alongSpan,
      m,anchor,this._outPtr);
    if(!ok)return null;
    this.hits++;
    const v=this._view,p=this._outPtr;
    return {
      b:v.getFloat64(p,true),atTap:v.getFloat64(p+8,true),
      support:v.getFloat64(p+16,true),continuity:v.getFloat64(p+24,true),
      strongRate:v.getFloat64(p+32,true),contrastRate:v.getFloat64(p+40,true),
      balancedRate:v.getFloat64(p+48,true),contrastMean:v.getFloat64(p+56,true),
      score:v.getFloat64(p+64,true),segments:v.getInt32(p+72,true),
      span0:v.getInt32(p+76,true),span1:v.getInt32(p+80,true),
      spanLen:v.getInt32(p+84,true)
    };
  }
};

if(typeof fetch==='function'&&typeof WebAssembly!=='undefined'){
  let kernelUrl='./js/panels-frame-kernel.wasm';
  try{
    if(typeof document!=='undefined'&&document.currentScript?.src){
      kernelUrl=new URL('panels-frame-kernel.wasm',document.currentScript.src).href;
    }
  }catch(_){/* default relative URL remains valid */}
  PanelFrameWasm.init(kernelUrl);
}
