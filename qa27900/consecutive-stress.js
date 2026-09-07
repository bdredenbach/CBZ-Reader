'use strict';

const {appTap}=require('./harness');

const cases=[
  ['top-left','canonical',.25,.15,'orthogonal',null],
  ['top-right','canonical',.75,.14,'orthogonal',null],
  ['middle-left','canonical',.20,.45,'skewed',[[.0362,.2787],[.4039,.2773],[.4049,.6226],[.0302,.5598]]],
  ['middle-right','canonical',.70,.46,'skewed',[[.3394,.2565],[.9778,.2573],[.9737,.6978],[.2890,.6044]]],
  ['bottom-left','canonical',.14,.78,'skewed',[[.0450,.5624],[.2795,.5992],[.2856,.9922],[.0305,.9932]]],
  ['bottom-wide','canonical',.66,.83,'skewed',[[.2767,.5988],[.9662,.6642],[.9592,.9898],[.2779,.9890]]],
  ['top-left','moved',.18,.22,'orthogonal',null],
  ['top-right','moved',.82,.18,'orthogonal',null],
  ['middle-left','moved',.12,.42,'skewed',[[.0362,.2787],[.4039,.2773],[.4049,.6226],[.0302,.5598]]],
  ['middle-right','moved',.78,.45,'skewed',[[.3394,.2565],[.9778,.2573],[.9737,.6978],[.2890,.6044]]],
  ['bottom-left','moved',.12,.85,'skewed',[[.0450,.5624],[.2795,.5992],[.2856,.9922],[.0305,.9932]]],
  ['bottom-wide','moved',.72,.82,'skewed',[[.2767,.5988],[.9662,.6642],[.9592,.9898],[.2779,.9890]]]
];

function quadDistance(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==4||b.length!==4)return Infinity;
  return a.reduce((sum,p,i)=>sum+Math.hypot(p.x-b[i][0],p.y-b[i][1]),0)/4;
}

function areaOf(panel){
  const q=panel?._quad;
  if(!Array.isArray(q))return (panel?.w||0)*(panel?.h||0);
  return Math.abs(q.reduce((sum,p,i)=>{const n=q[(i+1)%q.length];return sum+p.x*n.y-n.x*p.y;},0)/2);
}

(async()=>{
  const results=[];
  for(let i=0;i<cases.length;i++){
    const [panel,variant,x,y,expectedOwner,expectedQuad]=cases[i];
    const started=Date.now();
    const run=await appTap(35,x,y,{resetCache:i===0});
    const result=run.result;
    const envelope=result?._frameEnvelope||{};
    const actualOwner=String(result?._frameOwnership?.owner||result?._geometryOwner||'');
    const distance=expectedQuad?quadDistance(result?._quad,expectedQuad):null;
    const correctOwner=actualOwner.startsWith(expectedOwner);
    const correctGeometry=expectedQuad?distance<=.005:areaOf(result)>=.04;
    // The first lower-panel pass must use the one-search/local-verifier route.
    // The moved pass must reuse exactly that proven frame from the live cache.
    const lowerCostProof=expectedOwner!=='skewed'||variant==='moved'
      ?true:envelope.localConsensusVerifier===true&&envelope.seedConsensus>=2;
    const expectedCache=expectedOwner==='skewed'&&variant==='moved';
    const correctCache=expectedCache?envelope.cacheHit===true:true;
    const pass=!!result&&correctOwner&&correctGeometry&&lowerCostProof&&correctCache;
    const entry={panel,variant,tap:[x,y],pass,stage:run.stage,
      elapsedMs:Date.now()-started,owner:actualOwner,area:+areaOf(result).toFixed(4),
      quadDistance:distance==null?null:+distance.toFixed(5),
      source:envelope.seedSource||null,seedConsensus:envelope.seedConsensus||null,
      localConfirmations:envelope.localConfirmations??null,
      localConsensusVerifier:envelope.localConsensusVerifier===true,
      cacheHit:envelope.cacheHit===true};
    results.push(entry);
    process.stderr.write(`consecutive ${i+1}/${cases.length} ${panel}-${variant} ${pass?'PASS':'FAIL'} ms=${entry.elapsedMs} cache=${entry.cacheHit}\n`);
  }
  const lowerCanonical=results.filter(r=>r.variant==='canonical'&&r.owner.startsWith('skewed'));
  const movedCacheHits=results.filter(r=>r.variant==='moved'&&r.owner.startsWith('skewed')&&r.cacheHit).length;
  const output={passed:results.filter(r=>r.pass).length,total:results.length,
    lowerCanonicalLocalProofs:lowerCanonical.filter(r=>r.localConsensusVerifier).length,
    movedLowerCacheHits:movedCacheHits,results};
  process.stdout.write(`${JSON.stringify(output,null,2)}\n`);
  if(output.passed!==output.total||output.lowerCanonicalLocalProofs!==4||movedCacheHits!==4)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
