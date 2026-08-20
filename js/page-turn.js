/* Longbox Native Page Turn — v59.9 Continuous True Fold
 *
 * Base: known-good v59.5.
 * Rendering: one canvas surface.
 *
 * Geometry:
 *   corner -> fold axis -> boundary intersections -> stationary region
 *   + folded region reflected across the moving fold axis.
 *
 * The folded surface is represented by a small continuous canvas mesh.
 * Adjacent quads overlap by a fraction of a pixel to avoid visible seams.
 * No external flip library.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 700;
    this.segments = 64;
  }

  clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  ease(t){
    return t < .5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
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

  // Signed distance from a point to the moving fold axis.
  // The fold axis is defined by a point and a direction vector.
  signedDistance(p, axisPoint, axisDir){
    return (p.x-axisPoint.x)*axisDir.y -
           (p.y-axisPoint.y)*axisDir.x;
  }

  reflectPoint(p, axisPoint, axisDir){
    const len=Math.hypot(axisDir.x,axisDir.y)||1;
    const ux=axisDir.x/len, uy=axisDir.y/len;
    const dx=p.x-axisPoint.x, dy=p.y-axisPoint.y;
    const proj=dx*ux+dy*uy;
    const px=axisPoint.x+proj*ux;
    const py=axisPoint.y+proj*uy;
    return {x:2*px-p.x,y:2*py-p.y};
  }

  lineBoundaryIntersection(a,b,w,h){
    const edges=[
      [{x:0,y:0},{x:w,y:0}],
      [{x:w,y:0},{x:w,y:h}],
      [{x:w,y:h},{x:0,y:h}],
      [{x:0,y:h},{x:0,y:0}]
    ];
    const hits=[];
    for(const e of edges){
      const p=e[0],q=e[1];
      const den=(a.x-b.x)*(p.y-q.y)-(a.y-b.y)*(p.x-q.x);
      if(Math.abs(den)<1e-8)continue;
      const t=((a.x-p.x)*(p.y-q.y)-(a.y-p.y)*(p.x-q.x))/den;
      const u=-((a.x-b.x)*(a.y-p.y)-(a.y-b.y)*(a.x-p.x))/den;
      if(t>=-1e-5&&t<=1.00001&&u>=-1e-5&&u<=1.00001){
        hits.push({
          x:a.x+t*(b.x-a.x),
          y:a.y+t*(b.y-a.y)
        });
      }
    }
    return hits;
  }

  drawImageMesh(ctx,img,box,axisPoint,axisDir,forward,t){
    const W=box.w,H=box.h;
    const count=this.segments;
    const overlap=Math.max(0.35,W/count*.12);

    /*
     * The fold axis is the physical crease. The stationary part is drawn
     * normally by the caller. Here we draw only the folded side.
     *
     * Each narrow quad samples the same continuous source image. The source
     * coordinates are derived from the original x positions, then the four
     * destination corners are reflected/offset around the fold.
     */
    for(let i=0;i<count;i++){
      const x0=i/count*W;
      const x1=(i+1)/count*W;
      const mid=(x0+x1)/2;
      const p0={x:box.x+x0,y:box.y};
      const p1={x:box.x+x1,y:box.y};
      const p2={x:box.x+x1,y:box.y+H};
      const p3={x:box.x+x0,y:box.y+H};

      const d=this.signedDistance(
        {x:box.x+mid,y:box.y+H/2},axisPoint,axisDir
      );

      // Only the side being turned is rendered here.
      const turning=forward ? d<0 : d>0;
      if(!turning)continue;

      const foldWeight=this.clamp(Math.abs(d)/(W*.78),0,1);
      // Tight crease: strongest deformation immediately around the fold,
      // then a restrained falloff across the folded sheet.
      const nearCrease=Math.exp(-Math.pow(Math.abs(d)/(W*.22),2));
      const curl=(0.35 + 0.65*nearCrease) *
                 Math.sin(Math.PI*foldWeight) * Math.sin(Math.PI*t);
      const depth=34*curl;
      const lift=(axisPoint.y-(box.y+H/2))*0.055*curl;

      const transformPoint=(p)=>{
        const local={
          x:p.x-axisPoint.x,
          y:p.y-axisPoint.y
        };
        const reflected=this.reflectPoint(p,axisPoint,axisDir);
        const rx=reflected.x+ (forward?-depth*.72:depth*.72);
        const ry=reflected.y+lift;
        return {x:rx,y:ry};
      };

      const q0=transformPoint(p0);
      const q1=transformPoint(p1);
      const q2=transformPoint(p2);
      const q3=transformPoint(p3);

      /*
       * Approximate the quad with two affine triangles. This keeps the page
       * as one continuous canvas while allowing the folded side to move.
       */
      const sx0=Math.max(0,x0-overlap);
      const sx1=Math.min(W,x1+overlap);
      const sw=sx1-sx0;

      const drawTri=(a,b,c,sa,sb,sc)=>{
        const denom=(sb-sa)*(c.y-a.y)-(b.y-a.y)*(sc-sa);
        if(Math.abs(denom)<1e-7)return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);
        ctx.closePath();ctx.clip();

        const A=(b.x-a.x), B=(b.y-a.y);
        const C=(c.x-a.x), D=(c.y-a.y);
        const E=(sb-sa), F=(sc-sa);
        const det=E*(c.y-a.y)-F*(b.y-a.y);
        if(Math.abs(det)<1e-7){ctx.restore();return;}

        const m11=(A*(c.y-a.y)-C*(b.y-a.y))/det;
        const m21=(B*(c.y-a.y)-D*(b.y-a.y))/det;
        const m12=(C*E-A*F)/det;
        const m22=(D*E-B*F)/det;
        const tx=a.x-m11*sa-m12*a.y;
        const ty=a.y-m21*sa-m22*a.y;

        ctx.transform(m11,m21,m12,m22,tx,ty);
        ctx.drawImage(
          img,
          box.x+sa,0,
          Math.max(1,sb-sa),img.naturalHeight,
          0,0,
          Math.max(1,sb-sa),H
        );
        ctx.restore();
      };

      // The mesh source is continuous; neighboring cells overlap slightly.
      drawTri(q0,q1,q3,sx0,sx1,sx0);
      drawTri(q1,q2,q3,sx1,sx1,sx0);
    }
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
      this.loadImage(oldUrl),this.loadImage(newUrl)
    ]);

    const fit=img=>{
      const s=Math.min(rect.width/img.naturalWidth,rect.height/img.naturalHeight);
      const w=img.naturalWidth*s,h=img.naturalHeight*s;
      return {x:(rect.width-w)/2,y:(rect.height-h)/2,w,h};
    };
    const oldBox=fit(oldImg),newBox=fit(newImg);

    const layer=document.createElement("div");
    layer.className=`native-true-fold59-9 ${direction}`;
    const canvas=document.createElement("canvas");
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(rect.width*dpr);
    canvas.height=Math.round(rect.height*dpr);
    canvas.className="native-true-fold59-9-canvas";
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

    const frame=now=>{
      if(ended)return;

      const raw=Math.min(1,(now-start)/this.duration);
      const t=this.ease(raw);
      const forward=direction==="next";
      const W=oldBox.w,H=oldBox.h;

      /*
       * Corner trajectory. The corner itself travels diagonally, while the
       * crease is perpendicular to the vector from the page center to that
       * corner. This is the physical "grab" model we were after.
       */
      const corner={
        x:oldBox.x+(forward ? W*(1-.94*t) : W*(.94*t)),
        y:oldBox.y+H*(.055+.50*Math.sin(Math.PI*t))
      };
      const center={x:oldBox.x+W/2,y:oldBox.y+H/2};
      const vx=corner.x-center.x,vy=corner.y-center.y;
      const len=Math.hypot(vx,vy)||1;

      // Fold axis is perpendicular to center->corner.
      const axisDir={x:-vy/len,y:vx/len};

      // Slightly pull the fold point toward the corner as the turn progresses.
      const axisPoint={
        x:center.x+(corner.x-center.x)*.72,
        y:center.y+(corner.y-center.y)*.72
      };

      ctx.clearRect(0,0,rect.width,rect.height);

      // New page: always continuous and underneath.
      ctx.drawImage(newImg,newBox.x,newBox.y,newBox.w,newBox.h);

      // Stationary part of old page. Clip against the fold axis.
      ctx.save();
      ctx.beginPath();
      const pad=Math.max(rect.width,rect.height)*2;
      const a={
        x:axisPoint.x-axisDir.x*pad,
        y:axisPoint.y-axisDir.y*pad
      };
      const b={
        x:axisPoint.x+axisDir.x*pad,
        y:axisPoint.y+axisDir.y*pad
      };
      ctx.moveTo(a.x,a.y);
      ctx.lineTo(b.x,b.y);
      ctx.lineTo(b.x+(forward?pad:-pad),b.y);
      ctx.lineTo(a.x+(forward?pad:-pad),a.y);
      ctx.closePath();
      ctx.clip();

      // Draw old page normally, then the folded side overlays it.
      ctx.drawImage(oldImg,oldBox.x,oldBox.y,oldBox.w,oldBox.h);
      ctx.restore();

      this.drawImageMesh(
        ctx,oldImg,oldBox,axisPoint,axisDir,forward,t
      );

      // Soft crease shadow, tied to the actual fold axis.
      const pA={x:axisPoint.x-axisDir.x*rect.width,y:axisPoint.y-axisDir.y*rect.width};
      const pB={x:axisPoint.x+axisDir.x*rect.width,y:axisPoint.y+axisDir.y*rect.width};
      const grad=ctx.createLinearGradient(
        pA.x,pA.y,pB.x,pB.y
      );
      grad.addColorStop(0,"rgba(0,0,0,0)");
      grad.addColorStop(.48,"rgba(0,0,0,.05)");
      grad.addColorStop(.50,"rgba(0,0,0,.16)");
      grad.addColorStop(.52,"rgba(255,255,255,.08)");
      grad.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=grad;
      ctx.globalAlpha=.42*Math.sin(Math.PI*t);
      ctx.fillRect(0,0,rect.width,rect.height);
      ctx.globalAlpha=1;

      if(raw<1)requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    setTimeout(()=>{if(!ended)finish();},this.duration+500);
    return true;
  }
};
