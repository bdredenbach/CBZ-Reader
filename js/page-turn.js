/* Longbox Native Page Turn — v59.8 True Corner Geometry
 *
 * Based on the known-good v59.5 reader/animation foundation.
 * Geometry concepts selectively recreated from public StPageFlip:
 * - corner-driven angle calculation
 * - rotated page rectangle
 * - boundary intersections
 * - polygon clipping of the turning page
 * - progress derived from the moving fold point
 *
 * Turn.js-inspired addition:
 * - cubic-Bezier corner path for a more natural release/settle.
 *
 * No external flip library is loaded.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 720;
  }

  clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  ease(t) {
    return t < .5
      ? 4*t*t*t
      : 1-Math.pow(-2*t+2,3)/2;
  }

  bezier(p0,p1,p2,p3,t) {
    const u=1-t, uu=u*u, tt=t*t;
    return {
      x:uu*u*p0.x + 3*uu*t*p1.x + 3*u*tt*p2.x + tt*t*p3.x,
      y:uu*u*p0.y + 3*uu*t*p1.y + 3*u*tt*p2.y + tt*t*p3.y
    };
  }

  rotatePoint(p, origin, angle) {
    return {
      x:p.x*Math.cos(angle)+p.y*Math.sin(angle)+origin.x,
      y:p.y*Math.cos(angle)-p.x*Math.sin(angle)+origin.y
    };
  }

  distance(a,b) {
    return Math.hypot(b.x-a.x,b.y-a.y);
  }

  // Adapted geometry model: a moving corner point determines the page angle.
  // The active corner is mirrored so "next" feels like grabbing the
  // top-right/bottom-right corner of the visible comic page.
  calculateAngle(pos, corner, w, h) {
    const left = corner.right ? (w-pos.x+1) : (pos.x+1);
    const top = corner.bottom ? (h-pos.y) : pos.y;
    let angle = 2*Math.acos(this.clamp(left/Math.sqrt(top*top+left*left),-1,1));
    if(top<0) angle=-angle;
    if(corner.bottom) angle=-angle;
    return this.clamp(angle,-Math.PI*.985,Math.PI*.985);
  }

  rotatedRect(pos, angle, w, h, corner) {
    let pts;
    if(corner.bottom) {
      pts=[
        {x:0,y:-h},{x:w,y:-h},
        {x:0,y:0},{x:w,y:0}
      ];
    } else {
      pts=[
        {x:0,y:0},{x:w,y:0},
        {x:0,y:h},{x:w,y:h}
      ];
    }
    return {
      topLeft:this.rotatePoint(pts[0],pos,angle),
      topRight:this.rotatePoint(pts[1],pos,angle),
      bottomLeft:this.rotatePoint(pts[2],pos,angle),
      bottomRight:this.rotatePoint(pts[3],pos,angle)
    };
  }

  lineIntersection(a,b,c,d) {
    const A1=a.y-b.y, A2=c.y-d.y;
    const B1=b.x-a.x, B2=d.x-c.x;
    const C1=a.x*b.y-b.x*a.y;
    const C2=c.x*d.y-d.x*c.y;
    const den=A1*B2-A2*B1;
    if(Math.abs(den)<1e-7)return null;
    const x=-((C1*B2-C2*B1)/den);
    const y=-((A1*C2-A2*C1)/den);
    return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
  }

  inRect(p,w,h) {
    return p && p.x>=-1 && p.x<=w+1 && p.y>=-1 && p.y<=h+1 ? p : null;
  }

  intersect(a,b,c,d,w,h) {
    return this.inRect(this.lineIntersection(a,b,c,d),w,h);
  }

  intersections(pos,rect,w,h,corner) {
    let top=null, side=null, bottom=null;
    if(!corner.bottom) {
      top=this.intersect(
        pos,rect.topRight,{x:0,y:0},{x:w,y:0},w,h
      );
      side=this.intersect(
        pos,rect.bottomLeft,{x:w,y:0},{x:w,y:h},w,h
      );
      bottom=this.intersect(
        rect.bottomLeft,rect.bottomRight,{x:0,y:h},{x:w,y:h},w,h
      );
    } else {
      top=this.intersect(
        rect.topLeft,rect.topRight,{x:0,y:0},{x:w,y:0},w,h
      );
      side=this.intersect(
        pos,rect.topLeft,{x:w,y:0},{x:w,y:h},w,h
      );
      bottom=this.intersect(
        rect.bottomLeft,rect.bottomRight,{x:0,y:h},{x:w,y:h},w,h
      );
    }
    return {top,side,bottom};
  }

  flipClip(rect, ints, w, h, corner) {
    const out=[];
    if(!corner.bottom) {
      out.push(rect.topLeft);
      if(ints.top)out.push(ints.top);
      if(ints.side)out.push(ints.side);
      if(ints.bottom)out.push(ints.bottom);
      if(!ints.side || corner.bottom)out.push(rect.bottomLeft);
    } else {
      out.push(rect.bottomLeft);
      if(ints.bottom)out.push(ints.bottom);
      if(ints.side)out.push(ints.side);
      if(ints.top)out.push(ints.top);
      if(!ints.side)out.push(rect.topLeft);
    }
    return out.filter(Boolean);
  }

  pointInCanvas(p, w, h) {
    return {x:this.clamp(p.x,0,w), y:this.clamp(p.y,0,h)};
  }

  async loadImage(url) {
    return await new Promise((resolve,reject)=>{
      const img=new Image();
      img.decoding="async";
      img.onload=()=>resolve(img);
      img.onerror=reject;
      img.src=url;
    });
  }

  async turn(direction) {
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

    const layer=document.createElement("div");
    layer.className=`native-geometry59-8 ${direction}`;
    const canvas=document.createElement("canvas");
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(rect.width*dpr);
    canvas.height=Math.round(rect.height*dpr);
    canvas.className="native-geometry59-8-canvas";
    layer.appendChild(canvas);
    r.els.viewport.appendChild(layer);
    current.style.visibility="hidden";

    const ctx=canvas.getContext("2d");
    ctx.scale(dpr,dpr);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";

    const fit=(img)=>{
      const s=Math.min(rect.width/img.naturalWidth,rect.height/img.naturalHeight);
      const w=img.naturalWidth*s,h=img.naturalHeight*s;
      return {x:(rect.width-w)/2,y:(rect.height-h)/2,w,h};
    };
    const oldFit=fit(oldImg),newFit=fit(newImg);

    // Work in the fitted page's local coordinates.
    const W=oldFit.w,H=oldFit.h;
    const left=oldFit.x,top=oldFit.y;
    const forward=direction==="next";
    const corner={right:forward,bottom:false};

    // A gentle diagonal corner path: this is the "grab" rather than a fixed
    // rotateY. It deliberately stays inside the page so the geometry remains
    // stable while still introducing the up/down motion.
    const start=forward
      ? {x:W*.985,y:H*.035}
      : {x:W*.015,y:H*.035};
    const c1=forward
      ? {x:W*.91,y:H*.11}
      : {x:W*.09,y:H*.11};
    const c2=forward
      ? {x:W*.57,y:H*.58}
      : {x:W*.43,y:H*.58};
    const end=forward
      ? {x:W*.015,y:H*.49}
      : {x:W*.985,y:H*.49};

    let ended=false;
    const started=performance.now();

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

    const drawImageFitted=(img,box)=>{
      ctx.drawImage(img,box.x,box.y,box.w,box.h);
    };

    const frame=(now)=>{
      if(ended)return;
      const raw=Math.min(1,(now-started)/this.duration);
      const t=this.ease(raw);
      const posLocal=this.bezier(start,c1,c2,end,t);

      // Mirror geometry for backward.
      const pos={
        x:left+posLocal.x,
        y:top+posLocal.y
      };

      ctx.clearRect(0,0,rect.width,rect.height);

      // Bottom/next page.
      drawImageFitted(newImg,newFit);

      // Convert the corner point into page-local coordinates.
      const localPos={x:pos.x-left,y:pos.y-top};
      const angle=this.calculateAngle(localPos,corner,W,H);
      const rotated=this.rotatedRect(localPos,angle,W,H,corner);
      const ints=this.intersections(localPos,rotated,W,H,corner);
      const poly=this.flipClip(rotated,ints,W,H,corner);

      // Draw the old page clipped to the exact polygon calculated from the
      // transformed corners. This is the key v59.8 change: no strip mesh.
      ctx.save();
      ctx.translate(left,top);
      ctx.beginPath();
      if(poly.length){
        ctx.moveTo(poly[0].x,poly[0].y);
        for(let i=1;i<poly.length;i++)ctx.lineTo(poly[i].x,poly[i].y);
        ctx.closePath();
        ctx.clip();
      }

      ctx.translate(localPos.x,localPos.y);
      ctx.rotate(angle);
      ctx.drawImage(oldImg,0,corner.bottom?-H:0,W,H);
      ctx.restore();

      // Local fold shadow based on the actual intersection points.
      const shadowStart=ints.side||ints.top||ints.bottom;
      if(shadowStart){
        const sx=left+shadowStart.x, sy=top+shadowStart.y;
        const grad=ctx.createRadialGradient(sx,sy,0,sx,sy,Math.max(55,W*.18));
        grad.addColorStop(0,"rgba(0,0,0,.24)");
        grad.addColorStop(.35,"rgba(0,0,0,.10)");
        grad.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=grad;
        ctx.fillRect(0,0,rect.width,rect.height);
      }

      if(raw<1)requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    setTimeout(()=>{if(!ended)finish();},this.duration+500);
    return true;
  }
};
