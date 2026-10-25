/* CPU perspective renderer for devices without WebGL. Uses the same 3D geometry,
   camera and numerical trajectories. Terrain is cached until the view changes. */
import * as THREE from 'three';
const cssColor=(r,g,b,shade=1)=>`rgb(${Math.min(255,Math.round(Math.pow(Math.max(0,r*shade),1/2.2)*255))},${Math.min(255,Math.round(Math.pow(Math.max(0,g*shade),1/2.2)*255))},${Math.min(255,Math.round(Math.pow(Math.max(0,b*shade),1/2.2)*255))})`;
export class SoftwareRenderer{
 constructor(canvas){this.domElement=canvas;this.ctx=canvas.getContext('2d');if(!this.ctx)throw new Error('Canvas 2D unavailable');this.cache=document.createElement('canvas');this.cctx=this.cache.getContext('2d');this.dpr=1;this.w=1;this.h=1;this.key='';this.software=true;this.matrix=new THREE.Matrix4();}
 setPixelRatio(r){this.dpr=Math.min(r,1.3);}
 setSize(w,h){this.w=Math.floor(w*this.dpr);this.h=Math.floor(h*this.dpr);this.domElement.width=this.w;this.domElement.height=this.h;this.cache.width=this.w;this.cache.height=this.h;this.key='';}
 project(x,y,z){const a=this.matrix.elements,q=a[3]*x+a[7]*y+a[11]*z+a[15];return[(a[0]*x+a[4]*y+a[8]*z+a[12])/q*this.w/2+this.w/2,-(a[1]*x+a[5]*y+a[9]*z+a[13])/q*this.h/2+this.h/2,(a[2]*x+a[6]*y+a[10]*z+a[14])/q,q];}
 render(scene,camera){
  camera.updateMatrixWorld();this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const meshes=scene.children.filter(o=>o.isMesh&&!o.isInstancedMesh),lines=scene.children.filter(o=>o.isLine&&!o.isLineSegments),contours=scene.children.find(o=>o.isLineSegments);
  const key=this.matrix.elements.map(x=>x.toFixed(7)).join(',')+'|'+meshes.map(m=>m.geometry.attributes.color?.version||0).join(',')+'|'+contours?.visible;
  if(key!==this.key){this.key=key;this.paintStatic(meshes,contours,lines.filter(l=>!l.userData.dynamic&&l.geometry.drawRange.count===Infinity));}
  const ctx=this.ctx;ctx.drawImage(this.cache,0,0);
  for(const obj of scene.children){if(!obj.isInstancedMesh)continue;const mat=obj.instanceMatrix.array,col=obj.instanceColor?.array;
   for(let n=0;n<obj.count;n++){const i=n*16;if(mat[i]===0)continue;const p=this.project(mat[i+12],mat[i+13],mat[i+14]);if(p[3]<0||p[0]<0||p[0]>this.w||p[1]<0||p[1]>this.h||!this.visible(p,.00004))continue;
    const s=Math.hypot(mat[i],mat[i+1],mat[i+2]),r=Math.max(1.15,s/p[3]*this.h*1.45);
    ctx.fillStyle=col?cssColor(col[n*3],col[n*3+1],col[n*3+2]):'#f6fbff';ctx.beginPath();ctx.ellipse(p[0],p[1],r,r*.75,0,0,Math.PI*2);ctx.fill();
   }
  }
  for(const line of lines)if(line.visible&&line.geometry.drawRange.count<Infinity&&line.geometry.drawRange.count>1){const a=line.geometry.attributes.position.array,count=line.geometry.drawRange.count;ctx.beginPath();for(let i=0;i<count;i++){const p=this.project(a[i*3],a[i*3+1],a[i*3+2]);if(!i)ctx.moveTo(p[0],p[1]);else ctx.lineTo(p[0],p[1]);}ctx.lineWidth=1.5*this.dpr;ctx.strokeStyle='#528f73';ctx.stroke();}
  for(const line of scene.children)if(line.isLineSegments&&line.userData.dynamic&&line.visible){const a=line.geometry.attributes.position.array,count=line.geometry.drawRange.count;ctx.beginPath();
   for(let i=0;i<count;i+=2){const p=this.project(a[i*3],a[i*3+1],a[i*3+2]),q=this.project(a[i*3+3],a[i*3+4],a[i*3+5]);if(p[3]>0&&q[3]>0&&this.visible(q,.00004)){ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);}}
   ctx.lineCap='round';ctx.lineWidth=3.5*this.dpr;ctx.strokeStyle='#17546b99';ctx.stroke();ctx.lineWidth=1.4*this.dpr;ctx.strokeStyle='#ffffffeb';ctx.stroke();
  }
 }
 visible(p,tolerance=.00002){if(!this.depth)return true;const x=Math.floor(p[0]*this.dw/this.w),y=Math.floor(p[1]*this.dh/this.h);if(x<0||y<0||x>=this.dw||y>=this.dh)return false;return p[2]<=this.depth[y*this.dw+x]+tolerance;}
 paintStatic(meshes,contours,release){
  const ctx=this.cctx;ctx.fillStyle='#e4ece6';ctx.fillRect(0,0,this.w,this.h);
  ctx.strokeStyle='#cdd9c8';ctx.lineWidth=.6*this.dpr;for(let k=-3000;k<=3000;k+=250){for(const pair of[[[k,-58,-3000],[k,-58,3000]],[[-3000,-58,k],[3000,-58,k]]]){const a=this.project(...pair[0]),b=this.project(...pair[1]);if(a[3]>0&&b[3]>0){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();}}}
  const faces=[];this.dw=Math.ceil(this.w/4);this.dh=Math.ceil(this.h/4);this.depth=new Float32Array(this.dw*this.dh).fill(Infinity);
  for(const mesh of meshes){const geo=mesh.geometry,a=geo.attributes.position.array,cs=geo.attributes.color?.array,ns=geo.attributes.normal?.array,ids=geo.index?.array,pp=[];for(let i=0;i<a.length;i+=3)pp.push(this.project(a[i],a[i+1],a[i+2]));
   const len=ids?ids.length:a.length/3;for(let i=0;i<len;i+=3){const ia=ids?ids[i]:i,ib=ids?ids[i+1]:i+1,ic=ids?ids[i+2]:i+2,p=pp[ia],q=pp[ib],r=pp[ic];if(p[3]<0||q[3]<0||r[3]<0)continue;
    const ny=ns?(ns[ia*3+1]+ns[ib*3+1]+ns[ic*3+1])/3:.6,nx=ns?(ns[ia*3]+ns[ib*3]+ns[ic*3])/3:0,nz=ns?(ns[ia*3+2]+ns[ib*3+2]+ns[ic*3+2])/3:0,shade=.62+.42*Math.max(0,ny*.75-nx*.35+nz*.55);
    const col=cs?cssColor((cs[ia*3]+cs[ib*3]+cs[ic*3])/3,(cs[ia*3+1]+cs[ib*3+1]+cs[ic*3+1])/3,(cs[ia*3+2]+cs[ib*3+2]+cs[ic*3+2])/3,shade):cssColor(mesh.material.color.r,mesh.material.color.g,mesh.material.color.b,shade);
    faces.push({p,q,r,z:(p[2]+q[2]+r[2])/3,col});
   }
  }
  faces.sort((a,b)=>b.z-a.z);for(const {p,q,r,col}of faces){ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.lineTo(r[0],r[1]);ctx.closePath();ctx.fillStyle=col;ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=.3;ctx.stroke();this.rasterDepth(p,q,r);}
  if(contours?.visible){const a=contours.geometry.attributes.position.array;ctx.strokeStyle='#4a72574d';ctx.lineWidth=.6*this.dpr;ctx.beginPath();for(let i=0;i<a.length;i+=6){const p=this.project(a[i],a[i+1],a[i+2]),q=this.project(a[i+3],a[i+4],a[i+5]);if(this.visible(p)&&this.visible(q)){ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);}}ctx.stroke();}
  for(const l of release){const a=l.geometry.attributes.position.array;ctx.beginPath();for(let i=0;i<a.length;i+=3){const p=this.project(a[i],a[i+1],a[i+2]);if(i===0)ctx.moveTo(p[0],p[1]);else ctx.lineTo(p[0],p[1]);}ctx.strokeStyle='#3b9b83';ctx.lineWidth=1.7*this.dpr;ctx.stroke();}
 }
 rasterDepth(p,q,r){
  const sx=this.dw/this.w,sy=this.dh/this.h,ax=p[0]*sx,ay=p[1]*sy,bx=q[0]*sx,by=q[1]*sy,cx=r[0]*sx,cy=r[1]*sy;
  const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-8)return;
  const xmin=Math.max(0,Math.floor(Math.min(ax,bx,cx))),xmax=Math.min(this.dw-1,Math.ceil(Math.max(ax,bx,cx))),ymin=Math.max(0,Math.floor(Math.min(ay,by,cy))),ymax=Math.min(this.dh-1,Math.ceil(Math.max(ay,by,cy)));
  for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den,v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den,w=1-u-v;if(u>=-.05&&v>=-.05&&w>=-.05){const z=u*p[2]+v*q[2]+w*r[2],i=y*this.dw+x;if(z<this.depth[i])this.depth[i]=z;}}
 }
}
