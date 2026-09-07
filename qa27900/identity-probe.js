'use strict';

const {pages,api,contains}=require('./harness');

(async()=>{
  const page=Number(process.argv[2]);
  const taps=JSON.parse(process.argv[3]||'[]');
  if(!Number.isInteger(page)||!pages[page]||!Array.isArray(taps)){
    throw new Error('usage: node identity-probe.js PAGE TAPS_JSON');
  }
  const baseline=await api.PanelDetect.detect(pages[page]);
  const output={baseline,taps:[]};
  for(const tap of taps){
    const hit=baseline.find(panel=>contains(panel,tap.x,tap.y))||null;
    const hybrid=hit?null:await api.PanelDetect.detectTapHybrid(pages[page],tap.x,tap.y);
    const fallback=hit||hybrid?null:await api.PanelDetect.detectTapLocalFallback(pages[page],tap.x,tap.y);
    output.taps.push({...tap,stage:hit?'v73':hybrid?'v100':fallback?'v99':'rescue',seed:hit||hybrid||fallback||null});
  }
  process.stdout.write(`${JSON.stringify(output,null,2)}\n`);
})().catch(error=>{console.error(error);process.exitCode=1;});
