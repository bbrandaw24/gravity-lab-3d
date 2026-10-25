/* Original educational thickness-averaged particle-grid solver.
 * Public inputs: AvaFrame DEM / release polygon; friction laws documented in SOURCES.md.
 * It is NOT AvaFrame com1DFA, RAMMS, a 3D stress solver, or a calibrated hazard model.
 * SI units, local coordinates east and south. Conserved parcel volumes, no entrainment.
 */
export function frictionSpeed(v, dt, mu, normalG, xi, h, g=9.81) {
  const c=Math.max(0,v-dt*mu*normalG);
  const b=Number.isFinite(xi)?dt*g/(xi*Math.max(h,0.05)):0;
  return b>0?2*c/(1+Math.sqrt(1+4*b*c)):c;
}
export function inside(x,y,p){let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){
 const a=p[i],b=p[j];if((a[1]>y)!=(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export class Simulation {
 constructor(d,p={}){
  this.d=d;this.p={mode:'snow',mu:.155,xi:4000,thickness:1,volume:26000,particles:2400,...p};
  this.nx=d.nx;this.ny=d.ny;this.dx=d.cell;this.z=Float64Array.from(d.elevation);
  const size=d.nx*d.ny;this.sx=new Float64Array(size);this.sy=new Float64Array(size);
  this.h=new Float64Array(size);this.tmp=new Float64Array(size);this.sm=new Float64Array(size);
  this.mx=new Float64Array(size);this.my=new Float64Array(size);
  for(let y=0;y<d.ny;y++)for(let x=0;x<d.nx;x++){
   const i=y*d.nx+x;this.sx[i]=(this.z[y*d.nx+Math.min(x+1,d.nx-1)]-this.z[y*d.nx+Math.max(x-1,0)])/(x===0||x===d.nx-1?d.cell:2*d.cell);
   this.sy[i]=(this.z[Math.min(y+1,d.ny-1)*d.nx+x]-this.z[Math.max(y-1,0)*d.nx+x])/(y===0||y===d.ny-1?d.cell:2*d.cell);
  }
  const poly=d.releasePolygon,xs=poly.map(v=>v[0]),ys=poly.map(v=>v[1]);
  const minx=Math.min(...xs),miny=Math.min(...ys),maxx=Math.max(...xs),maxy=Math.max(...ys);
  const spacing=Math.sqrt(d.releasePlanArea/this.p.particles),pts=[];let seed=713;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let y=miny+spacing/2;y<maxy;y+=spacing)for(let x=minx+spacing/2;x<maxx;x+=spacing){
   const xx=x+(rand()-.5)*spacing*.45,yy=y+(rand()-.5)*spacing*.45;
   if(inside(xx,yy,poly))pts.push([xx,yy]);}
  this.N=pts.length;this.x=Float64Array.from(pts,v=>v[0]);this.y=Float64Array.from(pts,v=>v[1]);
  this.x0=this.x.slice();this.y0=this.y.slice();this.vx=new Float64Array(this.N);this.vy=new Float64Array(this.N);
  this.active=new Uint8Array(this.N).fill(1);this.depth=new Float64Array(this.N);
  this.volume=this.p.mode==='snow'?d.releaseSurfaceArea*this.p.thickness:this.p.volume;
  // Uniform normal release depth requires larger parcel volumes on steeper
  // cells when seeds are uniform in the horizontal projection.
  this.q=Float64Array.from(pts,([x,y])=>Math.sqrt(1+this.sample(this.sx,x,y)**2+this.sample(this.sy,x,y)**2));
  const qsum=this.q.reduce((a,b)=>a+b,0);for(let n=0;n<this.N;n++)this.q[n]*=this.volume/qsum;
  this.time=0;this.maxEver=0;this.initialDepth=this.volume/d.releaseSurfaceArea;
  this.project();
 }
 sample(a,x,y){const xx=Math.max(0,Math.min(this.nx-1.00001,x/this.dx)),yy=Math.max(0,Math.min(this.ny-1.00001,y/this.dx));
  const i=Math.floor(xx),j=Math.floor(yy),fx=xx-i,fy=yy-j,k=j*this.nx+i;
  return (a[k]*(1-fx)+a[k+1]*fx)*(1-fy)+(a[k+this.nx]*(1-fx)+a[k+this.nx+1]*fx)*fy;
 }
 project(){
  const {nx,ny,dx}=this;this.h.fill(0);this.mx.fill(0);this.my.fill(0);
  let xmin=nx-1,xmax=0,ymin=ny-1,ymax=0;
  for(let n=0;n<this.N;n++){if(!this.active[n])continue;
   const x=this.x[n]/dx,y=this.y[n]/dx,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
   xmin=Math.min(xmin,ix);xmax=Math.max(xmax,ix+1);ymin=Math.min(ymin,iy);ymax=Math.max(ymax,iy+1);
   const k=iy*nx+ix,ws=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy],ids=[k,k+1,k+nx,k+nx+1];
   for(let j=0;j<4;j++){const id=ids[j],w=ws[j]*this.q[n]/(dx*dx);this.h[id]+=w;this.mx[id]+=w*this.vx[n];this.my[id]+=w*this.vy[n];}
  }
  xmin=Math.max(1,xmin-3);xmax=Math.min(nx-2,xmax+3);ymin=Math.max(1,ymin-3);ymax=Math.min(ny-2,ymax+3);
  // Separable [1,2,1]/4 filter; conservative away from the absorbing domain edge.
  this.tmp.fill(0);this.sm.fill(0);
  for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){const k=y*nx+x;this.tmp[k]=(this.h[k-1]+2*this.h[k]+this.h[k+1])*.25;}
  for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){const k=y*nx+x;
   this.sm[k]=(this.tmp[k-nx]+2*this.tmp[k]+this.tmp[k+nx])*.25/Math.sqrt(1+this.sx[k]**2+this.sy[k]**2);
  }
 }
 step(dt){
  this.project();const {nx,ny,dx,p}=this;let maxSpeed=0;
  for(let n=0;n<this.N;n++){if(!this.active[n])continue;
   const x=this.x[n],y=this.y[n],sx=this.sample(this.sx,x,y),sy=this.sample(this.sy,x,y),s2=1+sx*sx+sy*sy;
   const normalG=9.81/Math.sqrt(s2),h=Math.max(.05,this.sample(this.sm,x,y));this.depth[n]=h;
   const hx=(this.sample(this.sm,x+dx,y)-this.sample(this.sm,x-dx,y))/(2*dx);
   const hy=(this.sample(this.sm,x,y+dx)-this.sample(this.sm,x,y-dx))/(2*dx);
   const dot=sx*hx+sy*hy;
   const ax=-9.81*sx/s2-normalG*(hx-sx*dot/s2),ay=-9.81*sy/s2-normalG*(hy-sy*dot/s2);
   let vx=this.vx[n]+ax*dt,vy=this.vy[n]+ay*dt;
   const v=Math.sqrt(vx*vx+vy*vy+(sx*vx+sy*vy)**2);
   const v1=frictionSpeed(v,dt,p.mu,normalG,p.mode==='snow'?p.xi:Infinity,h);
   if(v>0){vx*=v1/v;vy*=v1/v;}
   this.vx[n]=vx;this.vy[n]=vy;maxSpeed=Math.max(maxSpeed,v1);
   this.x[n]+=vx*dt;this.y[n]+=vy*dt;
   const ix=Math.round(this.x[n]/dx),iy=Math.round(this.y[n]/dx);
   if(ix<2||ix>=nx-2||iy<2||iy>=ny-2||!this.d.valid[iy*nx+ix]){this.active[n]=0;this.vx[n]=0;this.vy[n]=0;}
  }
  this.time+=dt;this.maxEver=Math.max(this.maxEver,maxSpeed);return maxSpeed;
 }
 snapshot(){
  const a=new Float32Array(this.N*5);let vmax=0,vsum=0,moving=0,active=0,runout=0,maxH=0,cx=0,cy=0;
  for(let n=0;n<this.N;n++){
   const x=this.x[n],y=this.y[n],sx=this.sample(this.sx,x,y),sy=this.sample(this.sy,x,y);
   const v=Math.sqrt(this.vx[n]**2+this.vy[n]**2+(sx*this.vx[n]+sy*this.vy[n])**2);
   const h=this.active[n]?Math.max(.05,this.sample(this.sm,x,y)):0;
   a.set([x,y,h,v,this.active[n]],n*5);
   if(this.active[n]){vmax=Math.max(vmax,v);vsum+=v*this.q[n];active+=this.q[n];cx+=x*this.q[n];cy+=y*this.q[n];if(v>.5)moving+=this.q[n];maxH=Math.max(maxH,h);}
   runout=Math.max(runout,Math.hypot(x-this.x0[n],y-this.y0[n]));
  }
  return {time:this.time,positions:a,stats:{vmax,vmean:vsum/Math.max(1,active),moving:moving/this.volume,runout,maxH,escaped:Math.max(0,1-active/this.volume),volume:this.volume,maxEver:this.maxEver,centerX:active?cx/active:0,centerY:active?cy/active:0}};
 }
}
