'use strict';

const {appTap,summarize}=require('./harness');

(async()=>{
  const page=Number(process.argv[2]);
  const x=Number(process.argv[3]);
  const y=Number(process.argv[4]);
  if(!Number.isInteger(page)||!Number.isFinite(x)||!Number.isFinite(y)){
    throw new Error('usage: node tap-probe.js PAGE_INDEX X Y [--verbose]');
  }
  const run=await appTap(page,x,y,{verbose:process.argv.includes('--verbose')});
  process.stdout.write(`${JSON.stringify(summarize(run),null,2)}\n`);
})().catch(error=>{console.error(error);process.exitCode=1;});
