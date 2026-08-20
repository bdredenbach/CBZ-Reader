/* Longbox Native Page Turn — v59.7 Continuous Sheet
 * Single-canvas page surface. No external libraries.
 *
 * The animation keeps v59.5's moving-fold idea but renders ONE continuous
 * page texture instead of hundreds of independent DOM image slices.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 940;
    this.segments = 160;
  }

  clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  cornerAt(t, forward, w, h) {
    const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2;
    const y = h * (.06 + .52*Math.sin(Math.PI*e));
    return forward
      ? {x:w*(1-.96*e), y}
      : {x:w*(.96*e), y};
  }

  ease(t) {
    return t < .5
      ? 4*t*t*t
      : 1 - Math.pow(-2*t + 2, 3)/2;
  }

  async loadImage(url) {
    return await new Promise((resolve,reject)=>{
      const img = new Image();
      img.decoding = "async";
      img.onload = ()=>resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async turn(direction) {
    if(this.running) return false;
    const r=this.reader;
    if(!r.comic || r.mode!=="single" || r.scale>1.02) return false;

    const to=direction==="next" ? r.index+1 : r.index-1;
    if(to<0 || to>=r.comic.pageCount) return false;

    const current=r.els.viewport.querySelector("img");
    if(!current) return false;

    const oldUrl=current.currentSrc || current.src;
    const newUrl=await r.getPageUrl(to);
    if(!newUrl) return false;

    const rect=r.els.viewport.getBoundingClientRect();
    if(rect.width<20 || rect.height<20) return false;

    this.running=true;
    r.showChrome();

    const oldImg=await this.loadImage(oldUrl);
    const newImg=await this.loadImage(newUrl);

    const layer=document.createElement("div");
    layer.className=`native-continuous-turn ${direction}`;
    const canvas=document.createElement("canvas");
    canvas.className="native-continuous-canvas";
    canvas.width=Math.max(1,Math.round(rect.width*devicePixelRatio));
    canvas.height=Math.max(1,Math.round(rect.height*devicePixelRatio));
    layer.appendChild(canvas);
    r.els.viewport.appendChild(layer);

    current.style.visibility="hidden";

    const ctx=canvas.getContext("2d");
    const dpr=devicePixelRatio||1;
    ctx.scale(dpr,dpr);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";

    // Match object-fit: contain for both source pages.
    const fit = (img) => {
      const scale=Math.min(rect.width/img.naturalWidth, rect.height/img.naturalHeight);
      const w=img.naturalWidth*scale, h=img.naturalHeight*scale;
      return {x:(rect.width-w)/2,y:(rect.height-h)/2,w,h};
    };
    const oldFit=fit(oldImg), newFit=fit(newImg);

    let ended=false;
    const start=performance.now();

    const finish=async()=>{
      if(ended)return;
      ended=true;
      layer.remove();
      current.style.visibility="";
      r.index=to;
      r.updateSliderLabel();
      r.updateBookmarkFlag();
      r.saveProgress();
      try{await r.render();}finally{this.running=false;}
    };

    const drawPage = (img, box, transform) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0,0,rect.width,rect.height);
      ctx.clip();
      ctx.translate(box.x,box.y);
      transform(ctx, box.w, box.h);
      ctx.drawImage(img,0,0,box.w,box.h);
      ctx.restore();
    };

    const frame=(now)=>{
      if(ended)return;
      const raw=Math.min(1,(now-start)/this.duration);
      const t=this.ease(raw);
      const forward=direction==="next";
      const corner=this.cornerAt(t,forward,rect.width,rect.height);

      ctx.clearRect(0,0,rect.width,rect.height);

      // New page is the continuous surface underneath.
      drawPage(newImg,newFit,()=>{});

      // The old page is drawn as a continuous mesh. Each vertical mesh strip
      // is transformed from the same source image, so there are no duplicated
      // DOM image crops and no visible seams.
      const w=oldFit.w, h=oldFit.h;
      const ox=oldFit.x, oy=oldFit.y;

      for(let i=0;i<this.segments;i++){
        const u0=i/this.segments, u1=(i+1)/this.segments;
        const x0=ox+u0*w, x1=ox+u1*w;
        const mid=(u0+u1)/2;
        const signed=forward
          ? (x0-(ox+w*(1-.98*t)))
          : (ox+w*.98*t-x1);

        const band=rect.width*.15;
        const influence=this.clamp((signed+band)/band,0,1);
        const foldBand=Math.exp(-Math.pow(signed/(rect.width*.105),2));

        // Preserve v59.5's moving fold character.
        const angle=(forward?-1:1)*(10+156*influence*influence);
        const depth=(38+86*foldBand)*Math.sin(Math.PI*t)*(.24+.76*foldBand);
        const pitch=((corner.y-rect.height*.5)/Math.max(1,rect.width*.48))*18*foldBand;
        const lift=(corner.y-rect.height*.5)*.20*foldBand;

        const overlapPx = 1.5;
        const sx0=Math.max(0,u0*oldImg.naturalWidth-overlapPx);
        const sx1=Math.min(oldImg.naturalWidth,u1*oldImg.naturalWidth+overlapPx);
        const sw=sx1-sx0;

        // Approximate the curved surface with a single transformed quad.
        // The source texture remains continuous because each segment samples
        // its exact neighboring region from ONE image.
        ctx.save();
        ctx.translate((x0+x1)/2, oy+h/2+lift);
        ctx.translate(0,depth);
        ctx.rotate(pitch*Math.PI/180);
        ctx.scale(Math.cos(angle*Math.PI/180),1);
        ctx.globalAlpha=1;
        ctx.filter=`brightness(${1-(.035+.30*foldBand*Math.sin(Math.PI*t))})`;

        ctx.drawImage(
          oldImg,
          sx0,0,sw,oldImg.naturalHeight,
          -(x1-x0)/2,-h/2,
          (x1-x0)+2.0,h
        );
        ctx.restore();
      }

      // v59.7.1: no separate fold stripe. The page's own local shading
      // supplies the fold cue without drawing an artificial vertical line.
      if(raw<1) requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    setTimeout(()=>{if(!ended)finish();},this.duration+500);
    return true;
  }
};
