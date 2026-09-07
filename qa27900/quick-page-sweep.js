'use strict';

const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');

const root=path.resolve(__dirname,'..','..');
const routes=JSON.parse(fs.readFileSync(path.join(root,'regression-routes.json'),'utf8'));
const targets=routes.pages.filter(row=>row.stage!=='v73');
const probeScript=path.join(__dirname,'regression-sweep.js');

function run(target){
  return new Promise(resolve=>{
    const started=Date.now();
    const child=spawn(process.execPath,[probeScript,'quick',String(target.page),'geometry-rescue',
      '.011','.013','.954','.957','.5','.5'],{cwd:root,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},15000);
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('close',(code,signal)=>{
      clearTimeout(timer);
      let result=null,parseError=null;
      try{result=stdout.trim()?JSON.parse(stdout):null;}catch(error){parseError=error.message;}
      resolve({page:target.page,priorStage:target.stage,baselineCount:target.baselineCount,
        code,signal,timedOut,wallMs:Date.now()-started,result,stderr:stderr.trim()||null,parseError});
    });
  });
}

(async()=>{
  const out=new Array(targets.length);let cursor=0,done=0;
  async function worker(){
    while(true){
      const i=cursor++;
      if(i>=targets.length)return;
      out[i]=await run(targets[i]);done++;
      const row=out[i],label=row.result?.quad?`${row.result.owner}/${row.result.source}`:'REJECT';
      process.stderr.write(`quick-page ${done}/${targets.length} page=${row.page+1} ${label} ms=${row.wallMs}\n`);
    }
  }
  await Promise.all(Array.from({length:3},worker));
  process.stdout.write(`${JSON.stringify({targets:targets.length,probes:out},null,2)}\n`);
})().catch(error=>{console.error(error);process.exitCode=1;});
