'use strict';

const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');

const root=path.resolve(__dirname,'..','..');
const routes=JSON.parse(fs.readFileSync(path.join(root,'regression-routes.json'),'utf8'));
const targets=routes.pages.filter(row=>row.policy==='frame');
const probeScript=path.join(__dirname,'regression-sweep.js');
const probeMode=process.argv.includes('--full')?'adaptive':'quick';

function run(target){
  return new Promise(resolve=>{
    const started=Date.now();
    const child=spawn(process.execPath,[probeScript,probeMode,String(target.page),target.stage,
      ...target.seed.map(String),'0.5','0.5'],{
      cwd:root,stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},45000);
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('close',(code,signal)=>{
      clearTimeout(timer);
      let result=null,parseError=null;
      if(stdout.trim()){
        try{result=JSON.parse(stdout);}catch(error){parseError=error.message;}
      }
      resolve({page:target.page,routeStage:target.stage,code,signal,timedOut,
        wallMs:Date.now()-started,result,stderr:stderr.trim()||null,parseError});
    });
  });
}

(async()=>{
  const out=new Array(targets.length);
  let cursor=0,done=0;
  async function worker(){
    while(true){
      const i=cursor++;
      if(i>=targets.length)return;
      out[i]=await run(targets[i]);
      done++;
      const row=out[i];
      const label=row.timedOut?'TIMEOUT':row.result
        ?`${row.result.owner}/${row.result.source||row.result.stage}`:`ERROR-${row.code}`;
      process.stderr.write(`probe ${done}/${targets.length} page=${row.page+1} ${label} ms=${row.wallMs}\n`);
    }
  }
  await Promise.all(Array.from({length:3},worker));
  process.stdout.write(`${JSON.stringify({mode:probeMode,targets:targets.length,probes:out},null,2)}\n`);
})().catch(error=>{console.error(error);process.exitCode=1;});
