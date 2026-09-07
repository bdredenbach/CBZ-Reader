'use strict';

const {seedProbe}=require('./harness');

(async()=>{
  const page=Number(process.argv[2]);
  const tapX=Number(process.argv[3]);
  const tapY=Number(process.argv[4]);
  const seeds=JSON.parse(process.argv[5]||'[]');
  if(!Number.isInteger(page)||!Number.isFinite(tapX)||!Number.isFinite(tapY)||!Array.isArray(seeds)){
    throw new Error('usage: node seed-probe.js PAGE TAP_X TAP_Y SEEDS_JSON [--verbose]');
  }
  const result=await seedProbe(page,{x:tapX,y:tapY},seeds,{verbose:process.argv.includes('--verbose')});
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
})().catch(error=>{console.error(error);process.exitCode=1;});
