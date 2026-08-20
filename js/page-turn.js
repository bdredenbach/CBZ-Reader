/* Longbox Native Page Turn — v59.8.1
 * Corner Geometry, corrected coordinate system.
 *
 * Base: known-good v59.5.
 * One continuous canvas surface.
 * Selective recreation of the corner/angle/clip concepts from StPageFlip.
 * No external library.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 720;
  }

  clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  ease(t){
    return t < .5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
  }

  angleFromCorner(pos,w,h){
    const x=Math.max(1,w-pos.x);
    const y=Math.max(0,pos.y);
    const d=Math.sqrt(x*x+y*y);
    let a=2*Math.acos(this.clamp(x/d,-1,1));
    if(y<0) a=-a;
    return this.clamp(a,-Math.PI*.985,Math.PI*.985);
  }

  rotatePoint(p,o,a){
    return {
      x:(p.x-o.x)*Math.cos(a)+(p.y-o.y)*Math.sin(a)+o.x,
      y:(p.y-o.y)*Math.cos(a)-(p.x-o.x)*Math.sin(a)+o.y
    };
  }

  // Intersect an infinite fold line with a page boundary.
  lineIntersection(a,b,c,d){
    const den=(a.x-b.x)*(c.y-d.y)-(a.y-b.y)*(c.x-d.x);
    if(Math.abs(den)<1e-7)return null;
    const t=((a.x-c.x)*(c.y-d.y)-(a.y-c.y)*(c.x-d.x))/den;
    return {x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)};
  }

  boundaryPoint(p,q,w,h,edge){
    const bounds={
      top:[{x:0,y:0},{x:w,y:0}],
      right:[{x:w,y:0},{x:w,y:h}],
      bottom:[{x:w,y:h},{x:0,y:h}],
      left:[{x:0,y:h},{x:0,y:0}]
    };
    const hit=this.lineIntersection(p,q,bounds[edge][0],bounds[edge][1]);
    if(!hit)return null;
    const eps=.5;
    if(hit.x < -eps || hit.x > w+eps || hit.y < -eps || hit.y > h+eps) return null;
    return {x:this.clamp(hit.x,0,w),y:this.clamp(hit.y,0,h)};
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
    if(!r.comic || r.mode!=="single" || r.scale>1.02)return false;

    const to=direction==="next"?r.index+1:r.index-1;
    if(to<0 || to>=r.comic.pageCount)return false;

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
      this.loadImage(oldUrl),this.loadImage(newUrl)
    ]);

    const fit=img=>{
      const s=Math.min(rect.width/img.naturalWidth,rect.height/img.naturalHeight);
      const w=img.naturalWidth*s,h=img.naturalHeight*s;
      return {x:(rect.width-w)/2,y:(rect.height-h)/2,w,h};
    };
    const oldBox=fit(oldImg),newBox=fit(newImg);
    const W=oldBox.w,H=oldBox.h;

    const layer=document.createElement("div");
    layer.className=`native-geometry59-8-1 ${direction}`;
    const canvas=document.createElement("canvas");
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(rect.width*dpr);
    canvas.height=Math.round(rect.height*dpr);
    canvas.className="native-geometry59-8-1-canvas";
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
      try{await r.render();}finally{this.running=false;}
    };

    const drawNew=()=>{
      ctx.drawImage(newImg,newBox.x,newBox.y,newBox.w,newBox.h);
    };

    const frame=now=>{
      if(ended)return;
      const raw=Math.min(1,(now-start)/this.duration);
      const t=this.ease(raw);
      const forward=direction==="next";

      // Active top corner moves diagonally, but this test uses only the
      // resulting geometry; no extra Bezier/furl math is introduced.
      const p={
        x: forward ? W*(1-.965*t) : W*(.035+.965*t),
        y: H*(.035+.50*Math.sin(Math.PI*t))
      };

      // Mirror the local page for previous-page turns.
      const localP=forward ? p : {x:W-p.x,y:p.y};
      const angle=this.angleFromCorner(localP,W,H);

      ctx.clearRect(0,0,rect.width,rect.height);
      drawNew();

      /*
       * Reference-style coordinate system:
       * 1. Move origin to the fold point.
       * 2. Build the page's transformed boundary around that point.
       * 3. Clip in that same local coordinate space.
       * 4. Rotate the page.
       * 5. Draw the continuous image once.
       *
       * This avoids mixing viewport coordinates with page-local polygons.
       */
      const foldX=oldBox.x+localP.x;
      const foldY=oldBox.y+localP.y;

      ctx.save();
      ctx.translate(foldX,foldY);
      ctx.rotate(forward ? angle : -angle);

      // The visible turning half is clipped against a moving fold boundary.
      ctx.beginPath();
      if(forward){
        ctx.moveTo(0,-H);
        ctx.lineTo(W,-H);
        ctx.lineTo(W,H);
        ctx.lineTo(0,H);
        ctx.closePath();
      }else{
        ctx.moveTo(-W,-H);
        ctx.lineTo(0,-H);
        ctx.lineTo(0,H);
        ctx.lineTo(-W,H);
        ctx.closePath();
      }
      ctx.clip();

      ctx.translate(forward ? 0 : -W,0);
      ctx.drawImage(oldImg,0,0,W,H);
      ctx.restore();

      // Fold shadow stays tied to the actual fold point, not a separate
      // artificial vertical stripe.
      const shadow=ctx.createRadialGradient(foldX,foldY,0,foldX,foldY,Math.max(45,W*.16));
      shadow.addColorStop(0,"rgba(0,0,0,.18)");
      shadow.addColorStop(.32,"rgba(0,0,0,.07)");
      shadow.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=shadow;
      ctx.fillRect(0,0,rect.width,rect.height);

      if(raw<1)requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    setTimeout(()=>{if(!ended)finish();},this.duration+450);
    return true;
  }
};
