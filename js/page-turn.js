/* Longbox Native Page Turn — v59.11 Corner-Driven Known Flip
 *
 * Base: v59.5.
 * Presentation: known-good continuous 3D flip concept.
 * New variable: the page's Y rotation is driven by a simulated grabbed
 * corner rather than being a fixed spine rotation.
 *
 * No external libraries.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 650;
    this.bowBands = 24;
  }

  clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  ease(t){
    // Smooth but quick known-good style motion.
    return t < .5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
  }

  cornerAt(t, forward, w, h){
    /*
     * v59.17 — Natural Corner Arc
     *
     * The existing v59.11 corner path worked, but its motion was a little
     * too uniform. Use a hand-like pull: quick initial travel, a deeper
     * middle arc, then a gentle flattening as the corner approaches the
     * spine. The landing still reaches exactly the same endpoint.
     */
    const e=this.ease(t);

    // Cubic ease for the horizontal pull: faster early, softer at the end.
    const xEase=1-Math.pow(1-e,1.18);

    // The vertical component is asymmetric: a little quicker into the arc,
    // then a longer, softer return toward the landing line.
    const arc=Math.sin(Math.PI*Math.pow(e,.92));
    const landingFade=Math.pow(e,1.15);
    const yNorm=.045 + .255*arc*(1-.18*landingFade);

    return {
      x: forward ? w*(1-.94*xEase) : w*(.94*xEase),
      y: h*yNorm
    };
  }

  rotationFromCorner(corner, forward, w, h){
    const spineX=forward ? 0 : w;
    const dx=Math.abs(corner.x-spineX);
    const dy=corner.y-h*.5;

    // Corner distance determines the rotation strength. The vertical
    // displacement contributes a small pitch-like correction without adding
    // a separate page mesh.
    const normalized=this.clamp(dx/w,0,1);
    const vertical=this.clamp(dy/h,-.5,.5);

    // Start near flat, reach the strongest turn through the middle, and
    // flatten again at the landing.
    const angle=Math.PI*(1-normalized);
    const signed=forward ? -angle : angle;
    return {
      yaw:signed,
      pitch:vertical*.12,
      depth:Math.sin(angle)*Math.min(w,h)*.035
    };
  }

  async loadImage(url){
    return await new Promise((resolve,reject)=>{
      const img=new Image();
      img.decoding="async";
      img.onload=()=>resolve(img);
      img.onerror=reject;
      img.src=url;
    });
  }

  async turn(direction){
    if(this.running)return false;

    const r=this.reader;
    if(!r.comic||r.mode!=="single"||r.scale>1.02)return false;

    const to=direction==="next"?r.index+1:r.index-1;
    if(to<0||to>=r.comic.pageCount)return false;

    const current=r.els.viewport.querySelector("img");
    if(!current)return false;

    const oldUrl=current.currentSrc||current.src;
    const newUrl=await r.getPageUrl(to);
    if(!newUrl)return false;

    const rect=r.els.viewport.getBoundingClientRect();
    if(rect.width<20||rect.height<20)return false;

    this.running=true;
    r.showChrome();

    const [oldImg,newImg]=await Promise.all([
      this.loadImage(oldUrl),
      this.loadImage(newUrl)
    ]);

    const fit=img=>{
      const s=Math.min(
        rect.width/img.naturalWidth,
        rect.height/img.naturalHeight
      );
      const w=img.naturalWidth*s;
      const h=img.naturalHeight*s;
      return {
        x:(rect.width-w)/2,
        y:(rect.height-h)/2,
        w,h
      };
    };

    const oldBox=fit(oldImg);
    const newBox=fit(newImg);

    const layer=document.createElement("div");
    layer.className=`native-corner-known59-11 ${direction}`;
    const canvas=document.createElement("canvas");
    const dpr=Math.min(window.devicePixelRatio||1,2);

    canvas.width=Math.round(rect.width*dpr);
    canvas.height=Math.round(rect.height*dpr);
    canvas.className="native-corner-known59-11-canvas";

    layer.appendChild(canvas);
    r.els.viewport.appendChild(layer);
    current.style.visibility="hidden";

    const ctx=canvas.getContext("2d");
    ctx.scale(dpr,dpr);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";

    const start=performance.now();
    let ended=false;

    const finish=async()=>{
      if(ended)return;
      ended=true;
      layer.remove();
      current.style.visibility="";
      r.index=to;
      r.updateSliderLabel();
      r.updateBookmarkFlag();
      r.saveProgress();

      try{
        await r.render();
      }finally{
        this.running=false;
      }
    };

    const frame=now=>{
      if(ended)return;

      const raw=Math.min(1,(now-start)/this.duration);
      const t=this.ease(raw);
      const forward=direction==="next";

      const corner=this.cornerAt(
        t,forward,oldBox.w,oldBox.h
      );

      const motion=this.rotationFromCorner(
        corner,forward,oldBox.w,oldBox.h
      );

      /*
       * v59.15 — gentle landing.
       *
       * During the final 18% of the turn, introduce a very small damped
       * settle. It starts at zero, peaks briefly, and returns to zero before
       * the page is committed, so the final resting page remains perfectly
       * flat.
       */
      const settleStart=.82;
      const settleT=this.clamp(
        (t-settleStart)/(1-settleStart),0,1
      );
      if(settleT>0){
        // One restrained compression/release rather than a bounce:
        // it gives the sheet a little mass without wobbling.
        const microSettle=
          Math.sin(Math.PI*settleT) *
          Math.exp(-3.4*settleT);

        motion.yaw += (forward?-1:1)*.016*microSettle;
        motion.pitch += (forward?1:-1)*.007*microSettle;
        motion.depth +=
          Math.min(oldBox.w,oldBox.h)*.0012*microSettle;
      }

      /*
       * v59.13 — tiny corner furl.
       *
       * The furl lives entirely inside the existing v59.11 transform.
       * It is strongest near the outer corner, peaks in the middle of the
       * turn, and fades before the page lands. This intentionally does NOT
       * create another rendering surface.
       */
      const furlPhase=Math.sin(Math.PI*t);
      const cornerProximity=1-this.clamp(
        Math.abs(corner.x-(forward?oldBox.w:0))/oldBox.w,
        0,1
      );
      const furlStrength=
        furlPhase *
        Math.pow(cornerProximity,.65);

      motion.yaw += (forward?-1:1) * .19 * furlStrength;
      motion.pitch += (forward?-1:1) * .085 * furlStrength;
      motion.depth += Math.min(oldBox.w,oldBox.h) *
        .015 * furlStrength;

      ctx.clearRect(0,0,rect.width,rect.height);

      // Next page is always underneath.
      ctx.drawImage(
        newImg,
        newBox.x,newBox.y,newBox.w,newBox.h
      );

      // The old page is one continuous sheet. Its transform is anchored at
      // the spine, preserving the visual character of the known-good flip.
      const spineX=forward
        ? oldBox.x
        : oldBox.x+oldBox.w;

      const originY=oldBox.y+oldBox.h*.5;

      ctx.save();

      ctx.translate(
        spineX + (forward ? motion.depth : -motion.depth),
        originY
      );

      ctx.rotate(motion.pitch);

      // A small vertical scale adjustment gives the corner's up/down travel
      // some physical consequence without introducing a mesh.
      const verticalScale=1-.035*Math.abs(motion.pitch);
      ctx.scale(
        Math.cos(motion.yaw),
        verticalScale
      );

      ctx.translate(
        forward ? 0 : -oldBox.w,
        -oldBox.h*.5
      );

      /*
       * v59.14 — corrected paper bow.
       *
       * The previous v59.12 experiment could blank the page because it used
       * rendered CSS dimensions as source-image pixel coordinates. Here the
       * source rows are explicitly sampled from naturalHeight/naturalWidth,
       * while destination rows use the fitted CSS dimensions.
       *
       * The bow is intentionally shallow and overlaps neighboring rows so
       * it reads as a continuous sheet rather than visible strips.
       */
      const bowStrength =
        Math.sin(Math.PI*t) * Math.sin(Math.PI*t) *
        Math.min(oldBox.w, oldBox.h) * .010;

      const bands=this.bowBands;
      const sourceH=oldImg.naturalHeight;
      const sourceW=oldImg.naturalWidth;

      for(let bi=0; bi<bands; bi++){
        const v0=Math.max(0,bi/bands-.0015);
        const v1=Math.min(1,(bi+1)/bands+.0015);

        const sy0=v0*sourceH;
        const sy1=v1*sourceH;
        const dy0=v0*oldBox.h;
        const dy1=v1*oldBox.h;
        const bandH=Math.max(1,dy1-dy0);

        // Maximum displacement at the center; zero at the page edges.
        const mid=(v0+v1)*.5;
        const bow=Math.sin(Math.PI*mid)*bowStrength;

        ctx.drawImage(
          oldImg,
          0,sy0,
          sourceW,Math.max(1,sy1-sy0),
          0,dy0+bow,
          oldBox.w,bandH
        );
      }

      ctx.restore();

      /*
       * v59.19 — Page Edge.
       *
       * A very thin, soft highlight follows the physical leading edge of the
       * turning sheet. It is localized to the outer edge and fades as the
       * page becomes flat. This is lighting only; geometry is unchanged.
       */
      const edgeProgress=Math.sin(Math.PI*t);
      if(edgeProgress>.001){
        const edgeX=forward
          ? oldBox.x+oldBox.w*(1-.94*t)
          : oldBox.x+oldBox.w*.94*t;

        const edgeY=oldBox.y+corner.y;
        const edgeWidth=
          Math.max(1.5,Math.min(5.0,oldBox.w*.006));

        const edgeGradient=ctx.createLinearGradient(
          edgeX-edgeWidth,edgeY,
          edgeX+edgeWidth,edgeY
        );

        const edgeAlpha=.08*edgeProgress;
        edgeGradient.addColorStop(0,"rgba(255,255,255,0)");
        edgeGradient.addColorStop(.50,`rgba(255,255,255,${edgeAlpha})`);
        edgeGradient.addColorStop(.72,`rgba(255,255,255,${edgeAlpha*.35})`);
        edgeGradient.addColorStop(1,"rgba(255,255,255,0)");

        ctx.save();
        ctx.globalCompositeOperation="screen";
        ctx.fillStyle=edgeGradient;
        ctx.fillRect(
          edgeX-edgeWidth,
          oldBox.y,
          edgeWidth*2,
          oldBox.h
        );
        ctx.restore();
      }

      /*
       * v59.18 — Dynamic Fold Shadow.
       *
       * Lighting follows the current corner/fold position instead of being
       * a fixed stripe. The shadow is strongest near the active bend,
       * broadens across the folded area, and fades naturally as the page
       * approaches its final position.
       */
      const lightPhase=Math.sin(Math.PI*t);
      if(lightPhase>.001){
        const foldX=forward
          ? spineX+oldBox.w*(1-t)
          : spineX-oldBox.w*(1-t);

        const foldY=oldBox.y+corner.y;

        const shadowWidth=
          oldBox.w*(.035 + .055*lightPhase);

        const shadow=ctx.createLinearGradient(
          foldX-shadowWidth,
          foldY,
          foldX+shadowWidth,
          foldY
        );

        const shadowAlpha=.045 + .095*lightPhase;
        shadow.addColorStop(0,"rgba(0,0,0,0)");
        shadow.addColorStop(.35,`rgba(0,0,0,${shadowAlpha*.45})`);
        shadow.addColorStop(.50,`rgba(0,0,0,${shadowAlpha})`);
        shadow.addColorStop(.67,`rgba(255,255,255,${shadowAlpha*.34})`);
        shadow.addColorStop(1,"rgba(255,255,255,0)");

        ctx.save();
        ctx.globalCompositeOperation="multiply";
        ctx.fillStyle=shadow;
        ctx.fillRect(
          foldX-shadowWidth,
          oldBox.y,
          shadowWidth*2,
          oldBox.h
        );
        ctx.restore();

        // Small specular highlight close to the moving corner. It is kept
        // deliberately soft so it reads as paper catching light, not a line.
        const highlightRadius=
          Math.min(oldBox.w,oldBox.h)*(.045+.025*lightPhase);
        const highlight=ctx.createRadialGradient(
          corner.x+oldBox.x,
          foldY,
          0,
          corner.x+oldBox.x,
          foldY,
          highlightRadius
        );
        highlight.addColorStop(0,`rgba(255,255,255,${.055*lightPhase})`);
        highlight.addColorStop(1,"rgba(255,255,255,0)");

        ctx.save();
        ctx.globalCompositeOperation="screen";
        ctx.fillStyle=highlight;
        ctx.fillRect(
          corner.x+oldBox.x-highlightRadius,
          foldY-highlightRadius,
          highlightRadius*2,
          highlightRadius*2
        );
        ctx.restore();
      }

      if(raw<1){
        requestAnimationFrame(frame);
      }else{
        finish();
      }
    };

    requestAnimationFrame(frame);
    setTimeout(()=>{if(!ended)finish();},this.duration+450);

    return true;
  }
};
