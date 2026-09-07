'use strict';

const path=require('path');
const {spawn}=require('child_process');

const root=path.resolve(__dirname,'..','..');
const probe=path.join(__dirname,'tap-probe.js');
const cases=[
  ['top-left','canonical',.25,.15,'orthogonal'],['top-left','moved',.18,.22,'orthogonal'],
  ['top-right','canonical',.75,.14,'orthogonal'],['top-right','moved',.82,.18,'orthogonal'],
  ['middle-left','canonical',.20,.45,'skewed'],['middle-left','moved',.12,.42,'skewed'],
  ['middle-right','canonical',.70,.46,'skewed'],['middle-right','moved',.78,.45,'skewed'],
  ['bottom-left','canonical',.14,.78,'skewed'],['bottom-left','moved',.12,.85,'skewed'],
  ['bottom-wide','canonical',.66,.83,'skewed'],['bottom-wide','moved',.72,.82,'skewed']
];

function run(spec){
  return new Promise(resolve=>{
    const [panel,variant,x,y,expected]=spec,started=Date.now();
    const child=spawn(process.execPath,[probe,'35',String(x),String(y)],{
      cwd:root,stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},60000);
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('close',(code,signal)=>{
      clearTimeout(timer);
      let result=null,parseError=null;
      try{result=stdout.trim()?JSON.parse(stdout):null;}catch(error){parseError=error.message;}
      const actual=String(result?.ownership?.owner||result?.owner||'');
      const pass=!timedOut&&code===0&&!!result&&actual.startsWith(expected)&&result.area>=.04;
      resolve({panel,variant,x,y,expected,pass,code,signal,timedOut,
        wallMs:Date.now()-started,result,stderr:stderr.trim()||null,parseError});
    });
  });
}

(async()=>{
  const out=new Array(cases.length);let cursor=0,done=0;
  async function worker(){
    while(true){
      const i=cursor++;
      if(i>=cases.length)return;
      out[i]=await run(cases[i]);done++;
      process.stderr.write(`stress ${done}/${cases.length} ${out[i].panel}-${out[i].variant} ${out[i].pass?'PASS':'FAIL'} ms=${out[i].wallMs}\n`);
    }
  }
  await Promise.all(Array.from({length:2},worker));
  process.stdout.write(`${JSON.stringify({passed:out.filter(x=>x.pass).length,total:out.length,cases:out},null,2)}\n`);
})().catch(error=>{console.error(error);process.exitCode=1;});
