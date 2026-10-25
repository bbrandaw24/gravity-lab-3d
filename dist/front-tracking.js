/* Display-only bulk-front estimator. No changes to the physical simulation.
 * Identify the largest connected parcel-volume component on a coarse spatial
 * grid; use its downstream 98.5% volume quantile, not individual displacement.
 * A front leaving the DEM is reported, rather than reassigned to the tail.
 */
export function trackBulkFront(positions,options={}){
 const {previousPositions=null,initialPositions=null,previous=null,weights=null,cell=15}=options;
 if(previous?.status==='outside')return {...previous,status:'outside'};
 if(previous?.support?.length>=3){let lost=0,total=0;for(const i of previous.support){const w=weights?.[i]??1;total+=w;if(positions[i*5+4]<.5)lost+=w;}
  if(lost>total*.4)return {...previous,status:'outside'};
 }
 const bins=new Map(),points=[],size=cell*2;
 for(let i=0;i<positions.length/5;i++){
  const k=i*5,x=positions[k],y=positions[k+1],v=positions[k+3];
  if(positions[k+4]<.5||!Number.isFinite(x+y+v))continue;
  const moved=initialPositions?Math.hypot(x-initialPositions[k],y-initialPositions[k+1]):cell;
  if(v<=.5&&moved<cell*.5)continue;
  const ix=Math.floor(x/size),iy=Math.floor(y/size),key=ix+','+iy;
  if(!bins.has(key))bins.set(key,{ix,iy,ids:[],volume:0});
  const w=weights?.[i]??1,p={i,x,y,v,w,k};points[i]=p;bins.get(key).ids.push(i);bins.get(key).volume+=w;
 }
 if(!bins.size)return null;
 const seen=new Set();let core=[],largest=-1;
 for(const [key,bin]of bins){if(seen.has(key))continue;const queue=[bin],ids=[];let volume=0;seen.add(key);
  for(let head=0;head<queue.length;head++){const b=queue[head];ids.push(...b.ids);volume+=b.volume;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nextKey=(b.ix+dx)+','+(b.iy+dy);if(!seen.has(nextKey)&&bins.has(nextKey)){seen.add(nextKey);queue.push(bins.get(nextKey));}}
  }
  if(volume>largest){largest=volume;core=ids;}
 }
 // Isolated parcels are insufficient to define a bulk front.
 if(core.length<3)return null;
 let cx=0,cy=0,dx=0,dy=0,speed=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const i of core){const p=points[i];cx+=p.x*p.w;cy+=p.y*p.w;speed+=p.v*p.w;
  minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  if(previousPositions&&p.v>.5){dx+=(p.x-previousPositions[p.k])*p.w;dy+=(p.y-previousPositions[p.k+1])*p.w;}}
 cx/=largest;cy/=largest;speed/=largest;
 let direction=previous?.direction??options.direction??[0,1];
 if(Math.hypot(dx,dy)/largest>.05){const len=Math.hypot(dx,dy),nx=dx/len,ny=dy/len;
  if(previous?.direction){const bx=.35*direction[0]+.65*nx,by=.35*direction[1]+.65*ny,bn=Math.hypot(bx,by);direction=bn>1e-6?[bx/bn,by/bn]:[nx,ny];}else direction=[nx,ny];}
 const ranked=core.map(i=>({...points[i],progress:(points[i].x-cx)*direction[0]+(points[i].y-cy)*direction[1]})).sort((a,b)=>a.progress-b.progress||a.i-b.i);
 let accum=0,cut=ranked.at(-1).progress;
 for(const p of ranked){accum+=p.w;if(accum>=largest*.985){cut=p.progress;break;}}
 const width=Math.max(cell,(cut-ranked[0].progress)*.025),eligible=ranked.filter(p=>p.progress<=cut+1e-7);
 const band=eligible.filter(p=>p.progress>=cut-width);
 for(let j=eligible.length-1;band.length<Math.min(3,eligible.length)&&j>=0;j--)if(!band.includes(eligible[j]))band.push(eligible[j]);
 let tx=0,ty=0,volume=0;for(const p of band){tx+=p.x*p.w;ty+=p.y*p.w;volume+=p.w;}tx/=volume;ty/=volume;
 // Pin the marker to an actual parcel in the front band, not a point in a gap.
 let marker=band[0],best=Infinity;for(const p of band){const dist=(p.x-tx)**2+(p.y-ty)**2;if(dist<best){best=dist;marker=p;}}
 return {status:speed>.5?'moving':'stopped',index:marker.i,x:marker.x,y:marker.y,center:[cx,cy],direction,support:band.map(p=>p.i),bounds:[minX,minY,maxX,maxY],volume:largest};
}
