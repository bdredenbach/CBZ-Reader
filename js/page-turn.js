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
  }

  clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  ease(t){
    // Smooth but quick known-good style motion.
    return t < .5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
  }

  cornerAt(t, forward, w, h){
    const e=this.ease(t);

    // The corner begins near the top outer edge, travels toward the spine,
    // dips slightly, then rises into the landing. This is the only new
    // geometric variable in this version.
    const yNorm=.045 + .22*Math.sin(Math.PI*e);

    return {
      x: forward ? w*(1-.94*e) : w*(.94*e),
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

      ctx.drawImage(
        oldImg,
        0,0,
        oldBox.w,oldBox.h
      );

      ctx.restore();

      // Very restrained fold shading. No artificial vertical stripe.
      const intensity=.10*Math.sin(Math.PI*t);
      if(intensity>.001){
        const x=forward
          ? spineX+oldBox.w*(1-t)
          : spineX-oldBox.w*(1-t);

        const shadow=ctx.createLinearGradient(
          x-oldBox.w*.035,0,
          x+oldBox.w*.035,0
        );
        shadow.addColorStop(0,"rgba(0,0,0,0)");
        shadow.addColorStop(.5,`rgba(0,0,0,${intensity})`);
        shadow.addColorStop(1,"rgba(255,255,255,0)");

        ctx.fillStyle=shadow;
        ctx.fillRect(
          x-oldBox.w*.05,
          oldBox.y,
          oldBox.w*.10,
          oldBox.h
        );
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
