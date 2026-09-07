// NTH SHELF V2.78.23 — PROVEN-FRAME OWNERSHIP CLASSIFIER
//
// Ownership is decided only after the rail-band envelope proves a complete
// four-corner frame. Trusted tilted rails keep their quadrilateral; an
// orthogonal classification renders the box around that same proven frame.

const PanelGeometrySkewed = {
  classify(imgUrl, panel, log) {
    if (!imgUrl || !panel) return Promise.resolve({ owns:false, reason:'missing-input' });
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try { resolve(this._classify(img, panel, log)); }
        catch (err) {
          console.warn('Skewed ownership classifier failed:', err);
          if (log) log(`VERTEX CLASSIFIER ERROR: ${err.message}`);
          resolve({ owns:false, reason:'error' });
        }
      };
      img.onerror = () => resolve({ owns:false, reason:'image-error' });
      img.src = imgUrl;
    });
  },

  // Compatibility: the router now calls classify(), but keeping refine() makes
  // the module safe if an older caller is still present somewhere in the shell.
  async refine(imgUrl, panel, log) {
    const result = await this.classify(imgUrl, panel, log);
    return result && result.owns ? { ...panel, _geometryOwner:'skewed', _skewEvidence:result } : null;
  },

  // Classify the already-proven whole-frame quadrilateral. Ownership never
  // moves a corner; it only decides whether the envelope keeps its four
  // vertices or is rendered as the orthogonal box around those same rails.
  classifyQuad(panel, log) {
    const q=panel?._quad;
    if(!Array.isArray(q)||q.length!==4||q.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y))){
      return {owns:false,owner:'orthogonal',reason:'missing-proven-quad',confidence:0};
    }
    const angleAt=(prev,p,next)=>{
      const ax=prev.x-p.x,ay=prev.y-p.y,bx=next.x-p.x,by=next.y-p.y;
      const den=Math.hypot(ax,ay)*Math.hypot(bx,by);
      if(den<1e-8)return NaN;
      return Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/den)))*180/Math.PI;
    };
    const orientation=(a,b)=>{
      let deg=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
      deg=((deg%180)+180)%180;
      return deg;
    };
    const diff180=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,180-d);};
    const angles=q.map((p,i)=>angleAt(q[(i+3)%4],p,q[(i+1)%4]));
    if(angles.some(a=>!Number.isFinite(a)))return {owns:false,owner:'orthogonal',reason:'invalid-angles',confidence:0};
    const deviations=angles.map(a=>Math.abs(a-90));
    const sortedDev=deviations.slice().sort((a,b)=>b-a);
    const edgeAngles=q.map((p,i)=>orientation(p,q[(i+1)%4]));
    const axisDepartures=edgeAngles.map(a=>Math.min(a,Math.abs(a-90),180-a));
    const maxAxisDeparture=Math.max(...axisDepartures);
    const oppositeDivergence=Math.max(diff180(edgeAngles[0],edgeAngles[2]),diff180(edgeAngles[1],edgeAngles[3]));
    const maxDev=sortedDev[0],secondDev=sortedDev[1];

    // A visibly tilted edge may still be an artwork rail mistakenly fitted
    // inside an otherwise orthogonal panel. Only an edge with both strong
    // neighbor separation and printed-band integrity may prove skew ownership.
    const adjSides=panel?._frameEnvelope?.adjSides||[];
    const thicknessSides=panel?._frameEnvelope?.thicknessSides||[];
    const frameEvidence=panel?._frameEnvelope||{};
    const relativeRailProof=(frameEvidence.seedConsensus||0)>=3&&
      (frameEvidence.relativeAdjScore||0)>=.82&&
      (frameEvidence.adjacencyScore||0)>=.23&&
      (frameEvidence.minThickness||0)>=.78;
    const trustedAxisDepartures=axisDepartures.filter((departure,i)=>
      departure>=4.5&&(adjSides[i]===undefined||adjSides[i]>=.50||
        (relativeRailProof&&adjSides[i]>=.14))&&
      (thicknessSides[i]===undefined||thicknessSides[i]>=.66)
    );
    const trustedAxisDeparture=Math.max(0,...trustedAxisDepartures);
    // One trusted non-axial rail is still not enough by itself. It needs
    // corroboration from a second corner or opposing-rail divergence.
    const substantial=trustedAxisDeparture>=4.5;
    const corroborated=secondDev>=4.5||oppositeDivergence>=5.0;
    const owns=substantial&&corroborated;
    const confidence=Math.max(0,Math.min(1,
      (maxDev-4)/14+(secondDev-2)/22+(oppositeDivergence-2)/26
    ));
    const result={
      owns,owner:owns?'skewed':'orthogonal',
      reason:owns?'whole-frame-angle-proof':'orthogonal-angle-profile',confidence,
      angles,deviations,edgeAngles,axisDepartures,maxDev,secondDev,
      maxAxisDeparture,trustedAxisDeparture,oppositeDivergence,adjSides,thicknessSides,
      relativeRailProof
    };
    if(log)log(`FRAME OWNERSHIP angles=${angles.map(a=>a.toFixed(1)).join('/')} dev=${deviations.map(a=>a.toFixed(1)).join('/')} axis=${axisDepartures.map(a=>a.toFixed(1)).join('/')} trusted=${trustedAxisDeparture.toFixed(1)} adj=${adjSides.map(a=>a.toFixed(2)).join('/')} opp=${oppositeDivergence.toFixed(1)}`);
    if(log)log(`FRAME OWNERSHIP -> ${owns?'SKEWED':'ORTHOGONAL'} confidence=${confidence.toFixed(2)} reason=${result.reason}`);
    return result;
  },

  _classify(img, panel, log) {
    const maxDim = 900;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.drawImage(img, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const lum = new Uint8Array(w*h);
    for (let i=0,j=0;i<rgba.length;i+=4,j++) {
      lum[j] = Math.round(.299*rgba[i] + .587*rgba[i+1] + .114*rgba[i+2]);
    }

    const x0 = Math.max(2, Math.round(panel.x*w));
    const y0 = Math.max(2, Math.round(panel.y*h));
    const x1 = Math.min(w-3, Math.round((panel.x+panel.w)*w)-1);
    const y1 = Math.min(h-3, Math.round((panel.y+panel.h)*h)-1);
    const rw = x1-x0+1, rh = y1-y0+1;
    if (rw < 26 || rh < 26) return { owns:false, reason:'seed-too-small' };

    const tap = panel._tap || {x:panel.x+panel.w/2, y:panel.y+panel.h/2};
    const tx = Math.max(2, Math.min(w-3, tap.x*(w-1)));
    const ty = Math.max(2, Math.min(h-3, tap.y*(h-1)));
    if (log) log(`VERTEX CLASSIFIER start tap=${tx.toFixed(1)},${ty.toFixed(1)} seed=${x0},${y0}-${x1},${y1}`);

    const pixelLum = (x,y) => {
      x=Math.max(1,Math.min(w-2,Math.round(x)));
      y=Math.max(1,Math.min(h-2,Math.round(y)));
      return (lum[(y-1)*w+x]+lum[y*w+x]+lum[(y+1)*w+x]+lum[y*w+x-1]+lum[y*w+x+1])/5;
    };

    // Fit one local side around a seed edge.  The candidate may lean, but its
    // intersection corners must still live near the seed corners.  This is an
    // ownership classifier, not a page-wide rail hunt.
    const fitSide = (kind) => {
      const horizontal = kind==='top' || kind==='bottom';
      const neg = kind==='top' || kind==='left';
      const along0 = horizontal ? x0 : y0;
      const along1 = horizontal ? x1 : y1;
      const tapAlong = horizontal ? tx : ty;
      const tapCross = horizontal ? ty : tx;
      const seedCross = kind==='top'?y0:kind==='bottom'?y1:kind==='left'?x0:x1;
      const span = along1-along0;
      const crossSize = horizontal ? rh : rw;
      const alongSize = horizontal ? rw : rh;
      const corridor = Math.max(14, Math.min((horizontal?h:w)*.08, crossSize*.34));
      const a0 = Math.max(2, Math.round(along0 - alongSize*.10));
      const a1 = Math.min((horizontal?w:h)-3, Math.round(along1 + alongSize*.10));
      const sampleStep = Math.max(2, Math.round((a1-a0)/95));
      const slopeMax = .48;
      let best=null;

      // Represent H as y=m*x+b and V as x=m*y+b. Anchor is position at tapAlong.
      for (let pass=0; pass<2; pass++) {
        const mStep = pass===0 ? .03 : .006;
        const pStep = pass===0 ? 3 : 1;
        const mLo = best ? Math.max(-slopeMax,best.m-.05) : -slopeMax;
        const mHi = best ? Math.min(slopeMax,best.m+.05) : slopeMax;
        const pLo = best ? Math.max(seedCross-corridor,best.anchor-8) : seedCross-corridor;
        const pHi = best ? Math.min(seedCross+corridor,best.anchor+8) : seedCross+corridor;
        let passBest=best;
        for (let m=mLo; m<=mHi+1e-9; m+=mStep) {
          for (let anchor=pLo; anchor<=pHi; anchor+=pStep) {
            const b = anchor - m*tapAlong;
            const atTap = m*tapAlong+b;
            if (neg && atTap >= tapCross-3) continue;
            if (!neg && atTap <= tapCross+3) continue;
            let n=0,dark=0,veryDark=0,longest=0,run=0,sum=0;
            for (let a=a0; a<=a1; a+=sampleStep) {
              const p=m*a+b;
              if (p<2 || p>=(horizontal?h:w)-2) { run=0; continue; }
              const v=horizontal ? pixelLum(a,p) : pixelLum(p,a);
              n++; sum+=v;
              if (v<=166) { dark++; run++; if(run>longest)longest=run; } else run=0;
              if (v<=108) veryDark++;
            }
            if(n<12) continue;
            const support=dark/n, continuity=longest/n, strong=veryDark/n;
            if(support<.30 || continuity<.14) continue;
            const seedPenalty=Math.abs(anchor-seedCross)/Math.max(8,corridor);
            const slopePenalty=Math.max(0,Math.abs(m)-.32)*.3;
            const score=support*2.15+continuity*1.35+strong*.45-(sum/n)/470-seedPenalty*.35-slopePenalty;
            const cand={kind,horizontal,m,b,anchor,support,continuity,strong,mean:sum/n,score};
            if(!passBest || score>passBest.score) passBest=cand;
          }
        }
        best=passBest;
      }
      if(!best) { if(log)log(`VERTEX side ${kind} MISS`); return null; }
      if(log)log(`VERTEX side ${kind} HIT m=${best.m.toFixed(3)} support=${best.support.toFixed(2)} cont=${best.continuity.toFixed(2)}`);
      return best;
    };

    const top=fitSide('top'), bottom=fitSide('bottom'), left=fitSide('left'), right=fitSide('right');
    const sides=[top,bottom,left,right].filter(Boolean).length;
    if(sides<4) {
      if(log)log(`VERTEX OWNERSHIP -> ORTHOGONAL reason=rails ${sides}/4`);
      return {owns:false,reason:'rails',sides};
    }

    const intersect=(hl,vl)=>{
      const den=1-hl.m*vl.m;
      if(Math.abs(den)<.10) return null;
      const x=(vl.m*hl.b+vl.b)/den;
      const y=hl.m*x+hl.b;
      return {x,y};
    };
    const q=[intersect(top,left),intersect(top,right),intersect(bottom,right),intersect(bottom,left)];
    if(q.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))) {
      if(log)log('VERTEX OWNERSHIP -> ORTHOGONAL reason=intersection');
      return {owns:false,reason:'intersection'};
    }

    // Ownership corners must correspond to the local seed's four corners.  This
    // rejects tiny interior boxes and page-wide quadrilaterals before angle math.
    const seedCorners=[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
    const cornerTolX=Math.max(22,rw*.38), cornerTolY=Math.max(22,rh*.38);
    let worstCorner=0;
    for(let i=0;i<4;i++){
      const dx=Math.abs(q[i].x-seedCorners[i].x), dy=Math.abs(q[i].y-seedCorners[i].y);
      worstCorner=Math.max(worstCorner,Math.hypot(dx/rw,dy/rh));
      if(dx>cornerTolX || dy>cornerTolY){
        if(log)log(`VERTEX OWNERSHIP -> ORTHOGONAL reason=corner-${i} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
        return {owns:false,reason:'corner-locality',corner:i,dx,dy};
      }
    }

    const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    const cs=[cross(q[0],q[1],q[2]),cross(q[1],q[2],q[3]),cross(q[2],q[3],q[0]),cross(q[3],q[0],q[1])];
    if(!(cs.every(v=>v>0)||cs.every(v=>v<0))){
      if(log)log('VERTEX OWNERSHIP -> ORTHOGONAL reason=non-convex');
      return {owns:false,reason:'non-convex'};
    }

    const angleAt=(prev,p,next)=>{
      const ax=prev.x-p.x, ay=prev.y-p.y, bx=next.x-p.x, by=next.y-p.y;
      const na=Math.hypot(ax,ay), nb=Math.hypot(bx,by);
      if(na<1||nb<1) return NaN;
      const c=Math.max(-1,Math.min(1,(ax*bx+ay*by)/(na*nb)));
      return Math.acos(c)*180/Math.PI;
    };
    const angles=q.map((p,i)=>angleAt(q[(i+3)%4],p,q[(i+1)%4]));
    if(angles.some(a=>!Number.isFinite(a))) return {owns:false,reason:'angles'};
    const dev=angles.map(a=>Math.abs(a-90));
    const maxDev=Math.max(...dev);
    const sorted=dev.slice().sort((a,b)=>b-a);
    const secondDev=sorted[1];

    const lineAngleH=(r)=>Math.atan(r.m)*180/Math.PI;
    const lineAngleV=(r)=>90-Math.atan(r.m)*180/Math.PI;
    const sideAngles=[lineAngleH(top),lineAngleV(right),lineAngleH(bottom),lineAngleV(left)];
    const oppositeDivergence=Math.max(
      Math.abs(lineAngleH(top)-lineAngleH(bottom)),
      Math.abs(lineAngleV(left)-lineAngleV(right))
    );

    // Area is used only to ensure the candidate corner set is local enough for
    // classification; V2.78.11 does NOT use this polygon for rendering.
    const area=Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%4];return s+p.x*n.y-n.x*p.y;},0)/2);
    const areaRatio=area/(rw*rh);
    if(areaRatio<.28 || areaRatio>1.75){
      if(log)log(`VERTEX OWNERSHIP -> ORTHOGONAL reason=area ratio=${areaRatio.toFixed(2)}`);
      return {owns:false,reason:'area',areaRatio};
    }

    // Vertex proof: do not let one noisy corner decide ownership.  A true skewed
    // quadrilateral must show one substantial angle departure AND corroboration
    // from another corner or opposing-side divergence.
    const substantial=maxDev>=8.0;
    const corroborated=secondDev>=4.5 || oppositeDivergence>=6.0;
    const owns=substantial && corroborated;
    const confidence=Math.max(0,Math.min(1,(maxDev-5)/18 + (secondDev-3)/28 + oppositeDivergence/45));

    if(log) log(`VERTEX angles=${angles.map(a=>a.toFixed(1)).join('/')} dev=${dev.map(a=>a.toFixed(1)).join('/')} oppDiv=${oppositeDivergence.toFixed(1)} area=${areaRatio.toFixed(2)}`);
    if(log) log(`VERTEX OWNERSHIP -> ${owns?'SKEWED':'ORTHOGONAL'} confidence=${confidence.toFixed(2)}`);

    return {
      owns,
      reason:owns?'vertex-angle-proof':'orthogonal-angle-profile',
      confidence,
      angles,
      deviations:dev,
      oppositeDivergence,
      areaRatio,
      sideAngles,
      // Diagnostic only. Router deliberately does not render this quad yet.
      diagnosticQuad:q.map(p=>({x:p.x/(w-1),y:p.y/(h-1)}))
    };
  }
};
