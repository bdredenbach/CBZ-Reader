'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');
const sharp=require('sharp');

const appRoot=path.resolve(__dirname,'..');
const comicRoot=path.resolve(appRoot,'..','comic-wolverine-1000');
const pages=fs.readdirSync(comicRoot).filter(name=>/\.jpe?g$/i.test(name)).sort()
  .map(name=>path.join(comicRoot,name));

class TestImage {
  constructor(){this.width=0;this.height=0;this.onload=null;this.onerror=null;this._rgba=null;}
  set src(value){
    this._src=value;
    (async()=>{
      try{
        const input=String(value).replace(/^file:\/\//,'');
        const meta=await sharp(input).metadata();
        this.width=meta.width;this.height=meta.height;
        const scale=Math.min(1,900/Math.max(meta.width,meta.height));
        const rw=Math.max(1,Math.round(meta.width*scale));
        const rh=Math.max(1,Math.round(meta.height*scale));
        const decoded=await sharp(input).resize(rw,rh,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        this._rgba=decoded.data;this._rawWidth=decoded.info.width;this._rawHeight=decoded.info.height;
        if(this.onload)this.onload();
      }catch(error){if(this.onerror)this.onerror(error);}
    })();
  }
  get src(){return this._src;}
}

function makeCanvas(){
  const canvas={width:0,height:0,_img:null};
  canvas.getContext=()=>({
    drawImage(img){canvas._img=img;},
    getImageData(x,y,w,h){
      const img=canvas._img;
      if(!img||!img._rgba)throw new Error('QA canvas has no decoded image');
      if(w!==img._rawWidth||h!==img._rawHeight){
        throw new Error(`QA canvas mismatch requested=${w}x${h} decoded=${img._rawWidth}x${img._rawHeight}`);
      }
      return {data:img._rgba};
    }
  });
  return canvas;
}

const context={
  console,setTimeout,clearTimeout,Uint8Array,Float32Array,Math,Number,Array,Map,Set,
  Image:TestImage,document:{createElement(kind){if(kind!=='canvas')throw new Error(`unsupported element ${kind}`);return makeCanvas();}}
};
context.window=context;context.globalThis=context;
vm.createContext(context);
for(const name of ['panels.js','panels-geometry-orthogonal.js','panels-geometry-skewed.js','panels-frame-envelope.js','panels-geometry.js']){
  vm.runInContext(fs.readFileSync(path.join(appRoot,'js',name),'utf8'),context,{filename:name});
}
const api=vm.runInContext('({PanelDetect,PanelGeometry,PanelFrameEnvelope,PanelGeometrySkewed})',context);

function contains(panel,x,y){
  if(Array.isArray(panel?._quad)){
    let hit=false,q=panel._quad;
    for(let i=0,j=q.length-1;i<q.length;j=i++){
      const a=q[i],b=q[j];
      if(((a.y>y)!==(b.y>y))&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y+1e-9)+a.x)hit=!hit;
    }
    return hit;
  }
  return !!panel&&x>=panel.x&&x<=panel.x+panel.w&&y>=panel.y&&y<=panel.y+panel.h;
}

async function appTap(pageIndex,x,y,{verbose=false,resetCache=true}={}){
  if(!pages[pageIndex])throw new Error(`page ${pageIndex} is outside 0..${pages.length-1}`);
  if(resetCache)api.PanelFrameEnvelope._frameCache.clear();
  const url=pages[pageIndex],logs=[];
  const log=message=>{logs.push(String(message));if(verbose)process.stderr.write(`${message}\n`);};
  const baseline=await api.PanelDetect.detect(url,log);
  const seedBase={_tap:{x,y},_baselinePanelCount:baseline.length};
  const hit=baseline.find(panel=>contains(panel,x,y));
  if(hit){
    const result=await api.PanelGeometry.refine(url,{...hit,...seedBase,_identitySource:'v73'},log);
    return {pageIndex,x,y,stage:'v73',baselineCount:baseline.length,result,logs};
  }
  if(api.PanelGeometry.refineAdaptiveOnly){
    const quick=await api.PanelGeometry.refineAdaptiveOnly(url,{x:.011,y:.013,w:.954,h:.957,
      ...seedBase,_identitySource:'geometry-rescue',_geometryOnlyRescue:true},log);
    if(quick)return {pageIndex,x,y,stage:'quick-rescue',baselineCount:baseline.length,result:quick,logs};
  }
  const hybrid=await api.PanelDetect.detectTapHybrid(url,x,y,log);
  if(hybrid){
    const result=await api.PanelGeometry.refine(url,{...hybrid,...seedBase,_identitySource:'v100'},log);
    return {pageIndex,x,y,stage:'v100',baselineCount:baseline.length,result,logs};
  }
  const fallback=await api.PanelDetect.detectTapLocalFallback(url,x,y,log);
  if(fallback){
    const result=await api.PanelGeometry.refine(url,{...fallback,...seedBase,_identitySource:'v99'},log);
    return {pageIndex,x,y,stage:'v99',baselineCount:baseline.length,result,logs};
  }
  const rescue=await api.PanelGeometry.refine(url,{x:.011,y:.013,w:.954,h:.957,
    ...seedBase,_identitySource:'geometry-rescue',_geometryOnlyRescue:true},log);
  const proven=rescue?._frameEnvelope?.chainConnected===true&&
    (rescue?._geometryType==='tap-neighborhood-frame'||rescue?._geometryOwner==='orthogonal-frame');
  return {pageIndex,x,y,stage:'rescue',baselineCount:baseline.length,result:proven?rescue:null,logs};
}

async function loadPage(pageIndex){
  if(!pages[pageIndex])throw new Error(`page ${pageIndex} is outside 0..${pages.length-1}`);
  return new Promise((resolve,reject)=>{
    const img=new TestImage();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=pages[pageIndex];
  });
}

async function seedProbe(pageIndex,tap,seeds,{verbose=false}={}){
  const img=await loadPage(pageIndex);
  const output=[];
  for(const spec of seeds){
    const logs=[];
    const started=Date.now();
    const panel={x:spec.x,y:spec.y,w:spec.w,h:spec.h,_tap:tap,
      _multiscaleSeed:true,_geometryOnlyRescue:true};
    const result=api.PanelFrameEnvelope._detectSingle(img,panel,
      verbose?(message)=>logs.push(String(message)):null);
    output.push({name:spec.name||null,seed:spec,elapsedMs:Date.now()-started,
      result:result?{
        rect:[result.x,result.y,result.w,result.h],
        quad:result._quad?.map(point=>[point.x,point.y]),
        frameEnvelope:result._frameEnvelope
      }:null,logs});
  }
  return output;
}

function summarize(run){
  const p=run.result;
  if(!p)return {...run,logs:undefined,result:null};
  const q=Array.isArray(p._quad)?p._quad.map(v=>[+v.x.toFixed(4),+v.y.toFixed(4)]):null;
  const area=q?Math.abs(q.reduce((s,v,i)=>{const n=q[(i+1)%q.length];return s+v[0]*n[1]-n[0]*v[1];},0)/2):p.w*p.h;
  return {page:run.pageIndex,tap:[run.x,run.y],stage:run.stage,baselineCount:run.baselineCount,
    owner:p._geometryOwner||null,type:p._geometryType||null,
    rect:[p.x,p.y,p.w,p.h].map(v=>+Number(v).toFixed(4)),quad:q,area:+area.toFixed(4),
    source:p._frameEnvelope?.seedSource||null,consensus:p._frameEnvelope?.seedConsensus||null,
    relAdj:p._frameEnvelope?.relativeAdjScore==null?null:+p._frameEnvelope.relativeAdjScore.toFixed(3),
    weakestAdj:p._frameEnvelope?.weakestAdj==null?null:+p._frameEnvelope.weakestAdj.toFixed(3),
    minThickness:p._frameEnvelope?.minThickness==null?null:+p._frameEnvelope.minThickness.toFixed(3),
    ownership:p._frameOwnership?{
      owns:p._frameOwnership.owns,owner:p._frameOwnership.owner,
      trusted:+Number(p._frameOwnership.trustedAxisDeparture||0).toFixed(2),
      relativeRailProof:!!p._frameOwnership.relativeRailProof
    }:null};
}

module.exports={pages,api,appTap,summarize,contains,loadPage,seedProbe};
