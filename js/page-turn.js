/* Longbox Native Page Turn — v59.10 Known-Flip Geometry Hybrid
 *
 * Base: v59.5.
 * Reference logic: last-known-good flip archive's single sheet + under-page
 * 3D composition and 650ms cubic-bezier-style timing.
 *
 * Hybrid idea:
 *   - v59.5 supplies the moving corner/fold-line geometry.
 *   - known-good flip supplies the proven single-sheet rotateY presentation.
 *   - corner geometry adds pitch, lift, depth and dynamic lighting without
 *     splitting the page into independent DOM strips.
 *
 * No external flip library.
 */
window.LongboxNativePageTurn = class {
  constructor(reader){
    this.reader=reader;
    this.running=false;
    this.duration=650;
  }

  clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  // Same corner path that proved useful in v59.5.
  cornerAt(t,forward,w,h){
    const e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
    return forward
      ? {x:w*(1-.94*e),y:h*(.06+.52*Math.sin(Math.PI*e))}
      : {x:w*(.94*e),y:h*(.06+.52*Math.sin(Math.PI*e))};
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

    const from=r.index;
    const to=direction==="next"?from+1:from-1;
    if(to<0||to>=r.comic.pageCount)return false;

    const oldImg=r.els.viewport.querySelector("img");
    if(!oldImg)return false;

    const oldSrc=oldImg.currentSrc||oldImg.src;
    const newSrc=await r.getPageUrl(to);
    if(!newSrc)return false;

    const rect=r.els.viewport.getBoundingClientRect();
    if(rect.width<20||rect.height<20)return false;

    this.running=true;
    r.showChrome();

    const [oldLoaded,newLoaded]=await Promise.all([
      this.loadImage(oldSrc),this.loadImage(newSrc)
    ]);

    const stage=document.createElement("div");
    stage.className=`native-knownflip-hybrid ${direction}`;

    const under=document.createElement("img");
    const sheet=document.createElement("img");
    under.className="native-knownflip-under";
    sheet.className="native-knownflip-sheet";
    under.src=newSrc;
    sheet.src=oldSrc;
    under.draggable=sheet.draggable=false;
    under.alt=sheet.alt="";

    stage.append(under,sheet);
    r.els.viewport.appendChild(stage);
    oldImg.style.visibility="hidden";

    // Force the browser to establish the 3D layer before the first frame.
    stage.getBoundingClientRect();
    sheet.getBoundingClientRect();

    const start=performance.now();
    let ended=false;

    const finish=async()=>{
      if(ended)return;
      ended=true;
      stage.remove();
      oldImg.style.visibility="";
      r.index=to;
      r.updateSliderLabel();
      r.updateBookmarkFlag();
      r.saveProgress();
      try{await r.render();}finally{this.running=false;}
    };

    const frame=now=>{
      if(ended)return;
      const raw=Math.min(1,(now-start)/this.duration);

      // Match the known-good flip's smooth 650ms feel while keeping the
      // v59.5 corner/fold trajectory as the geometry driver.
      const t=raw<.5
        ?4*raw*raw*raw
        :1-Math.pow(-2*raw+2,3)/2;

      const forward=direction==="next";
      const corner=this.cornerAt(t,forward,rect.width,rect.height);

      // v59.5 moving fold boundary.
      const foldX=forward
        ?rect.width*(1-.96*t)
        :rect.width*(.96*t);

      const slope=(corner.y-rect.height*.5)/
        Math.max(1,rect.width*.48);

      // Corner height becomes page pitch. Keep it restrained so the proven
      // rotateY flip remains the dominant visual motion.
      const pitch=slope*11;
      const foldBand=Math.exp(-Math.pow(
        (foldX-rect.width*.5)/(rect.width*.48),2
      ));
      const depth=22*Math.sin(Math.PI*t)*(.35+.65*foldBand);
      const lift=(corner.y-rect.height*.5)*.075*Math.sin(Math.PI*t);

      // Known-good flip: one continuous sheet rotating around the spine.
      const yaw=(forward?-180:180)*t;

      // Add a very small corner-dependent skew in the vertical axis by
      // changing the transform origin vertically. It starts near the
      // grabbed corner and settles toward the spine center.
      const originY=6+(44*t);

      sheet.style.transformOrigin=
        `${forward?100:0}% ${originY}%`;

      sheet.style.transform=
        `translate3d(0,${lift.toFixed(2)}px,${depth.toFixed(2)}px) `+
        `rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`;

      // Geometry-driven shading, without a separate artificial line.
      const shade=.035+.16*Math.sin(Math.PI*t);
      sheet.style.filter=`brightness(${(1-shade).toFixed(3)})`;

      // A soft fold shadow is attached to the sheet's movement, not drawn
      // as a visible stripe over the comic.
      const shadow=Math.sin(Math.PI*t)*.18;
      stage.style.setProperty("--flip-shadow",shadow.toFixed(3));

      if(raw<1)requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    setTimeout(()=>{if(!ended)finish();},this.duration+450);
    return true;
  }
};
