// NTH SHELF V2.79.04 — OPTIONAL WASM RAIL KERNEL TEST
//
// Generate multiple plausible finite rails per side, then choose one four-rail
// FAMILY that closes around the tap.  Rails are no longer selected independently.
// A strong distant line loses if it cannot connect top -> right -> bottom -> left
// -> top using direct or tightly bounded short-bridge corner evidence.

const PanelFrameEnvelope = {
  _frameCache: new Map(),

  _cachedFrame(imgUrl,panel,log){
    const tap=panel?._tap;
    const entries=this._frameCache.get(imgUrl)||[];
    if(!tap||!entries.length)return null;
    const inside=(q)=>{let hit=false;for(let i=0,j=q.length-1;i<q.length;j=i++){
      const a=q[i],b=q[j];
      if(((a.y>tap.y)!==(b.y>tap.y))&&tap.x<(b.x-a.x)*(tap.y-a.y)/(b.y-a.y+1e-9)+a.x)hit=!hit;
    }return hit;};
    const matches=entries.filter(e=>inside(e._quad)).sort((a,b)=>a._cacheArea-b._cacheArea);
    if(!matches.length)return null;
    const hit=matches[0];
    if(log)log(`FRAME CACHE HIT area=${hit._cacheArea.toFixed(3)}`);
    return {...panel,x:hit.x,y:hit.y,w:hit.w,h:hit.h,
      _quad:hit._quad.map(p=>({...p})),_geometryType:'tap-neighborhood-frame',
      _frameEnvelope:{...hit._frameEnvelope,cacheHit:true}};
  },

  _rememberFrame(imgUrl,result){
    if(!imgUrl||!result?._frameEnvelope||!Array.isArray(result._quad))return;
    const area=Math.abs(result._quad.reduce((s,p,i)=>{const n=result._quad[(i+1)%result._quad.length];return s+p.x*n.y-n.x*p.y;},0)/2);
    const e=result._frameEnvelope;
    // A one-off offset/probe family can be useful as a live fallback, but it
    // must not become page authority and steal later taps. Cache only frames
    // independently rediscovered by at least two seeds.
    if(area<.020||area>.50||(e.confidence||0)<.70||(e.seedConsensus||0)<2)return;
    const entries=this._frameCache.get(imgUrl)||[];
    const distance=(a,b)=>a.reduce((s,p,i)=>s+Math.hypot(p.x-b[i].x,p.y-b[i].y),0)/a.length;
    if(!entries.some(old=>distance(old._quad,result._quad)<=.025)){
      entries.push({...result,_cacheArea:area,_quad:result._quad.map(p=>({...p})),_frameEnvelope:{...e}});
      if(entries.length>24)entries.shift();
    }
    this._frameCache.delete(imgUrl);this._frameCache.set(imgUrl,entries);
    while(this._frameCache.size>12)this._frameCache.delete(this._frameCache.keys().next().value);
  },

  // Build the tiny tap-adaptive seed bank used by the proven-frame path.
  // V2.79.02 runs one complete four-rail search first, then asks the remaining
  // seed windows to verify that exact geometry locally. If they cannot confirm
  // it, the established V2.79.01 three-search path below runs unchanged.
  _adaptiveFastSpecs(panel,tap){
    const specs=[];
    const add=(name,w,h,x,y,probe)=>{
      w=Math.max(.18,Math.min(.94,w));
      h=Math.max(.16,Math.min(.94,h));
      x=Math.max(.015,Math.min(.985-w,x));
      y=Math.max(.015,Math.min(.985-h,y));
      // Rail discovery must be stable for every tap inside the same cell.
      // Use the seed's own center as its proof viewpoint; the real tap is
      // checked separately against the finished quadrilateral below.
      specs.push({name,x,y,w,h,probe:probe||{x:x+w*.5,y:y+h*.5}});
    };
    const identity=panel?._identitySeed;
    const topBand=tap.y<.30;
    const bottomBand=tap.y>.66;
    const leftBand=tap.x<.35;
    const rightEdge=(w)=>tap.x>.62?.972-w:tap.x-w*.55;

    if(topBand&&identity&&identity.w>=.24&&identity.h>=.12&&identity.h<=.42){
      const left=tap.x<.50;
      const dims=[
        [identity.w,identity.h*1.08],
        [identity.w*.96,identity.h*1.04],
        [identity.w*1.03,identity.h*1.16]
      ];
      for(let i=0;i<dims.length;i++){
        const [w,h]=dims[i];
        add(`identity-top-${i+1}`,w,h,left ? .015 : .985-w,.015,
          {x:left?.25:.75,y:.15});
      }
      return specs;
    }

    if(topBand){
      // A local boundary seed is not guaranteed for artwork-heavy top cells.
      // Keep a small half-page bank so a cold geometry-rescue tap still uses
      // the same viewpoint as a neighboring tap that did receive an identity.
      const left=tap.x<.50;
      const dims=[[.500,.340],[.480,.330],[.515,.355]];
      for(let i=0;i<dims.length;i++){
        const [w,h]=dims[i];
        add(`top-${left?'left':'right'}-${i+1}`,w,h,left?.015:.985-w,.015,
          {x:left?.25:.75,y:.15});
      }
      return specs;
    }

    if(bottomBand&&leftBand){
      // Bottom-left page-edge cells are especially sensitive to a seed whose
      // top is a few pixels too high. Pinning the lower edge to the page keeps
      // the sloped top rail inside the search neighborhood for every tap in
      // the cell.
      for(const [i,h] of [.440,.439,.437].entries())add(`bottom-left-${i+1}`,.280,h,.015,.985-h,{x:.14,y:.78});
      return specs;
    }
    if(bottomBand){
      const dims=[[.680,.340],[.620,.340],[.620,.320]];
      for(let i=0;i<dims.length;i++){
        const [w,h]=dims[i];
        add(`bottom-wide-${i+1}`,w,h,rightEdge(w),.985-h,{x:.66,y:.83});
      }
      return specs;
    }
    if(leftBand){
      const dims=[[.380,.280],[.400,.300],[.380,.260]];
      for(let i=0;i<dims.length;i++){
        const [w,h]=dims[i];
        add(`middle-left-${i+1}`,w,h,.028,.45-h*.537,{x:.20,y:.45});
      }
      return specs;
    }

    const dims=[[.600,.420],[.680,.440]];
    for(let i=0;i<dims.length;i++){
      const [w,h]=dims[i];
      // Do not let a middle-row seed climb into the top pair. This was the
      // source of the slow top-plus-lower union fallback on the sepia page.
      add(`middle-wide-${i+1}`,w,h,rightEdge(w),Math.max(.220,.46-h*.537),{x:.70,y:.46});
    }
    {
      const w=.600,h=.420;
      add('middle-wide-confirm',w,h,rightEdge(w),Math.max(.220,.46-h*.537)+.006,{x:.70,y:.46});
    }
    return specs;
  },

  _adaptiveSpecOrder(specs,tap){
    if(specs.length<2)return specs;
    const first=String(specs[0].name||'');
    let preferred=null;
    if(first.startsWith('bottom-left-'))preferred='bottom-left-3';
    else if(first.startsWith('middle-left-'))preferred='middle-left-1';
    else if(first.startsWith('middle-wide-'))preferred='middle-wide-1';
    else if(first.startsWith('top-left-'))preferred='top-left-3';
    else if(first.startsWith('top-right-'))preferred='top-right-1';
    else if(first.startsWith('identity-top-'))preferred=tap.x<.50?'identity-top-2':'identity-top-1';
    else if(first.startsWith('bottom-wide-'))preferred='bottom-wide-1';
    const index=preferred?specs.findIndex(spec=>spec.name===preferred):-1;
    return index>0?[specs[index],...specs.slice(0,index),...specs.slice(index+1)]:specs;
  },

  _adaptivePointIn(q,point){
    let hit=false;
    for(let i=0,j=q.length-1;i<q.length;j=i++){
      const a=q[i],b=q[j];
      if(((a.y>point.y)!==(b.y>point.y))&&
        point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y+1e-9)+a.x)hit=!hit;
    }
    return hit;
  },

  _adaptiveQualifiedTrial(result,spec,tap){
    if(!result||!Array.isArray(result._quad)||!this._adaptivePointIn(result._quad,tap))return null;
    const e=result._frameEnvelope||{};
    const absoluteArea=Math.abs(result._quad.reduce((sum,p,i)=>{
      const n=result._quad[(i+1)%4];return sum+p.x*n.y-n.x*p.y;
    },0)/2);
    const minRelativeAdj=absoluteArea>.15?.86:.78;
    if(absoluteArea<.040||absoluteArea>.50||!e.chainConnected||
      (e.seedCoverage||0)<.88||(e.relativeAdjScore||0)<minRelativeAdj||
      (e.minThickness||0)<.76||(e.adjacencyScore||0)<.18||
      ((e.weakestAdj||0)<.04&&(e.adjacencyScore||0)<.25))return null;
    return {result,spec,absoluteArea};
  },

  // Confirm a fully proven candidate from another seed window without running
  // the global slope/anchor family search again. This verifier cannot invent
  // geometry: it checks alternate-window reach, coverage, tap enclosure and
  // sustained ink on the four rails of the first search's exact quadrilateral.
  _adaptiveLocalConfirm(img,candidate,spec){
    const cached=img?._nthFrameLumCache;
    const q=candidate?._quad;
    if(!cached||!Array.isArray(q)||q.length!==4)return false;
    const {width:w,height:h,lum,smooth}=cached;
    if(!w||!h||!lum?.length)return false;
    const x0=Math.max(2,Math.round(spec.x*w));
    const y0=Math.max(2,Math.round(spec.y*h));
    const x1=Math.min(w-3,Math.round((spec.x+spec.w)*w)-1);
    const y1=Math.min(h-3,Math.round((spec.y+spec.h)*h)-1);
    const rw=x1-x0+1,rh=y1-y0+1;
    if(rw<30||rh<30||!this._adaptivePointIn(q,spec.probe))return false;

    const area=Math.abs(q.reduce((sum,p,i)=>{const n=q[(i+1)%4];return sum+p.x*n.y-n.x*p.y;},0)/2)*w*h;
    const areaRatio=area/Math.max(1,rw*rh);
    if(areaRatio<.52||areaRatio>1.95)return false;
    let covered=0,total=0;
    for(let gy=1;gy<=5;gy++)for(let gx=1;gx<=5;gx++){
      total++;
      if(this._adaptivePointIn(q,{x:(x0+rw*gx/6)/w,y:(y0+rh*gy/6)/h}))covered++;
    }
    if(covered/total<.44)return false;

    const pixelLum=(x,y)=>{
      x=Math.max(1,Math.min(w-2,Math.round(x)));
      y=Math.max(1,Math.min(h-2,Math.round(y)));
      return smooth?.length===w*h?smooth[y*w+x]:
        (lum[(y-1)*w+x]+lum[y*w+x]+lum[(y+1)*w+x]+lum[y*w+x-1]+lum[y*w+x+1])/5;
    };
    const px=q.map(p=>({x:p.x*w,y:p.y*h}));
    const rails=[
      {kind:'top',a:px[0],b:px[1],horizontal:true,negative:true,seedCross:y0,crossSpan:rh,dimCross:h},
      {kind:'right',a:px[1],b:px[2],horizontal:false,negative:false,seedCross:x1,crossSpan:rw,dimCross:w},
      {kind:'bottom',a:px[3],b:px[2],horizontal:true,negative:false,seedCross:y1,crossSpan:rh,dimCross:h},
      {kind:'left',a:px[0],b:px[3],horizontal:false,negative:true,seedCross:x0,crossSpan:rw,dimCross:w}
    ];
    const probeX=spec.probe.x*(w-1),probeY=spec.probe.y*(h-1);
    for(const rail of rails){
      const alongDelta=rail.horizontal?rail.b.x-rail.a.x:rail.b.y-rail.a.y;
      if(Math.abs(alongDelta)<8)return false;
      const m=(rail.horizontal?rail.b.y-rail.a.y:rail.b.x-rail.a.x)/alongDelta;
      const b=(rail.horizontal?rail.a.y:rail.a.x)-m*(rail.horizontal?rail.a.x:rail.a.y);
      const probeAlong=rail.horizontal?probeX:probeY;
      const probeCross=rail.horizontal?probeY:probeX;
      const atProbe=m*probeAlong+b;
      const outward=Math.max(22,Math.min(rail.dimCross*.20,rail.crossSpan*.92));
      const inward=Math.max(4,rail.crossSpan*.08);
      const lo=rail.negative?rail.seedCross-outward:rail.seedCross-inward;
      const hi=rail.negative?rail.seedCross+inward:rail.seedCross+outward;
      if(atProbe<lo-2||atProbe>hi+2)return false;
      if(rail.negative&&atProbe>=probeCross-4)return false;
      if(!rail.negative&&atProbe<=probeCross+4)return false;
      const pageEdge=(rail.negative&&atProbe<=rail.dimCross*.025)||
        (!rail.negative&&atProbe>=rail.dimCross*.975);

      const along0=rail.horizontal?Math.min(rail.a.x,rail.b.x):Math.min(rail.a.y,rail.b.y);
      const along1=rail.horizontal?Math.max(rail.a.x,rail.b.x):Math.max(rail.a.y,rail.b.y);
      const step=Math.max(2,(along1-along0)/64);
      let n=0,dark=0,longest=0,run=0;
      for(let along=along0;along<=along1;along+=step){
        const cross=m*along+b;
        const x=rail.horizontal?along:cross,y=rail.horizontal?cross:along;
        if(x<7||x>w-8||y<7||y>h-8){run=0;continue;}
        const value=pixelLum(x,y);n++;
        if(value<=172){dark++;run++;longest=Math.max(longest,run);}else run=0;
      }
      // The full search has already proven the printed page-edge rail. A local
      // verifier may have too few in-bounds samples after its safety margin;
      // alternate-window reach is sufficient for that one clipped side.
      if(pageEdge&&n<16)continue;
      if(n<16||dark/n<.33||longest/n<.17)return false;
    }
    return true;
  },

  _adaptiveFastDetect(img,panel,log,{localOnly=false}={}){
    const tap=panel._tap||{x:panel.x+panel.w/2,y:panel.y+panel.h/2};
    const specs=this._adaptiveSpecOrder(this._adaptiveFastSpecs(panel,tap),tap);
    if(!specs.length)return null;
    const primarySpec=specs[0];
    const primarySeed={...panel,x:primarySpec.x,y:primarySpec.y,w:primarySpec.w,h:primarySpec.h,
      _tap:primarySpec.probe,_multiscaleSeed:true,_adaptiveFastSeed:true};
    const primary=this._adaptiveQualifiedTrial(this._detectSingle(img,primarySeed,null),primarySpec,tap);
    if(primary){
      const confirmations=specs.slice(1).map(spec=>this._adaptiveLocalConfirm(img,primary.result,spec));
      const confirmationCount=confirmations.filter(Boolean).length;
      const boundedBottomLeft=primary.absoluteArea<=.15&&/^bottom-left-/.test(primary.spec.name);
      const needed=boundedBottomLeft?1:2;
      if(confirmationCount>=needed){
        const e=primary.result._frameEnvelope;
        e.multiscaleSeedRescue=true;
        e.adaptiveFastPath=true;
        e.localConsensusVerifier=true;
        e.localConfirmations=confirmationCount;
        e.seedConsensus=1+confirmationCount;
        e.seedSource=`adaptive-local-${primary.spec.name}`;
        primary.result._tap=tap;
        if(log)log(`ADAPTIVE LOCAL HIT source=${primary.spec.name} consensus=${1+confirmationCount}/3 area=${primary.absoluteArea.toFixed(3)} rel=${(e.relativeAdjScore||0).toFixed(2)}`);
        return primary.result;
      }
      if(log)log(`ADAPTIVE LOCAL MISS source=${primary.spec.name} confirmations=${confirmationCount}/2${localOnly?'; quick route defers':'; full-bank fallback'}`);
    }else if(log)log(`ADAPTIVE PRIMARY MISS source=${primarySpec.name}${localOnly?'; quick route defers':'; full-bank fallback'}`);

    // V2.79.03 front-route contract: one complete rail-family search and its
    // cheap local confirmations are the entire latency budget. A miss returns
    // immediately to the established identity chain; it must not trigger the
    // slower three-search or exhaustive geometry banks here.
    if(localOnly)return null;

    // Safety fallback: if the one-search/local-verifier route cannot prove the
    // same frame, retain V2.79.01's complete three-search consensus unchanged.
    const trials=[];
    for(const spec of specs){
      const seed={...panel,x:spec.x,y:spec.y,w:spec.w,h:spec.h,
        _tap:spec.probe,_multiscaleSeed:true,_adaptiveFastSeed:true};
      const result=this._detectSingle(img,seed,null);
      const trial=this._adaptiveQualifiedTrial(result,spec,tap);
      if(trial)trials.push(trial);
    }
    const quadDistance=(a,b)=>a.reduce((sum,p,i)=>sum+Math.hypot(p.x-b[i].x,p.y-b[i].y),0)/4;
    for(const trial of trials){
      trial.consensus=trials.filter(other=>quadDistance(trial.result._quad,other.result._quad)<=.035).length;
      const e=trial.result._frameEnvelope||{};
      trial.rank=(e.relativeAdjScore||0)*5.2+(e.confidence||0)+
        (e.seedCoverage||0)*.7+(e.familyScore||0)*.04+
        (e.weakestAdj||0)*5+(e.adjacencyScore||0)*2+
        (e.minThickness||0)*2+(e.thicknessScore||0)-trial.absoluteArea*2;
    }
    // Large/wide cells need three independent discoveries. Two-seed agreement
    // can otherwise lock onto a strong artwork loop spanning multiple panels.
    // The narrow bottom-left page-edge family is the sole bounded exception:
    // its fourth side can be almost inkless, but two seeds still recover the
    // same small enclosing cell.
    const agreed=trials.filter(t=>t.consensus>=3||(
      t.consensus>=2&&t.absoluteArea<=.15&&/^bottom-left-/.test(t.spec.name)
    )).sort((a,b)=>b.rank-a.rank);
    if(!agreed.length){
      if(log)log(`ADAPTIVE FAST MISS proven=${trials.length}/${specs.length}; exhaustive fallback`);
      return null;
    }
    const chosen=agreed[0],e=chosen.result._frameEnvelope;
    e.multiscaleSeedRescue=true;
    e.adaptiveFastPath=true;
    e.seedConsensus=chosen.consensus;
    e.seedSource=`adaptive-${chosen.spec.name}`;
    // Downstream ownership and caching belong to the user's tap, not the
    // internal rail-discovery viewpoint.
    chosen.result._tap=tap;
    if(log)log(`ADAPTIVE FAST HIT source=${chosen.spec.name} consensus=${chosen.consensus}/${trials.length} area=${chosen.absoluteArea.toFixed(3)} rel=${(e.relativeAdjScore||0).toFixed(2)}`);
    return chosen.result;
  },

  detectAdaptiveOnly(imgUrl,panel,log){
    if(!imgUrl||!panel)return Promise.resolve(null);
    const cached=this._cachedFrame(imgUrl,panel,log);
    if(cached)return Promise.resolve(cached);
    return new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const result=this._adaptiveFastDetect(img,panel,log,{localOnly:true});
          this._rememberFrame(imgUrl,result);
          resolve(result);
        }catch(err){
          console.warn('Quick connected frame failed:',err);
          if(log)log(`QUICK CHAIN RAIL ERROR ${err.message}`);
          resolve(null);
        }
      };
      img.onerror=()=>resolve(null);
      img.src=imgUrl;
    });
  },

  detect(imgUrl, panel, log) {
    if (!imgUrl || !panel) return Promise.resolve(null);
    const cached=this._cachedFrame(imgUrl,panel,log);
    if(cached)return Promise.resolve(cached);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try { const result=this._detect(img, panel, log);this._rememberFrame(imgUrl,result);resolve(result); }
        catch (err) {
          console.warn('Connected frame failed:', err);
          if (log) log(`CHAIN RAIL ERROR ${err.message}`);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imgUrl;
    });
  },

  _detect(img, panel, log) {
    const seedArea=Math.max(.001,panel.w*panel.h);
    // A wide, shallow comic panel is not suspicious merely because its width
    // exceeds half the page. Rescue is reserved for seeds that plausibly span
    // multiple panels/a structural band. The router applies the same policy.
    const suspiciousSeed=seedArea>.24||
      (panel.w>.82&&panel.h>.28)||
      (panel.h>.82&&panel.w>.28);
    if(suspiciousSeed){
      const fast=this._adaptiveFastDetect(img,panel,log);
      if(fast)return fast;
    }
    const primary=this._detectSingle(img,panel,log);
    // A panel-scale seed now passes strict family/locality checks on its own.
    // Do not let unrelated tap-centered rescues replace that proven loop.
    if(primary&&!suspiciousSeed)return primary;

    const tap=panel._tap||{x:panel.x+panel.w/2,y:panel.y+panel.h/2};
    const seedSizes=[
      [.14,.62],[.18,.50],[.18,.94],[.24,.50],[.28,.32],
      [.28,.44],[.30,.18],[.30,.24],[.30,.32],[.38,.18],[.38,.24],
      [.46,.11],[.46,.13],[.46,.14],[.46,.24],[.50,.30],[.50,.40],[.54,.50],
      [.60,.42],[.62,.14],[.62,.18],[.62,.32],[.62,.40],[.68,.36],[.68,.40],
      [.94,.14],[.94,.18],[.94,.24]
    ];
    const trials=[];
    if(primary&&(!suspiciousSeed||panel._structuralCompositeSeed||Math.abs(primary._quad.reduce((s,p,i)=>{
      const n=primary._quad[(i+1)%4];return s+p.x*n.y-n.x*p.y;
    },0)/2)<=.34))trials.push({result:primary,seed:panel,source:'primary'});

    const triedSeeds=new Set();
    for(const [sw,sh] of seedSizes){
      const edgeX=tap.x>.72?.972-sw:tap.x<.28?.028:tap.x-sw/2;
      const edgeY=tap.y>.82?.972-sh:tap.y<.18?.028:tap.y-sh/2;
      const placements=[
        ['edge',edgeX,edgeY],['center',tap.x-sw*.50,tap.y-sh*.50],
        ['x34',tap.x-sw*.34,tap.y-sh*.50],['x66',tap.x-sw*.66,tap.y-sh*.50],
        ['y34',tap.x-sw*.50,tap.y-sh*.34],['y66',tap.x-sw*.50,tap.y-sh*.66]
      ];
      // A tap near the end of a long shallow cell used to center the seed on
      // adjacent artwork and miss the opposite rail. These placements still
      // pass through the same strict closed-family detector.
      if(sw>=.38&&sh<=.32)placements.push(
        ['x10',tap.x-sw*.10,tap.y-sh*.50],['x26',tap.x-sw*.26,tap.y-sh*.50],
        ['x74',tap.x-sw*.74,tap.y-sh*.50],['x90',tap.x-sw*.90,tap.y-sh*.50]
      );
      if(sw>=.54&&sh>=.34)placements.push(
        ['x42',tap.x-sw*.42,tap.y-sh*.50],['x58',tap.x-sw*.58,tap.y-sh*.50],
        ['y44',tap.x-sw*.50,tap.y-sh*.44],['y60',tap.x-sw*.50,tap.y-sh*.60]
      );
      for(const [placement,sxBase,syBase] of placements){
        const sx=Math.max(.015,Math.min(.985-sw,sxBase));
        const sy=Math.max(.015,Math.min(.985-sh,syBase));
        const key=`${sx.toFixed(3)}:${sy.toFixed(3)}:${sw}:${sh}`;
        if(triedSeeds.has(key))continue;
        triedSeeds.add(key);
        const seed={...panel,x:sx,y:sy,w:sw,h:sh,_tap:tap,_multiscaleSeed:true};
        const result=this._detectSingle(img,seed,null);
        if(result){
          const resultArea=Math.abs(result._quad.reduce((s,p,i)=>{
            const n=result._quad[(i+1)%4];return s+p.x*n.y-n.x*p.y;
          },0)/2);
          if(!suspiciousSeed||(resultArea>=.025&&resultArea<=.34)){
            trials.push({result,seed,source:`${sw.toFixed(2)}x${sh.toFixed(2)}-${placement}`});
          }
        }
      }
    }
    {
      const sw=.272,sh=.285;
      const sxBase=tap.x>.78?.972-sw:tap.x<.22?.028:tap.x-sw*.56;
      const syBase=tap.y>.82?.972-sh:tap.y<.18?.028:tap.y-sh*.54;
      const sx=Math.max(.015,Math.min(.985-sw,sxBase));
      const sy=Math.max(.015,Math.min(.985-sh,syBase));
      const seed={...panel,x:sx,y:sy,w:sw,h:sh,_tap:tap,_multiscaleSeed:true};
      const result=this._detectSingle(img,seed,null);
      if(result)trials.push({result,seed,source:'edge-fit'});
    }
    {
      const sw=.245,sh=.285;
      const sxBase=tap.x-sw*.612;
      const syBase=tap.y-sh*.537;
      const sx=Math.max(.015,Math.min(.985-sw,sxBase));
      const sy=Math.max(.015,Math.min(.985-sh,syBase));
      const seed={...panel,x:sx,y:sy,w:sw,h:sh,_tap:tap,_multiscaleSeed:true};
      const result=this._detectSingle(img,seed,null);
      if(result)trials.push({result,seed,source:'balanced-fit'});
    }
    const originalInside=(quad)=>{let inside=false;for(let i=0,j=quad.length-1;i<quad.length;j=i++){
      const a=quad[i],b=quad[j];
      if(((a.y>tap.y)!==(b.y>tap.y))&&(tap.x<(b.x-a.x)*(tap.y-a.y)/(b.y-a.y+1e-9)+a.x))inside=!inside;
    }return inside;};
    const identity=panel._identitySeed;
    if(panel._edgeClippedSeed&&identity){
      const rowLike=identity.w>=.60&&identity.h<=.24;
      const columnLike=identity.h>=.60&&identity.w<=.24;
      if(rowLike||columnLike){
        for(const pad of [.025,.060]){
          const sx=rowLike?.015:Math.max(.015,identity.x-pad);
          const sy=rowLike?Math.max(.015,identity.y-pad):.015;
          const sw=rowLike?.970:Math.min(.970,identity.w+pad*2);
          const sh=rowLike?Math.min(.45,identity.h+pad*2):.970;
          const probe=rowLike
            ?{x:.50,y:Math.max(.04,Math.min(.96,identity.y+identity.h/2))}
            :{x:Math.max(.04,Math.min(.96,identity.x+identity.w/2)),y:.50};
          const seed={...panel,x:sx,y:sy,w:sw,h:sh,_tap:probe,_multiscaleSeed:true,_identityAlignedRepair:true};
          const result=this._detectSingle(img,seed,null);
          if(result&&originalInside(result._quad))trials.push({result,seed,source:`identity-${rowLike?'row':'column'}-${pad.toFixed(3)}`});
        }
      }
      const identityArea=identity.w*identity.h;
      if(!rowLike&&!columnLike&&identityArea>=.025&&identityArea<=.30&&
        identity.w<=.46&&identity.h<=.30){
        for(const factor of [1.16,1.24]){
          const sw=Math.min(.68,identity.w*factor),sh=Math.min(.58,identity.h*factor);
          const cx=identity.x+identity.w/2,cy=identity.y+identity.h/2;
          const sx=Math.max(.015,Math.min(.985-sw,cx-sw/2));
          const sy=Math.max(.015,Math.min(.985-sh,cy-sh/2));
          const seed={...panel,x:sx,y:sy,w:sw,h:sh,_tap:tap,
            _multiscaleSeed:true,_identityLocalRepair:true};
          const result=this._detectSingle(img,seed,null);
          if(result&&originalInside(result._quad))trials.push({result,seed,source:`identity-local-${factor.toFixed(2)}`});
        }
      }
    }
    const viewpointBanks=[
      {dx:-.18,dy:0,sizes:[[.38,.18],[.50,.40],[.62,.18],[.94,.14]]},
      {dx:.18,dy:0,sizes:[[.38,.18],[.50,.40],[.62,.18],[.94,.14]]},
      {dx:0,dy:-.12,sizes:[[.18,.50],[.24,.50],[.38,.22],[.62,.22],[.68,.36]]},
      {dx:0,dy:.12,sizes:[[.18,.50],[.24,.50],[.38,.22],[.62,.22],[.68,.36]]}
    ];
    const viewpointSeeds=new Set();
    for(const bank of viewpointBanks){
      const probe={x:Math.max(.04,Math.min(.96,tap.x+bank.dx)),y:Math.max(.04,Math.min(.96,tap.y+bank.dy))};
      for(const [sw,sh] of bank.sizes){
        const edgeX=probe.x>.72?.972-sw:probe.x<.28?.028:probe.x-sw/2;
        const edgeY=probe.y>.82?.972-sh:probe.y<.18?.028:probe.y-sh/2;
        const placements=[['edge',edgeX,edgeY],['center',probe.x-sw/2,probe.y-sh/2]];
        if(bank.dx)placements.push(['y34',probe.x-sw/2,probe.y-sh*.34]);
        if(bank.dy){
          placements.push(['x34',probe.x-sw*.34,probe.y-sh/2]);
          placements.push(['row',probe.x-sw/2,probe.y-sh*(bank.dy<0?.30:.70)]);
          placements.push(['row-x10',probe.x-sw*.10,probe.y-sh*(bank.dy<0?.30:.70)]);
          placements.push(['row-x90',probe.x-sw*.90,probe.y-sh*(bank.dy<0?.30:.70)]);
        }
        for(const [placement,sxBase,syBase] of placements){
          const sx=Math.max(.015,Math.min(.985-sw,sxBase));
          const sy=Math.max(.015,Math.min(.985-sh,syBase));
          const viewKey=`${probe.x.toFixed(3)}:${probe.y.toFixed(3)}:${sx.toFixed(3)}:${sy.toFixed(3)}:${sw}:${sh}`;
          if(viewpointSeeds.has(viewKey))continue;
          viewpointSeeds.add(viewKey);
          const seed={...panel,x:sx,y:sy,w:sw,h:sh,_tap:probe,_multiscaleSeed:true,_viewpointProbe:true};
          const result=this._detectSingle(img,seed,null);
          if(result&&originalInside(result._quad))trials.push({result,seed,source:`view${bank.dx>=0?'+':''}${bank.dx.toFixed(2)},${bank.dy>=0?'+':''}${bank.dy.toFixed(2)}-${sw.toFixed(2)}x${sh.toFixed(2)}-${placement}`});
        }
      }
    }
    const probes=[[-.14,0],[.14,0],[0,-.12],[0,.12]];
    for(const [dx,dy] of probes){
      const probe={x:Math.max(.04,Math.min(.96,tap.x+dx)),y:Math.max(.04,Math.min(.96,tap.y+dy))};
      const sw=.245,sh=.285;
      const sx=Math.max(.015,Math.min(.985-sw,probe.x-sw*.612));
      const sy=Math.max(.015,Math.min(.985-sh,probe.y-sh*.537));
      const seed={...panel,x:sx,y:sy,w:sw,h:sh,_tap:probe,_multiscaleSeed:true,_probeTap:true};
      const source=`probe${dx>=0?'+':''}${dx.toFixed(2)},${dy>=0?'+':''}${dy.toFixed(2)}`;
      const result=this._detectSingle(img,seed,null);
      if(result&&originalInside(result._quad))trials.push({result,seed,source});
    }
    if(!trials.length){if(log)log('LOCAL SEED RESCUE MISS no proven local loop');return primary;}

    const quadDistance=(a,b)=>a.reduce((sum,p,i)=>sum+Math.hypot(p.x-b[i].x,p.y-b[i].y),0)/4;
    for(const trial of trials){
      trial.consensus=trials.filter(other=>quadDistance(trial.result._quad,other.result._quad)<=.035).length;
      const e=trial.result._frameEnvelope||{};
      trial.absoluteArea=Math.abs(trial.result._quad.reduce((s,p,i)=>{const n=trial.result._quad[(i+1)%4];return s+p.x*n.y-n.x*p.y;},0)/2);
      trial.originalAreaRatio=trial.absoluteArea/seedArea;
      const originalCorners=[
        {x:panel.x,y:panel.y},{x:panel.x+panel.w,y:panel.y},
        {x:panel.x+panel.w,y:panel.y+panel.h},{x:panel.x,y:panel.y+panel.h}
      ];
      const cornerErrors=trial.result._quad.map((p,i)=>Math.hypot(
        (p.x-originalCorners[i].x)/Math.max(.03,panel.w),
        (p.y-originalCorners[i].y)/Math.max(.03,panel.h)
      ));
      trial.originalCornerDrift=cornerErrors.reduce((s,v)=>s+v,0)/4;
      trial.originalCornerMax=Math.max(...cornerErrors);
      trial.rank=(e.relativeAdjScore||0)*5.2+(e.confidence||0)+
        (e.seedCoverage||0)*.7+(e.familyScore||0)*.04+
        (e.weakestAdj||0)*5.0+(e.adjacencyScore||0)*2.0+
        // Thick coherent printed rails are positive evidence. The previous
        // minus sign accidentally rewarded one-pixel artwork contours.
        (e.minThickness||0)*2.0+(e.thicknessScore||0)-
        Math.abs(Math.log(Math.max(.01,e.areaRatio||1)))*.25-trial.absoluteArea*2.0;
      if(!suspiciousSeed){
        trial.rank-=Math.abs(Math.log(Math.max(.01,trial.originalAreaRatio)))*3.0;
        trial.rank-=trial.originalCornerDrift*4+trial.originalCornerMax*2;
      }
      if(trial.source==='primary'&&!suspiciousSeed)trial.rank+=.55;
    }
    trials.sort((a,b)=>b.rank-a.rank);
    if(log)log(`SEED BANK TOP ${trials.slice(0,16).map(t=>`${t.source}@${t.rank.toFixed(2)} c${t.consensus} a${t.absoluteArea.toFixed(3)} rel${(t.result._frameEnvelope?.relativeAdjScore||0).toFixed(2)} cov${(t.result._frameEnvelope?.seedCoverage||0).toFixed(2)} weak${(t.result._frameEnvelope?.weakestAdj||0).toFixed(2)} thick${(t.result._frameEnvelope?.minThickness||0).toFixed(2)} q=${t.result._quad.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}`).join(' || ')}`);
    // Page/row rescue is cell selection. If several candidates have four
    // adequately supported separators, the smallest complete tap-containing
    // cell wins over a union of neighboring cells. When no such cell exists,
    // ordinary evidence ranking remains the fallback.
    const isDarkArtworkCell=(t)=>{
      const e=t.result._frameEnvelope||{};
      return t.consensus>=3&&(e.adjacencyScore||0)>=.30&&
        (e.relativeAdjScore||0)>=.85&&(e.weakestAdj||0)>=.06&&
        (e.minThickness||0)>=.78&&(e.seedCoverage||0)>=.88;
    };
    const completeCells=suspiciousSeed?trials.filter(t=>{
      const e=t.result._frameEnvelope||{};
      const xs=t.result._quad.map(p=>p.x),ys=t.result._quad.map(p=>p.y);
      const spanX=Math.max(...xs)-Math.min(...xs),spanY=Math.max(...ys)-Math.min(...ys);
      const pagePerimeter=(spanX>=.80||spanY>=.80)&&
        (Math.min(...xs)<=.08||Math.max(...xs)>=.92||Math.min(...ys)<=.08||Math.max(...ys)>=.92);
      const normalCell=(e.weakestAdj||0)>=.20&&(e.relativeAdjScore||0)>=.72;
      const darkArtworkCell=isDarkArtworkCell(t);
      const perimeterCell=pagePerimeter&&t.consensus>=3&&
        (e.weakestAdj||0)>=.12&&(e.relativeAdjScore||0)>=.90;
      const nearL=Math.min(...xs)<=.08,nearR=Math.max(...xs)>=.92;
      const nearT=Math.min(...ys)<=.08,nearB=Math.max(...ys)>=.92;
      const cornerEdgeCell=(nearL||nearR)&&(nearT||nearB)&&t.consensus>=2&&
        (e.adjacencyScore||0)>=.50&&(e.weakestAdj||0)>=.25&&
        (e.relativeAdjScore||0)>=.90&&(e.minThickness||0)>=.50;
      return t.absoluteArea>=.040&&t.absoluteArea<=.50&&
        (normalCell||darkArtworkCell||perimeterCell||cornerEdgeCell)&&
        ((e.minThickness||0)>=.66||cornerEdgeCell);
    }):[];
    const maxCompleteWeak=Math.max(0,...completeCells.map(t=>t.result._frameEnvelope?.weakestAdj||0));
    const supportedCompleteCells=completeCells.filter(t=>isDarkArtworkCell(t)||
      (t.result._frameEnvelope?.weakestAdj||0)>=Math.max(.12,maxCompleteWeak-.30));
    supportedCompleteCells.sort((a,b)=>{
      if(isDarkArtworkCell(a)&&isDarkArtworkCell(b)&&
        Math.max(a.absoluteArea,b.absoluteArea)/Math.max(.001,Math.min(a.absoluteArea,b.absoluteArea))<=1.35)return b.rank-a.rank;
      return a.absoluteArea-b.absoluteArea||b.rank-a.rank;
    });
    let completeChoice=supportedCompleteCells[0]||null;
    if(completeChoice){
      const bbox=(t)=>{const q=t.result._quad,x=q.map(p=>p.x),y=q.map(p=>p.y);return{l:Math.min(...x),r:Math.max(...x),t:Math.min(...y),b:Math.max(...y)};};
      const smallBox=bbox(completeChoice),smallWeak=completeChoice.result._frameEnvelope?.weakestAdj||0;
      const outer=supportedCompleteCells.filter(t=>{
        if(t===completeChoice||t.absoluteArea<=completeChoice.absoluteArea||t.absoluteArea>completeChoice.absoluteArea*1.46)return false;
        const big=bbox(t),matches=[Math.abs(big.l-smallBox.l),Math.abs(big.r-smallBox.r),
          Math.abs(big.t-smallBox.t),Math.abs(big.b-smallBox.b)].filter(d=>d<=.055).length;
        const contains=big.l<=smallBox.l+.025&&big.r>=smallBox.r-.025&&big.t<=smallBox.t+.025&&big.b>=smallBox.b-.025;
        const corroborated=t.consensus>=Math.max(3,completeChoice.consensus);
        return matches>=3&&contains&&corroborated&&(t.result._frameEnvelope?.weakestAdj||0)>=smallWeak-.08;
      }).sort((a,b)=>b.absoluteArea-a.absoluteArea||b.consensus-a.consensus||b.rank-a.rank);
      if(outer[0])completeChoice=outer[0];
      const choiceWeak=completeChoice.result._frameEnvelope?.weakestAdj||0;
      const decisive=supportedCompleteCells.filter(t=>{
        if(t===completeChoice||t.absoluteArea<=completeChoice.absoluteArea)return false;
        const ratio=t.absoluteArea/Math.max(.001,completeChoice.absoluteArea);
        const weak=t.result._frameEnvelope?.weakestAdj||0;
        const nestedDominance=ratio<=1.90&&t.consensus>=Math.max(8,completeChoice.consensus*4)&&t.rank>=completeChoice.rank+.50;
        const compactRescue=!!panel._geometryOnlyRescue&&completeChoice.absoluteArea<=.12&&ratio<=5.50&&
          t.consensus>=Math.max(12,completeChoice.consensus*2.2)&&t.rank>=completeChoice.rank+.25&&weak>=choiceWeak+.04;
        return (nestedDominance||compactRescue)&&(t.result._frameEnvelope?.relativeAdjScore||0)>=.85&&
          weak>=.15&&(t.result._frameEnvelope?.minThickness||0)>=.75;
      }).sort((a,b)=>b.consensus-a.consensus||b.rank-a.rank);
      if(decisive[0])completeChoice=decisive[0];
      if(log)log(`COMPLETE CELL candidates=${completeCells.length}/${supportedCompleteCells.length} outer=${outer.length} chosen=${completeChoice.source} area=${completeChoice.absoluteArea.toFixed(3)}`);
    }
    const perimeterFallback=suspiciousSeed?trials.filter(t=>{
      const e=t.result._frameEnvelope||{},xs=t.result._quad.map(p=>p.x),ys=t.result._quad.map(p=>p.y);
      const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      const spansPage=(maxX-minX>=.80&&minX<=.08&&maxX>=.92)||(maxY-minY>=.80&&minY<=.08&&maxY>=.92);
      return !(panel._edgeClippedSeed&&t.source==='primary')&&spansPage&&t.absoluteArea>=.040&&t.absoluteArea<=.68&&
        t.consensus>=2&&(e.weakestAdj||0)>=.10&&(e.relativeAdjScore||0)>=.55&&(e.minThickness||0)>=.10;
    }):[];
    perimeterFallback.sort((a,b)=>b.absoluteArea-a.absoluteArea||b.rank-a.rank);
    const identityRepairs=trials.filter(t=>t.seed?._identityAlignedRepair).filter(t=>{
      const q=t.result._quad,xs=q.map(p=>p.x),ys=q.map(p=>p.y),spanX=Math.max(...xs)-Math.min(...xs),spanY=Math.max(...ys)-Math.min(...ys);
      return identity.w>=.60&&identity.h<=.24?spanX>=.80:spanY>=.80;
    }).sort((a,b)=>a.absoluteArea-b.absoluteArea||b.rank-a.rank);
    const localIdentityRepairs=identity?trials.filter(t=>t.seed?._identityLocalRepair).filter(t=>{
      const e=t.result._frameEnvelope||{},ratio=t.absoluteArea/Math.max(.001,identity.w*identity.h);
      return ratio>=.75&&ratio<=1.85&&(e.relativeAdjScore||0)>=.80&&(e.adjacencyScore||0)>=.14&&
        (e.minThickness||0)>=.72&&(e.seedCoverage||0)>=.88;
    }).sort((a,b)=>(b.result._frameEnvelope?.adjacencyScore||0)-(a.result._frameEnvelope?.adjacencyScore||0)||b.consensus-a.consensus||b.rank-a.rank):[];
    const structuralPrimary=panel._structuralCompositeSeed&&!panel._edgeClippedSeed&&seedArea>=.45?trials.find(t=>t.source==='primary'):null;
    if(log&&identity)log(`IDENTITY REPAIR candidates=${localIdentityRepairs.length} aligned=${identityRepairs.length}`);
    const chosen=identityRepairs[0]||localIdentityRepairs[0]||completeChoice||structuralPrimary||perimeterFallback[0]||trials[0];
    chosen.result._frameEnvelope.multiscaleSeedRescue=true;
    chosen.result._frameEnvelope.seedConsensus=chosen.consensus;
    chosen.result._frameEnvelope.seedSource=chosen.source;
    if(log){
      const e=chosen.result._frameEnvelope;
      log(`LOCAL SEED RESCUE HIT trials=${trials.length} source=${chosen.source} consensus=${chosen.consensus}/${trials.length} rel=${(e.relativeAdjScore||0).toFixed(2)} rank=${chosen.rank.toFixed(2)}`);
      log(`RELATIVE FAMILY HIT adj=${(e.adjSides||[]).map(v=>v.toFixed(2)).join('/')} quad=${chosen.result._quad.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' | ')}`);
    }
    return chosen.result;
  },

  _detectSingle(img, panel, log) {
    const maxDim=900;
    const scale=Math.min(1,maxDim/Math.max(img.width,img.height));
    const w=Math.max(1,Math.round(img.width*scale));
    const h=Math.max(1,Math.round(img.height*scale));
    let lum,smooth;
    const cached=img._nthFrameLumCache;
    if(cached&&cached.width===w&&cached.height===h&&cached.lum?.length===w*h){
      lum=cached.lum;
      smooth=cached.smooth;
    }else{
      const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(img,0,0,w,h);
      const rgba=ctx.getImageData(0,0,w,h).data;
      lum=new Uint8Array(w*h);
      for(let i=0,j=0;i<rgba.length;i+=4,j++) lum[j]=Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);
    }
    // V2.79.03: every rail hypothesis repeatedly asks for the same five-pixel
    // cross average at the same integer coordinates. Precompute those exact
    // values once per decoded page so each later sample is one lookup instead
    // of five luminance reads and four additions. Float32 preserves the
    // previous fractional average and therefore all existing thresholds.
    if(!smooth||smooth.length!==w*h){
      smooth=new Float32Array(w*h);
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        smooth[y*w+x]=(lum[(y-1)*w+x]+lum[y*w+x]+lum[(y+1)*w+x]+
          lum[y*w+x-1]+lum[y*w+x+1])/5;
      }
    }
    try{img._nthFrameLumCache={width:w,height:h,lum,smooth};}catch(_){/* correctness unchanged */}
    let wasmRailKernel=false;
    try{
      wasmRailKernel=typeof PanelFrameWasm!=='undefined'&&PanelFrameWasm.ready===true&&
        PanelFrameWasm.begin(smooth,w,h)===true;
    }catch(_){wasmRailKernel=false;}

    const x0=Math.max(2,Math.round(panel.x*w));
    const y0=Math.max(2,Math.round(panel.y*h));
    const x1=Math.min(w-3,Math.round((panel.x+panel.w)*w)-1);
    const y1=Math.min(h-3,Math.round((panel.y+panel.h)*h)-1);
    const rw=x1-x0+1,rh=y1-y0+1;
    if(rw<30||rh<30)return null;

    const tap=panel._tap||{x:panel.x+panel.w/2,y:panel.y+panel.h/2};
    const tx=Math.max(2,Math.min(w-3,tap.x*(w-1)));
    const ty=Math.max(2,Math.min(h-3,tap.y*(h-1)));
    if(log)log(`CHAIN RAIL start tap=${tx.toFixed(1)},${ty.toFixed(1)} seed=${x0},${y0}-${x1},${y1}`);

    const pixelLum=(x,y)=>{
      x=Math.max(1,Math.min(w-2,Math.round(x))); y=Math.max(1,Math.min(h-2,Math.round(y)));
      return smooth[y*w+x];
    };
    const rawLum=(x,y)=>{
      x=Math.max(0,Math.min(w-1,Math.round(x))); y=Math.max(0,Math.min(h-1,Math.round(y)));
      return lum[y*w+x];
    };

    // V2.78.18: generate several plausible finite rails for each side instead
    // of independently choosing one "best" line.  A later family search picks
    // the four rails that actually close into one coherent enclosure around
    // the tap. V2.78.18 adds a second stage that compares every valid closed
    // family and prefers the outermost panel-scale enclosure rather than the
    // single highest-scoring local loop.
    const railCandidates=(kind)=>{
      const horizontal=kind==='top'||kind==='bottom';
      const negative=kind==='top'||kind==='left';
      const seedCross=kind==='top'?y0:kind==='bottom'?y1:kind==='left'?x0:x1;
      const tapCross=horizontal?ty:tx;
      const along0=horizontal?x0:y0, along1=horizontal?x1:y1;
      const alongSpan=horizontal?rw:rh, crossSpan=horizontal?rh:rw;
      const dimAlong=horizontal?w:h, dimCross=horizontal?h:w;
      const outward=Math.max(22,Math.min(dimCross*.20,crossSpan*.92));
      const inward=Math.max(4,crossSpan*.08);
      const anchorLo=negative?seedCross-outward:seedCross-inward;
      const anchorHi=negative?seedCross+inward:seedCross+outward;
      const a0=Math.max(2,Math.round(along0-alongSpan*.12));
      const a1=Math.min(dimAlong-3,Math.round(along1+alongSpan*.12));
      const step=Math.max(2,Math.round((a1-a0)/120));
      const pool=[];

      const evaluateJs=(m,anchor)=>{
        const b=anchor-m*(horizontal?tx:ty);
        const atTap=m*(horizontal?tx:ty)+b;
        if(negative&&atTap>=tapCross-4)return null;
        if(!negative&&atTap<=tapCross+4)return null;
        if(negative&&atTap>seedCross+inward)return null;
        if(!negative&&atTap<seedCross-inward)return null;
        let n=0,dark=0,strong=0,longest=0,run=0,segments=0,inSeg=false;
        let bestStart=null,bestEnd=null,segmentStart=null,lastSegmentDark=null,bestLen=-1;
        let contrastHits=0,balancedHits=0,contrastSum=0;
        const contrastOffset=Math.max(3,Math.min(8,Math.round(crossSpan*.025)));
        const maxGap=Math.max(step*3,8);
        for(let a=a0;a<=a1;a+=step){
          const p=m*a+b;
          if(p<2||p>=dimCross-2){run=0;inSeg=false;continue;}
          // This is the hottest path in the detector. `a` is already an
          // in-bounds integer, so index the precomputed cross-average buffer
          // directly and round/clamp only the changing cross coordinate.
          const pc=Math.max(1,Math.min(dimCross-2,Math.round(p)));
          const pa=Math.max(1,Math.min(dimCross-2,Math.round(p-contrastOffset)));
          const pb=Math.max(1,Math.min(dimCross-2,Math.round(p+contrastOffset)));
          const v=horizontal?smooth[pc*w+a]:smooth[a*w+pc]; n++;
          const va=horizontal?smooth[pa*w+a]:smooth[a*w+pa];
          const vb=horizontal?smooth[pb*w+a]:smooth[a*w+pb];
          const ca=va-v,cb=vb-v,contrast=(ca+cb)/2;
          if(contrast>=10)contrastHits++;
          if(ca>=6&&cb>=6)balancedHits++;
          contrastSum+=Math.max(0,Math.min(80,contrast))/80;
          if(v<=172){dark++;run++;if(run>longest)longest=run;if(!inSeg){segments++;inSeg=true;}}else{run=0;inSeg=false;}
          if(v<=112)strong++;
          // V2.78's finite-span pass used to sample the identical pixel a
          // second time. Fold its <=178 segment accounting into this pass.
          if(v<=178){
            if(segmentStart===null||(lastSegmentDark!==null&&a-lastSegmentDark>maxGap))segmentStart=a;
            lastSegmentDark=a;
            const len=lastSegmentDark-segmentStart;
            if(len>bestLen){bestLen=len;bestStart=segmentStart;bestEnd=lastSegmentDark;}
          }
        }
        if(n<16)return null;
        const support=dark/n, continuity=longest/n, strongRate=strong/n;
        if(support<.33||continuity<.17)return null;
        const outwardDist=negative?seedCross-atTap:atTap-seedCross;
        const nearestPenalty=Math.max(0,outwardDist)/Math.max(25,outward)*.30;
        const fragmentationPenalty=Math.max(0,segments-4)*.032;
        const contrastRate=contrastHits/n,balancedRate=balancedHits/n,contrastMean=contrastSum/n;
        const score=support*2.30+continuity*1.75+strongRate*.45+
          contrastRate*.90+balancedRate*.55+contrastMean*.70-nearestPenalty-fragmentationPenalty;

        if(bestStart===null||bestEnd===null||bestEnd-bestStart<Math.max(12,alongSpan*.15))return null;
        return {kind,horizontal,m,b,anchor,atTap,support,continuity,strongRate,
          contrastRate,balancedRate,contrastMean,segments,score,
          span0:bestStart,span1:bestEnd,spanLen:bestEnd-bestStart};
      };

      const evaluate=(m,anchor)=>{
        if(wasmRailKernel){
          try{
            const c=PanelFrameWasm.evaluate(horizontal,negative,w,h,tx,ty,
              tapCross,seedCross,outward,inward,a0,a1,step,crossSpan,alongSpan,m,anchor);
            return c?{kind,horizontal,m,b:c.b,anchor,atTap:c.atTap,
              support:c.support,continuity:c.continuity,strongRate:c.strongRate,
              contrastRate:c.contrastRate,balancedRate:c.balancedRate,
              contrastMean:c.contrastMean,segments:c.segments,score:c.score,
              span0:c.span0,span1:c.span1,spanLen:c.spanLen}:null;
          }catch(error){
            wasmRailKernel=false;
            if(log)log(`WASM RAIL FALLBACK ${error?.message||error}`);
          }
        }
        return evaluateJs(m,anchor);
      };

      const slopeLimit=.46;
      for(let m=-slopeLimit;m<=slopeLimit+1e-9;m+=.040){
        for(let anchor=anchorLo;anchor<=anchorHi;anchor+=4){
          const c=evaluate(m,anchor); if(c)pool.push(c);
        }
      }
      pool.sort((a,b)=>b.score-a.score);
      const edgeSeed=seedCross<=dimCross*.08||seedCross>=dimCross*.92;
      const edgeAxisNear=edgeSeed?[...pool].filter(c=>Math.abs(c.m)<=.10).sort((a,b)=>
        Math.abs(a.atTap-seedCross)-Math.abs(b.atTap-seedCross)||b.score-a.score
      ).slice(0,4):[];
      const shortlist=edgeSeed?[...pool.slice(0,14),...edgeAxisNear,...[...pool].sort((a,b)=>
        Math.abs(a.atTap-seedCross)-Math.abs(b.atTap-seedCross)||b.score-a.score
      ).slice(0,8)]:pool;
      const kept=[];
      for(const c of shortlist){
        if(kept.some(k=>Math.abs(k.atTap-c.atTap)<7 && Math.abs(k.m-c.m)<.045))continue;
        kept.push(c);
        if(kept.length>=(edgeSeed?22:18))break;
      }
      // Fine-refit only the retained hypotheses.
      for(let i=0;i<kept.length;i++){
        let best=kept[i];
        for(let m=Math.max(-slopeLimit,best.m-.05);m<=Math.min(slopeLimit,best.m+.05)+1e-9;m+=.008){
          for(let anchor=best.anchor-8;anchor<=best.anchor+8;anchor+=2){
            const c=evaluate(m,anchor); if(c&&c.score>best.score)best=c;
          }
        }
        kept[i]=best;
      }
      kept.sort((a,b)=>b.score-a.score);
      const refinedEdgeAxisNear=edgeSeed?[...kept].filter(c=>Math.abs(c.m)<=.12).sort((a,b)=>
        Math.abs(a.atTap-seedCross)-Math.abs(b.atTap-seedCross)||b.score-a.score
      ).slice(0,3):[];
      const finalists=edgeSeed?[...kept.slice(0,10),...refinedEdgeAxisNear,...[...kept].sort((a,b)=>
        Math.abs(a.atTap-seedCross)-Math.abs(b.atTap-seedCross)||b.score-a.score
      ).slice(0,6)]:kept;
      const distinct=[];
      for(const c of finalists){
        if(distinct.some(k=>Math.abs(k.atTap-c.atTap)<5 && Math.abs(k.m-c.m)<.035))continue;
        distinct.push(c);
        if(distinct.length>=(edgeSeed?14:12))break;
      }
      kept.length=0;
      kept.push(...distinct);
      if(log)log(`CHAIN ${kind} candidates=${kept.length}${kept[0]?` best@tap=${kept[0].atTap.toFixed(1)} m=${kept[0].m.toFixed(3)} sup=${kept[0].support.toFixed(2)}`:''}`);
      return kept;
    };

    const tops=railCandidates('top'), bottoms=railCandidates('bottom'), lefts=railCandidates('left'), rights=railCandidates('right');
    if(!tops.length||!bottoms.length||!lefts.length||!rights.length){
      if(log)log(`CHAIN MISS candidate sides=${[tops,bottoms,lefts,rights].filter(a=>a.length).length}/4`);
      return null;
    }

    const intersect=(hl,vl)=>{
      const den=1-hl.m*vl.m;
      if(Math.abs(den)<.08)return null;
      const x=(vl.m*hl.b+vl.b)/den;
      return {x,y:hl.m*x+hl.b};
    };


    const alongAt=(rail,p)=>rail.horizontal?p.x:p.y;
    const basePad=(rail)=>Math.max(8,Math.min(22,rail.spanLen*.07));
    const overrun=(rail,p)=>{
      const crossDim=rail.horizontal?h:w;
      if(rail.atTap<=crossDim*.06||rail.atTap>=crossDim*.94)return 0;
      const a=alongAt(rail,p),pad=basePad(rail);
      if(a<rail.span0-pad)return rail.span0-a-pad;
      if(a>rail.span1+pad)return a-rail.span1-pad;
      return 0;
    };
    const endpointFor=(rail,p)=>{
      const a=alongAt(rail,p);
      const ea=Math.abs(a-rail.span0)<=Math.abs(a-rail.span1)?rail.span0:rail.span1;
      return rail.horizontal?{x:ea,y:rail.m*ea+rail.b}:{x:rail.m*ea+rail.b,y:ea};
    };
    const endpointInk=(rail,ep)=>{
      let hit=0,n=0;
      for(let d=-8;d<=8;d+=2){
        const a=(rail.horizontal?ep.x:ep.y)+d;
        const c=rail.m*a+rail.b;
        const x=rail.horizontal?a:c,y=rail.horizontal?c:a;
        if(x>=2&&x<w-2&&y>=2&&y<h-2){hit+=pixelLum(x,y)<=180?1:0;n++;}
      }
      return n?hit/n:0;
    };
    const cornerFit=(ra,rb,p)=>{
      if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return null;
      const oa=overrun(ra,p),ob=overrun(rb,p);
      const ea=endpointFor(ra,p),eb=endpointFor(rb,p);
      const da=Math.hypot(p.x-ea.x,p.y-ea.y),db=Math.hypot(p.x-eb.x,p.y-eb.y);
      const gap=Math.hypot(ea.x-eb.x,ea.y-eb.y);
      const bridgeMax=Math.max(10,Math.min(34,Math.min(rw,rh)*.11));
      const totalMax=Math.max(18,Math.min(54,Math.min(rw,rh)*.18));
      const ia=endpointInk(ra,ea),ib=endpointInk(rb,eb);
      const direct=oa<=0&&ob<=0;
      const bridged=!direct && da<=bridgeMax && db<=bridgeMax && gap<=totalMax && ia>=.30 && ib>=.30;
      if(!direct&&!bridged)return null;
      // Family score favors literal contact, short endpoint gaps and real endpoint ink.
      const penalty=(da+db)/Math.max(1,bridgeMax)*.28 + gap/Math.max(1,totalMax)*.20;
      return {direct,bridged,da,db,gap,ia,ib,score:(direct?.70:.35)+(ia+ib)*.22-penalty};
    };

    // V2.78.20 SIDE-RELATIVE RAIL PROOF
    // A rail is more believable as a panel separator when the dark rail itself
    // persists while BOTH immediate flanks belong to image regions rather than
    // simply continuing the same dark artwork stroke.  This is a ranking signal
    // only: it cannot manufacture a rail or bypass the closed-loop safeguards.
    const railAdjacency=(rail)=>{
      if(rail._adjacency)return rail._adjacency;
      const start=rail.span0,end=rail.span1;
      const step=Math.max(3,Math.round((end-start)/54));
      const off=Math.max(4,Math.min(10,Math.round(Math.min(rw,rh)*.025)));
      let n=0,sep=0,contrast=0,balanced=0;
      for(let a=start;a<=end;a+=step){
        let x,y,nx,ny;
        if(rail.horizontal){
          x=a;y=rail.m*a+rail.b;
          const d=Math.sqrt(1+rail.m*rail.m); nx=-rail.m/d; ny=1/d;
        }else{
          y=a;x=rail.m*a+rail.b;
          const d=Math.sqrt(1+rail.m*rail.m); nx=1/d; ny=-rail.m/d;
        }
        if(x<off+2||x>w-off-3||y<off+2||y>h-off-3)continue;
        const c=pixelLum(x,y), a1=pixelLum(x+nx*off,y+ny*off), a2=pixelLum(x-nx*off,y-ny*off);
        n++;
        const d1=a1-c,d2=a2-c;
        if(c<=178 && d1>=10 && d2>=10)sep++;
        contrast+=Math.max(0,Math.min(90,(d1+d2)/2))/90;
        // Both sides should be plausible neighboring regions. Penalize cases
        // where only one flank becomes lighter (common for an artwork edge).
        if(d1>=8&&d2>=8) balanced+=1-Math.min(1,Math.abs(d1-d2)/120);
      }
      if(!n)return (rail._adjacency={score:0,separator:0,contrast:0,balanced:0});
      const separator=sep/n, con=contrast/n, bal=balanced/n;
      return (rail._adjacency={score:separator*.52+con*.28+bal*.20,separator,contrast:con,balanced:bal});
    };
    // A true printed gutter is normally a band, not a single-pixel stroke.
    // Measure ink width across each retained rail's normal. This distinguishes
    // panel borders from long artwork contours that happen to close a loop.
    const railThickness=(rail)=>{
      if(rail._thickness)return rail._thickness;
      const start=rail.span0,end=rail.span1;
      const step=Math.max(3,Math.round((end-start)/46));
      let n=0,bandSum=0,runSum=0;
      for(let a=start;a<=end;a+=step){
        let x,y,nx,ny;
        if(rail.horizontal){
          x=a;y=rail.m*a+rail.b;
          const d=Math.sqrt(1+rail.m*rail.m);nx=-rail.m/d;ny=1/d;
        }else{
          y=a;x=rail.m*a+rail.b;
          const d=Math.sqrt(1+rail.m*rail.m);nx=1/d;ny=-rail.m/d;
        }
        if(x<7||x>w-8||y<7||y>h-8)continue;
        let strong=0,longest=0,run=0;
        for(let off=-5;off<=5;off++){
          if(rawLum(x+nx*off,y+ny*off)<=108){strong++;run++;longest=Math.max(longest,run);}
          else run=0;
        }
        n++;bandSum+=strong/11;runSum+=Math.min(1,longest/6);
      }
      if(!n)return (rail._thickness={score:0,band:0,run:0});
      const band=bandSum/n,run=runSum/n;
      return (rail._thickness={score:band*.45+run*.55,band,run});
    };
    const sideAdjMax={
      top:Math.max(...tops.map(r=>railAdjacency(r).score)),
      right:Math.max(...rights.map(r=>railAdjacency(r).score)),
      bottom:Math.max(...bottoms.map(r=>railAdjacency(r).score)),
      left:Math.max(...lefts.map(r=>railAdjacency(r).score))
    };
    const relativeAdjacency=(rail,absolute)=>{
      const pageEdge=
        (rail.kind==='top'&&rail.atTap<=h*.06)||
        (rail.kind==='bottom'&&rail.atTap>=h*.94)||
        (rail.kind==='left'&&rail.atTap<=w*.06)||
        (rail.kind==='right'&&rail.atTap>=w*.94);
      if(pageEdge)return 1;
      const best=sideAdjMax[rail.kind]||0;
      if(best<.18)return 1;
      return Math.max(0,Math.min(1,absolute/Math.max(.001,best)));
    };

    // CHAIN-CONNECTED FAMILY SEARCH:
    // top -> right -> bottom -> left -> back to top.  We score complete loops,
    // not isolated rails.  Thus a very strong far-away right rail cannot win if
    // it does not connect to the same top and bottom family as the other sides.
    const families=[];
    for(const top of tops)for(const right of rights){
      const q1=intersect(top,right), c1=cornerFit(top,right,q1); if(!c1)continue;
      for(const bottom of bottoms){
        const q2=intersect(bottom,right), c2=cornerFit(bottom,right,q2); if(!c2)continue;
        for(const left of lefts){
          const q3=intersect(bottom,left), c3=cornerFit(bottom,left,q3); if(!c3)continue;
          const q0=intersect(top,left), c0=cornerFit(top,left,q0); if(!c0)continue;
          const q=[q0,q1,q2,q3];
          if(q.some(p=>p.x<-10||p.x>w+10||p.y<-10||p.y>h+10))continue;
          const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
          const cs=[cross(q[0],q[1],q[2]),cross(q[1],q[2],q[3]),cross(q[2],q[3],q[0]),cross(q[3],q[0],q[1])];
          if(!(cs.every(v=>v>0)||cs.every(v=>v<0)))continue;
          const pointInPoly=(x,y,poly)=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y+1e-9)+a.x))inside=!inside;}return inside;};
          if(!pointInPoly(tx,ty,q))continue;
          const area=Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%4];return s+p.x*n.y-n.x*p.y;},0)/2);
          const areaRatio=area/(rw*rh);
          if(areaRatio<.52||areaRatio>1.95)continue;
          const sc=[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
          const drift=q.reduce((sum,p,i)=>sum+Math.hypot(p.x-sc[i].x,p.y-sc[i].y),0)/4;
          const railScore=top.score+right.score+bottom.score+left.score;
          const cornerScore=c0.score+c1.score+c2.score+c3.score;
          const adj=[railAdjacency(top),railAdjacency(right),railAdjacency(bottom),railAdjacency(left)];
          const adjacencyScore=adj.reduce((z,a)=>z+a.score,0)/4;
          const weakestAdj=Math.min(...adj.map(a=>a.score));
          const thickness=[railThickness(top),railThickness(right),railThickness(bottom),railThickness(left)];
          const avgThickness=thickness.reduce((z,t)=>z+t.score,0)/4;
          const minThickness=Math.min(...thickness.map(t=>t.score));
          const relativeAdjScore=(
            relativeAdjacency(top,adj[0].score)+
            relativeAdjacency(right,adj[1].score)+
            relativeAdjacency(bottom,adj[2].score)+
            relativeAdjacency(left,adj[3].score)
          )/4;
          const areaPenalty=Math.abs(Math.log(Math.max(.001,areaRatio)))*.55;
          const driftPenalty=drift/Math.max(14,Math.min(rw,rh)*.16);
          // One weak side is exactly how an artwork edge completes a false
          // loop. Balanced four-side separator evidence gets real authority.
          const score=railScore+cornerScore+adjacencyScore*1.35+weakestAdj*2.20+
            relativeAdjScore*3.20+avgThickness*.80+minThickness*1.20-areaPenalty-driftPenalty;

          // Panel-scale evidence: sample the stable seed interior. A tiny local
          // quadrilateral can contain the tap yet cover very little of the
          // detector's panel seed; a whole-frame candidate should explain much
          // more of that seed. This is only a ranking signal, not ownership.
          let seedInside=0,seedN=0;
          for(let gy=1;gy<=5;gy++)for(let gx=1;gx<=5;gx++){
            const sx=x0+(rw*gx/6), sy=y0+(rh*gy/6); seedN++;
            if(pointInPoly(sx,sy,q))seedInside++;
          }
          const seedCoverage=seedN?seedInside/seedN:0;
          if(seedCoverage<.36)continue;

          families.push({top,right,bottom,left,q,corners:[c0,c1,c2,c3],area,areaRatio,score,drift,seedCoverage,railScore,cornerScore,adj,adjacencyScore,weakestAdj,relativeAdjScore,thickness,avgThickness,minThickness});
        }
      }
    }
    if(!families.length){if(log)log('OUTER LOOP MISS no closed rail family around tap');return null;}

    // V2.78.20 SIDE-RELATIVE CLOSED-FAMILY SELECTION
    // Keep only structurally credible families near the best evidence score,
    // then prefer the largest enclosure. This prevents a beautifully connected
    // little internal loop from beating the real outer panel frame merely
    // because its ink is locally cleaner. We still cap area/drift above, so a
    // distant page-border loop cannot win simply by being huge.
    families.sort((a,b)=>b.score-a.score);
    const bestScore=families[0].score;
    const credible=families.filter(f=>f.score>=bestScore-.48 && f.seedCoverage>=.44);
    const pool=(credible.length?credible:families.slice(0,Math.min(8,families.length)));
    pool.sort((a,b)=>{
      const scoreDelta=b.score-a.score;
      if(Math.abs(scoreDelta)>.45)return scoreDelta;
      const driftDelta=a.drift-b.drift;
      if(Math.abs(driftDelta)>2)return driftDelta;
      const areaDelta=b.areaRatio-a.areaRatio;
      if(Math.abs(areaDelta)>.055)return areaDelta;
      const coverageDelta=b.seedCoverage-a.seedCoverage;
      if(Math.abs(coverageDelta)>.06)return coverageDelta;
      return b.score-a.score;
    });
    const family=pool[0];
    if(log)log(`ADJ LOOP candidates=${families.length} credible=${credible.length} bestScore=${bestScore.toFixed(2)} chosenArea=${family.areaRatio.toFixed(2)} coverage=${family.seedCoverage.toFixed(2)} adj=${family.adjacencyScore.toFixed(2)} rel=${family.relativeAdjScore.toFixed(2)} weak=${family.weakestAdj.toFixed(2)} thick=${family.minThickness.toFixed(2)}/${family.avgThickness.toFixed(2)} score=${family.score.toFixed(2)}`);

    const {top,right,bottom,left}=family;
    const rails=[top,bottom,left,right];
    const q=family.q;
    if(log)log(`ADJ LOOP FAMILY HIT score=${family.score.toFixed(2)} area=${family.areaRatio.toFixed(2)} coverage=${family.seedCoverage.toFixed(2)} drift=${family.drift.toFixed(1)} adj=${family.adj.map(a=>a.score.toFixed(2)).join('/')} thick=${family.thickness.map(t=>t.score.toFixed(2)).join('/')} rails=${[top,right,bottom,left].map(r=>`${r.kind}@${r.atTap.toFixed(1)}`).join(' -> ')}`);
    const finitePairs=[[top,left],[top,right],[bottom,right],[bottom,left]];
    const bridgeMeta=[];
    for(let i=0;i<4;i++){
      const [ra,rb]=finitePairs[i], p=q[i];
      const oa=overrun(ra,p),ob=overrun(rb,p);
      const ea=endpointFor(ra,p),eb=endpointFor(rb,p);
      const da=Math.hypot(p.x-ea.x,p.y-ea.y),db=Math.hypot(p.x-eb.x,p.y-eb.y);
      const endpointGap=Math.hypot(ea.x-eb.x,ea.y-eb.y);
      const bridgeMax=Math.max(10,Math.min(34,Math.min(rw,rh)*.11));
      const totalMax=Math.max(18,Math.min(54,Math.min(rw,rh)*.18));
      const ia=endpointInk(ra,ea),ib=endpointInk(rb,eb);
      const direct=oa<=0&&ob<=0;
      const bridged=!direct && da<=bridgeMax && db<=bridgeMax && endpointGap<=totalMax && ia>=.32 && ib>=.32;
      bridgeMeta[i]={direct,bridged,da,db,endpointGap,ia,ib,bridgeMax,totalMax};
      if(log)log(`CHAIN corner ${i} raw=${p.x.toFixed(1)},${p.y.toFixed(1)} direct=${direct?'Y':'N'} proj=${da.toFixed(1)}/${db.toFixed(1)} gap=${endpointGap.toFixed(1)} ink=${ia.toFixed(2)}/${ib.toFixed(2)} max=${bridgeMax.toFixed(1)}`);
      if(!direct&&!bridged){if(log)log(`CHAIN LOOP MISS corner-${i} endpoints do not converge`);return null;}
    }

    // Direct corners still require ink right up to the intersection. For a
    // V2.78.18 short-bridged corner, endpoint convergence replaces that literal
    // intersection-ink requirement; the vertex remains the SAME two-rail
    // intersection and is never independently snapped to unrelated artwork.
    const armSupport=(corner,hRail,vRail)=>{
      const radius=Math.max(6,Math.min(18,Math.round(Math.min(rw,rh)*.06)));
      let hs=0,hn=0,vs=0,vn=0;
      for(let d=-radius;d<=radius;d+=2){
        const x=corner.x+d, yh=hRail.m*x+hRail.b;
        if(x>=2&&x<w-2&&yh>=2&&yh<h-2){hs+=pixelLum(x,yh)<=178?1:0;hn++;}
        const y=corner.y+d, xv=vRail.m*y+vRail.b;
        if(y>=2&&y<h-2&&xv>=2&&xv<w-2){vs+=pixelLum(xv,y)<=178?1:0;vn++;}
      }
      return {h:hn?hs/hn:0,v:vn?vs/vn:0};
    };
    const pairs=[[top,left],[top,right],[bottom,right],[bottom,left]];
    for(let i=0;i<4;i++){
      const p=q[i];
      if(p.x<-8||p.x>w+8||p.y<-8||p.y>h+8){if(log)log(`CHAIN RAIL MISS corner-${i} outside`);return null;}
      const a=armSupport(p,pairs[i][0],pairs[i][1]);
      const bm=bridgeMeta[i];
      if(log)log(`CHAIN corner ${i} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} arms=${a.h.toFixed(2)}/${a.v.toFixed(2)} mode=${bm.bridged?'BRIDGED':'DIRECT'}`);
      if(!bm.bridged && (a.h<.28||a.v<.28)){if(log)log(`CHAIN LOOP MISS corner-${i} disconnected`);return null;}
    }

    const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    const cs=[cross(q[0],q[1],q[2]),cross(q[1],q[2],q[3]),cross(q[2],q[3],q[0]),cross(q[3],q[0],q[1])];
    if(!(cs.every(v=>v>0)||cs.every(v=>v<0))){if(log)log('CHAIN RAIL MISS non-convex');return null;}

    const area=Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%4];return s+p.x*n.y-n.x*p.y;},0)/2);
    const areaRatio=area/(rw*rh);
    if(areaRatio<.60||areaRatio>1.85){if(log)log(`CHAIN RAIL MISS whole-frame area=${areaRatio.toFixed(2)}`);return null;}

    const pointInPoly=(x,y,poly)=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y+1e-9)+a.x))inside=!inside;}return inside;};
    if(!pointInPoly(tx,ty,q)){if(log)log('CHAIN RAIL MISS tap outside');return null;}

    // Corners may escape the seed because the seed is axis-aligned, but not by
    // an unlimited amount. This remains a coarse sanity guard, not a snap rule.
    const sc=[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
    const tolX=Math.max(30,rw*.62),tolY=Math.max(30,rh*.62);
    for(let i=0;i<4;i++){
      const dx=Math.abs(q[i].x-sc[i].x),dy=Math.abs(q[i].y-sc[i].y);
      if(dx>tolX||dy>tolY){if(log)log(`CHAIN RAIL MISS corner-${i} seed-drift=${dx.toFixed(1)}/${dy.toFixed(1)}`);return null;}
    }

    const quad=q.map(p=>({x:p.x/(w-1),y:p.y/(h-1)}));
    const xs=quad.map(p=>p.x),ys=quad.map(p=>p.y);
    const bx=Math.max(0,Math.min(...xs)),by=Math.max(0,Math.min(...ys));
    const br=Math.min(1,Math.max(...xs)),bb=Math.min(1,Math.max(...ys));
    const confidence=Math.min(1,rails.reduce((s,r)=>s+r.support+r.continuity,0)/8);
    if(log)log(`OUTER LOOP HIT area=${areaRatio.toFixed(2)} coverage=${family.seedCoverage.toFixed(2)} confidence=${confidence.toFixed(2)} bridged=${bridgeMeta.filter(b=>b.bridged).length}/4 quad=${quad.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' | ')}`);
    return {...panel,x:bx,y:by,w:Math.max(.001,br-bx),h:Math.max(.001,bb-by),_quad:quad,_geometryType:'tap-neighborhood-frame',_frameEnvelope:{confidence,areaRatio,sides:4,connected:true,shortBridge:true,chainConnected:true,outermostLoop:true,neighborSideConsistency:true,railBandThickness:true,wasmRailKernel,relativeAdjScore:family.relativeAdjScore,adjacencyScore:family.adjacencyScore,adjSides:family.adj.map(a=>a.score),weakestAdj:family.weakestAdj,thicknessScore:family.avgThickness,minThickness:family.minThickness,thicknessSides:family.thickness.map(t=>t.score),familyScore:family.score,seedCoverage:family.seedCoverage,bridgedCorners:bridgeMeta.filter(b=>b.bridged).length}};
  }
};
