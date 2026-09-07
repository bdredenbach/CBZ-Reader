'use strict';

const {pages,api,contains,appTap,summarize,loadPage}=require('./harness');

const grid=[
  {x:.25,y:.18},{x:.75,y:.18},
  {x:.25,y:.48},{x:.75,y:.48},
  {x:.25,y:.80},{x:.75,y:.80}
];

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);
  let cursor=0;
  async function worker(){
    while(true){
      const i=cursor++;
      if(i>=items.length)return;
      out[i]=await fn(items[i],i);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}

async function inventory(){
  const indexes=pages.map((_,i)=>i);
  const results=await mapLimit(indexes,4,async page=>{
    const started=Date.now();
    const baseline=await api.PanelDetect.detect(pages[page]);
    const covered=grid.map(tap=>baseline.some(panel=>contains(panel,tap.x,tap.y)));
    const row={page,baselineCount:baseline.length,covered,
      uncovered:covered.filter(value=>!value).length,elapsedMs:Date.now()-started};
    process.stderr.write(`inventory ${page+1}/${pages.length} panels=${row.baselineCount} uncovered=${row.uncovered} ms=${row.elapsedMs}\n`);
    return row;
  });
  process.stdout.write(`${JSON.stringify({mode:'inventory',pages:results},null,2)}\n`);
}

async function routes(){
  const indexes=pages.map((_,i)=>i);
  const results=await mapLimit(indexes,4,async page=>{
    const started=Date.now(),tap={x:.5,y:.5};
    const baseline=await api.PanelDetect.detect(pages[page]);
    const hit=baseline.find(panel=>contains(panel,tap.x,tap.y))||null;
    const hybrid=hit?null:await api.PanelDetect.detectTapHybrid(pages[page],tap.x,tap.y);
    const fallback=hit||hybrid?null:await api.PanelDetect.detectTapLocalFallback(pages[page],tap.x,tap.y);
    const seed=hit||hybrid||fallback||{x:.011,y:.013,w:.954,h:.957,
      _tap:tap,_identitySource:'geometry-rescue',_geometryOnlyRescue:true};
    const stage=hit?'v73':hybrid?'v100':fallback?'v99':'rescue';
    const policy=api.PanelGeometry._seedPolicy({...seed,_identitySource:
      stage==='v73'?'v73':stage==='v100'?'v100':stage==='v99'?'v99':'geometry-rescue'});
    const row={page,baselineCount:baseline.length,stage,policy:policy.mode,
      seed:[seed.x,seed.y,seed.w,seed.h],elapsedMs:Date.now()-started};
    process.stderr.write(`route ${page+1}/${pages.length} stage=${stage} policy=${policy.mode} ms=${row.elapsedMs}\n`);
    return row;
  });
  process.stdout.write(`${JSON.stringify({mode:'routes',pages:results},null,2)}\n`);
}

async function probe(){
  const page=Number(process.argv[3]);
  const x=Number(process.argv[4]);
  const y=Number(process.argv[5]);
  if(!Number.isInteger(page)||!Number.isFinite(x)||!Number.isFinite(y)){
    throw new Error('usage: node regression-sweep.js probe PAGE X Y');
  }
  const started=Date.now();
  const run=await appTap(page,x,y,{resetCache:true});
  process.stdout.write(`${JSON.stringify({...summarize(run),elapsedMs:Date.now()-started},null,2)}\n`);
}

async function geometry(){
  const page=Number(process.argv[3]);
  const stage=String(process.argv[4]);
  const values=process.argv.slice(5,11).map(Number);
  if(!Number.isInteger(page)||values.some(value=>!Number.isFinite(value))){
    throw new Error('usage: node regression-sweep.js geometry PAGE STAGE X Y W H TAP_X TAP_Y');
  }
  const [x,y,w,h,tapX,tapY]=values;
  const seed={x,y,w,h,_tap:{x:tapX,y:tapY},_baselinePanelCount:0,
    _identitySource:stage==='v100'?'v100':stage==='v99'?'v99':'geometry-rescue'};
  if(stage==='v100')seed._v100Hybrid=true;
  if(stage==='v99')seed._v87BoundarySet=true;
  if(stage==='rescue')seed._geometryOnlyRescue=true;
  api.PanelFrameEnvelope._frameCache.clear();
  const started=Date.now();
  const result=await api.PanelGeometry.refine(pages[page],seed);
  process.stdout.write(`${JSON.stringify({...summarize({pageIndex:page,x:tapX,y:tapY,
    stage,baselineCount:0,result}),elapsedMs:Date.now()-started},null,2)}\n`);
}

async function adaptive(localOnly=false){
  const page=Number(process.argv[3]);
  const stage=String(process.argv[4]);
  const values=process.argv.slice(5,11).map(Number);
  if(!Number.isInteger(page)||values.some(value=>!Number.isFinite(value))){
    throw new Error('usage: node regression-sweep.js adaptive PAGE STAGE X Y W H TAP_X TAP_Y');
  }
  const [x,y,w,h,tapX,tapY]=values;
  const panel={x,y,w,h,_tap:{x:tapX,y:tapY},_identitySource:stage,
    _geometryOnlyRescue:stage==='rescue'};
  const img=await loadPage(page);
  const started=Date.now();
  const result=api.PanelFrameEnvelope._adaptiveFastDetect(img,panel,null,localOnly?{localOnly:true}:undefined);
  process.stdout.write(`${JSON.stringify({...summarize({pageIndex:page,x:tapX,y:tapY,
    stage,baselineCount:0,result}),elapsedMs:Date.now()-started,
    frameEvidence:result?._frameEnvelope||null},null,2)}\n`);
}

(async()=>{
  const mode=process.argv[2]||'inventory';
  if(mode==='inventory')return inventory();
  if(mode==='routes')return routes();
  if(mode==='probe')return probe();
  if(mode==='geometry')return geometry();
  if(mode==='adaptive')return adaptive(false);
  if(mode==='quick')return adaptive(true);
  throw new Error(`unknown mode ${mode}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
