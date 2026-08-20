/* Longbox Native Page Turn — v59.6 Corner Furl Refinement
 * Refines v59.5's moving fold with a traveling leading-edge furl.
 * No external libraries.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 980;
    this.samples = 140;
  }

  clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  cornerAt(t, forward, w, h) {
    const e = t < .5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
    // The grabbed corner travels a little farther than v59.5 and rises/
    // falls near the end, producing a more natural curl before landing.
    const furl = Math.sin(Math.PI * e);
    return forward
      ? {x:w*(1-.96*e), y:h*(.055+.56*furl+.035*e)}
      : {x:w*(.96*e), y:h*(.055+.56*furl+.035*e)};
  }

  async turn(direction) {
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

    const layer=document.createElement("div");
    layer.className=`native-moving-fold v596 ${direction}`;
    layer.style.setProperty("--n",this.samples);
    layer.style.setProperty("--turn-duration",`${this.duration}ms`);

    const under=document.createElement("img");
    under.className="native-moving-fold-under";
    under.src=newUrl; under.draggable=false; under.alt="";
    layer.appendChild(under);

    for(let i=0;i<this.samples;i++){
      const piece=document.createElement("div");
      piece.className="native-moving-fold-piece";
      piece.style.setProperty("--i",i);
      piece.style.setProperty("--n",this.samples);
      const img=document.createElement("img");
      img.src=oldUrl; img.draggable=false; img.alt="";
      piece.appendChild(img); layer.appendChild(piece);
    }

    r.els.viewport.appendChild(layer);
    current.style.visibility="hidden";
    layer.getBoundingClientRect();
    await new Promise(requestAnimationFrame);

    const pieces=[...layer.querySelectorAll(".native-moving-fold-piece")];
    const start=performance.now();
    let ended=false;

    const finish=async()=>{
      if(ended)return;
      ended=true; layer.remove(); current.style.visibility="";
      r.index=to; r.updateSliderLabel(); r.updateBookmarkFlag(); r.saveProgress();
      try{await r.render();}finally{this.running=false;}
    };

    const frame=now=>{
      if(ended)return;
      const raw=Math.min(1,(now-start)/this.duration);
      const t=raw<.5?4*raw*raw*raw:1-Math.pow(-2*raw+2,3)/2;
      const forward=direction==="next";
      const corner=this.cornerAt(t,forward,rect.width,rect.height);

      // Moving crease: retain v59.5's behavior.
      const foldX=forward?rect.width*(1-.98*t):rect.width*(.98*t);
      const slope=(corner.y-rect.height*.5)/Math.max(1,rect.width*.48);
      const foldY=rect.height*.5+slope*(foldX-rect.width*.5);

      layer.style.setProperty("--fold-x",`${foldX}px`);
      layer.style.setProperty("--fold-y",`${foldY}px`);
      layer.style.setProperty("--corner-x",`${corner.x}px`);
      layer.style.setProperty("--corner-y",`${corner.y}px`);

      pieces.forEach((piece,i)=>{
        const u=i/(pieces.length-1);
        const x=u*rect.width;
        const lineY=foldY+slope*(x-foldX);
        const signed=forward?x-foldX:foldX-x;
        const band=rect.width*.15;
        const influence=this.clamp((signed+band)/band,0,1);
        const foldBand=Math.exp(-Math.pow(signed/(rect.width*.105),2));

        // New: a traveling edge furl. It peaks just ahead of the fold and
        // fades behind it, so the page appears to roll rather than hinge.
        const furlCenter=forward?foldX+rect.width*.035:foldX-rect.width*.035;
        const furlDist=Math.abs(x-furlCenter);
        const furl=Math.exp(-Math.pow(furlDist/(rect.width*.055),2))
          *Math.sin(Math.PI*t);

        // The outer corner gets a little extra lag and curl.
        const cornerWeight=Math.pow(1-u,.55);
        const yaw=(forward?-1:1)*
          (10+156*influence*influence+30*furl+14*cornerWeight*furl);

        const pitch=slope*18*foldBand+
          (forward?-1:1)*(9*furl+4*cornerWeight*furl);

        const depth=
          (38+86*foldBand+28*furl)*
          Math.sin(Math.PI*t)*
          (.24+.76*foldBand);

        const vertical=
          (lineY-rect.height*.5)*.20+
          (forward?-1:1)*furl*10*cornerWeight;

        const shade=.035+.30*foldBand*Math.sin(Math.PI*t)+.10*furl;

        piece.style.setProperty("--angle",`${yaw}deg`);
        piece.style.setProperty("--pitch",`${pitch}deg`);
        piece.style.setProperty("--depth",`${depth}px`);
        piece.style.setProperty("--lift",`${vertical}px`);
        piece.style.setProperty("--shade",shade.toFixed(3));
        piece.style.setProperty("--furl",furl.toFixed(3));
      });

      if(raw<1)requestAnimationFrame(frame);else finish();
    };

    requestAnimationFrame(frame);
    setTimeout(() => { if (!ended) finish(); }, this.duration + 400);
    return true;
  }
};
