// NTH SHELF V2.79.03 — QUICK PROVEN-FRAME OWNERSHIP ROUTER
//
// Frame extraction and geometry ownership are separate decisions. The envelope
// first proves a complete four-rail cell; only that finished quadrilateral may
// be classified as skewed or orthogonal. Ownership never invents new corners.

const PanelGeometry = {
  _seedPolicy(panel) {
    const w=Math.max(0,Number(panel?.w)||0);
    const h=Math.max(0,Number(panel?.h)||0);
    const area=w*h;
    const composite=area>.24||(w>.82&&h>.28)||(h>.82&&w>.28);
    const fragment=area<.040||(w>.22&&h<.070)||(h>.22&&w<.070);
    const edgeClipped=(w<.995||h<.995)&&
      (panel.x<=.003||panel.y<=.003||panel.x+w>=.997||panel.y+h>=.997);
    const inferred=panel?._identitySource||
      (panel?._v100Hybrid?'v100':panel?._v87BoundarySet?'v99':'unknown');

    if(inferred==='v73') return {mode:'hold',source:'V73',reason:'stable-orthogonal'};
    if(inferred==='v100'&&(fragment||composite||edgeClipped)) {
      return {mode:composite?'frame':'inspect',source:'V100',
        reason:composite?'oversized-composite':fragment?'possible-fragment':'page-edge-clipped',
        area,edgeClipped};
    }
    if(inferred==='v100') return {mode:'hold',source:'V100',reason:'structural-orthogonal'};
    if(inferred==='v99'&&!composite) {
      return {mode:'inspect',source:'V99',reason:'local-frame-ownership',edgeClipped};
    }
    if(!composite) return {mode:'hold',source:String(inferred).toUpperCase(),reason:'local-seed'};
    return {mode:'frame',source:String(inferred).toUpperCase(),reason:'oversized-composite',area};
  },

  // Fast front route for a baseline miss. It accepts only the bounded
  // one-search/local-consensus result and applies the same ownership classifier
  // as the complete router. A miss returns null so V100/V99/V92 stay untouched.
  async refineAdaptiveOnly(imgUrl,panel,log){
    if(!imgUrl||!panel||typeof PanelFrameEnvelope==='undefined'||
      !PanelFrameEnvelope.detectAdaptiveOnly)return null;
    const envelope=await PanelFrameEnvelope.detectAdaptiveOnly(imgUrl,panel,log);
    if(!envelope||!Array.isArray(envelope._quad)||envelope._quad.length!==4||
      envelope._frameEnvelope?.chainConnected!==true)return null;
    const ownership=(typeof PanelGeometrySkewed!=='undefined'&&PanelGeometrySkewed.classifyQuad)
      ?PanelGeometrySkewed.classifyQuad(envelope,log)
      :{owns:true,owner:'skewed',reason:'classifier-unavailable'};
    envelope._frameOwnership=ownership;
    if(ownership.owns){
      envelope._geometryOwner='skewed-frame';
      if(log)log('QUICK ROUTER -> SKEWED FRAME');
      return envelope;
    }
    const ortho=(typeof PanelGeometryOrthogonal!=='undefined'&&PanelGeometryOrthogonal.refine)
      ?PanelGeometryOrthogonal.refine(envelope,log):{...envelope};
    ortho._geometryOwner='orthogonal-frame';
    ortho._frameOwnership=ownership;
    if(log)log('QUICK ROUTER -> ORTHOGONAL FRAME');
    return ortho;
  },

  async refine(imgUrl, panel, log) {
    if (!panel) return null;
    if (log) log('ROUTER V2.78.23 proven-frame-ownership start');

    const policy=this._seedPolicy(panel);
    if(policy.mode==='hold'){
      const held=(typeof PanelGeometryOrthogonal!=='undefined'&&PanelGeometryOrthogonal.refine)
        ? PanelGeometryOrthogonal.refine(panel,log)
        : {...panel};
      held._geometryOwner='orthogonal-authority';
      if(log)log(`ORTHOGONAL AUTHORITY HOLD source=${policy.source} reason=${policy.reason}`);
      if(log)log('ROUTER -> ORTHOGONAL AUTHORITY');
      return held;
    }

    if(log)log(`FRAME OWNERSHIP ELIGIBLE source=${policy.source} mode=${policy.mode}${policy.area?` area=${policy.area.toFixed(3)}`:''}`);

    if (imgUrl && typeof PanelFrameEnvelope !== 'undefined' && PanelFrameEnvelope.detect) {
      const frameSeed=policy.mode==='inspect'
        ? {...panel,x:.011,y:.013,w:.954,h:.957,_tap:panel._tap,_ownershipProbe:true,
            _identitySeed:{x:panel.x,y:panel.y,w:panel.w,h:panel.h},_edgeClippedSeed:!!policy.edgeClipped}
        : {...panel,_structuralCompositeSeed:policy.source==='V100',_edgeClippedSeed:!!policy.edgeClipped};
      const envelope = await PanelFrameEnvelope.detect(imgUrl, frameSeed, log);
      if (envelope && Array.isArray(envelope._quad) && envelope._quad.length===4) {
        const ownership=(typeof PanelGeometrySkewed!=='undefined'&&PanelGeometrySkewed.classifyQuad)
          ? PanelGeometrySkewed.classifyQuad(envelope,log)
          : {owns:true,owner:'skewed',reason:'classifier-unavailable'};
        envelope._frameOwnership=ownership;
        if(ownership.owns){
          envelope._geometryOwner='skewed-frame';
          if(log)log('ROUTER -> SKEWED FRAME (proven whole-frame ownership)');
          return envelope;
        }

        const envelopeArea=Math.abs(envelope._quad.reduce((sum,p,i)=>{
          const next=envelope._quad[(i+1)%4];return sum+p.x*next.y-next.x*p.y;
        },0)/2);
        const seedArea=Math.max(.0001,(Number(panel.w)||0)*(Number(panel.h)||0));
        const frameRatio=envelopeArea/seedArea;
        const e=envelope._frameEnvelope||{};
        const xs=envelope._quad.map(p=>p.x),ys=envelope._quad.map(p=>p.y);
        const spanX=Math.max(...xs)-Math.min(...xs),spanY=Math.max(...ys)-Math.min(...ys);
        const pagePerimeter=(spanX>=.80||spanY>=.80)&&
          (Math.min(...xs)<=.08||Math.max(...xs)>=.92||Math.min(...ys)<=.08||Math.max(...ys)>=.92);
        const perimeterCorrection=pagePerimeter&&(e.seedConsensus||0)>=3&&
          (e.weakestAdj||0)>=.12&&(e.relativeAdjScore||0)>=.90&&(e.minThickness||0)>=.66;
        const strongCorrection=(e.weakestAdj||0)>=.30&&(e.relativeAdjScore||0)>=.80&&(e.minThickness||0)>=.66;
        const expansion=policy.mode==='inspect'&&(
          (frameRatio>2.0&&(policy.source!=='V100'||strongCorrection||perimeterCorrection))||
          (policy.edgeClipped&&frameRatio>1.15&&(strongCorrection||perimeterCorrection))
        );
        const provenSplit=policy.mode==='inspect'&&frameRatio<.78&&envelopeArea>=.025&&strongCorrection;
        const edgeRealign=policy.mode==='inspect'&&policy.edgeClipped&&frameRatio>=.80&&frameRatio<=1.15&&
          (strongCorrection||perimeterCorrection);
        const localIdentityRealign=policy.mode==='inspect'&&/^identity-local-/.test(String(e.seedSource||''))&&
          frameRatio>=.75&&frameRatio<=1.85&&(e.adjacencyScore||0)>=.14&&(e.relativeAdjScore||0)>=.80&&
          (e.minThickness||0)>=.72&&(policy.edgeClipped||frameRatio>1.12);
        const identityCorrection=expansion||provenSplit||edgeRealign||localIdentityRealign;
        if(policy.mode==='inspect'&&!identityCorrection){
          const held=(typeof PanelGeometryOrthogonal!=='undefined'&&PanelGeometryOrthogonal.refine)
            ? PanelGeometryOrthogonal.refine(panel,log):{...panel};
          held._geometryOwner='orthogonal-authority';
          held._frameOwnership=ownership;
          if(log)log(`ORTHOGONAL AUTHORITY HOLD source=${policy.source} frameRatio=${(envelopeArea/seedArea).toFixed(2)}`);
          if(log)log('ROUTER -> ORTHOGONAL AUTHORITY');
          return held;
        }

        const ortho=(typeof PanelGeometryOrthogonal!=='undefined'&&PanelGeometryOrthogonal.refine)
          ? PanelGeometryOrthogonal.refine(envelope,log):{...envelope};
        ortho._geometryOwner='orthogonal-frame';
        ortho._frameOwnership=ownership;
        if(log)log(`ROUTER -> ORTHOGONAL FRAME (${expansion?'fragment seed expanded':provenSplit?'composite seed split':edgeRealign?'page-edge realigned':localIdentityRealign?'local identity realigned':'proven frame'})`);
        return ortho;
      }
    }

    const ortho=(typeof PanelGeometryOrthogonal!=='undefined'&&PanelGeometryOrthogonal.refine)
      ? PanelGeometryOrthogonal.refine(panel,log)
      : {...panel};
    ortho._geometryOwner='orthogonal-fallback';
    if (log) log('ROUTER -> ORTHOGONAL FALLBACK (envelope not proven)');
    return ortho;
  }
};
