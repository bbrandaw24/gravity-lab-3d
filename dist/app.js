import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {SoftwareRenderer} from './software.js?v=2';
import {trackBulkFront} from './front-tracking.js?v=4';
const $=id=>document.getElementById(id), clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const fmt=(x,n=0)=>Number(x).toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n});
let terrain,renderer,scene,camera,orbit,mountain,contours,particles,trail,lineGeom,releasePoint,motionTrails;
let following=true,frontPoint=null,firstFocus=true,parcelVolumes=null;
const focusTarget=new THREE.Vector3(),focusOffset=new THREE.Vector3(.65,.68,1).normalize();let focusDistance=1400;
let frames=[],currentTime=0,playing=false,completed=false,worker,mode='snow',params,activeParams,frameId=-1;
let lastWall=performance.now(),chartDirty=true,dirty=false,cameraMode='perspective';
const dummy=new THREE.Object3D(),color=new THREE.Color(),normal=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
const showToast=s=>{$('toast').textContent=s;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2800);};
function sample(a,x,y){const xx=clamp(x/terrain.cell,0,terrain.nx-1.00001),yy=clamp(y/terrain.cell,0,terrain.ny-1.00001),i=Math.floor(xx),j=Math.floor(yy),fx=xx-i,fy=yy-j,k=j*terrain.nx+i;return(a[k]*(1-fx)+a[k+1]*fx)*(1-fy)+(a[k+terrain.nx]*(1-fx)+a[k+terrain.nx+1]*fx)*fy;}
function surfaceHeight(x,y){
 const xx=clamp(x/terrain.cell,0,terrain.nx-1.00001),yy=clamp(y/terrain.cell,0,terrain.ny-1.00001),i=Math.floor(xx),j=Math.floor(yy),fx=xx-i,fy=yy-j,k=j*terrain.nx+i,z=terrain.elevation;
 // Match the rendered triangular DEM exactly, preventing material from being
 // hidden under a nonplanar cell's mesh. Physics continues to use its own DEM.
 return fx+fy<=1?z[k]+(z[k+1]-z[k])*fx+(z[k+terrain.nx]-z[k])*fy:z[k+terrain.nx+1]+(z[k+terrain.nx]-z[k+terrain.nx+1])*(1-fx)+(z[k+1]-z[k+terrain.nx+1])*(1-fy);
}
function pos(x,y,extra=0){return new THREE.Vector3(x-terrain.width/2,surfaceHeight(x,y)-terrain.zmin+extra,y-terrain.length/2);}
function buildTerrain(){
 const {nx,ny,cell,elevation:z,valid,width,length,zmin}=terrain,vertices=[],indices=[],colors=[];
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i;vertices.push(i*cell-width/2,z[k]-zmin,j*cell-length/2);colors.push(0,0,0);}
 for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const k=j*nx+i;if(valid[k]&&valid[k+1]&&valid[k+nx])indices.push(k,k+nx,k+1);if(valid[k+1]&&valid[k+nx+1]&&valid[k+nx])indices.push(k+1,k+nx,k+nx+1);}
 const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geom.setIndex(indices);geom.computeVertexNormals();
 mountain=new THREE.Mesh(geom,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide}));scene.add(mountain);
 const sideVerts=[];
 for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const k=j*nx+i;if(!valid[k])continue;
  for(const [a,b]of[[k,k+1],[k,k+nx]]){if(!valid[b])continue;const horiz=b===k+1;
   const before=horiz?(j>0?valid[k-nx]&&valid[k-nx+1]:false):(i>0?valid[k-1]&&valid[k+nx-1]:false);
   const after=horiz?(j<ny-1?valid[k+nx]&&valid[k+nx+1]:false):(i<nx-1?valid[k+1]&&valid[k+nx+1]:false);
   if(before&&after)continue;const ax=vertices[a*3],ay=vertices[a*3+1],az=vertices[a*3+2],bx=vertices[b*3],by=vertices[b*3+1],bz=vertices[b*3+2];
   sideVerts.push(ax,ay,az,bx,by,bz,ax,-45,az,bx,by,bz,bx,-45,bz,ax,-45,az);
  }
 }
 const sides=new THREE.BufferGeometry();sides.setAttribute('position',new THREE.Float32BufferAttribute(sideVerts,3));sides.computeVertexNormals();scene.add(new THREE.Mesh(sides,new THREE.MeshStandardMaterial({color:0x7e8d7e,roughness:1,side:THREE.DoubleSide})));
 const seg=[];
 for(let level=600;level<2500;level+=100)for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
  const ids=[j*nx+i,j*nx+i+1,(j+1)*nx+i+1,(j+1)*nx+i];if(ids.some(k=>!valid[k]))continue;
  const hits=[];for(let e=0;e<4;e++){const a=ids[e],b=ids[(e+1)%4];if((z[a]<=level&&z[b]>level)||(z[b]<=level&&z[a]>level)){const f=(level-z[a])/(z[b]-z[a]);hits.push(new THREE.Vector3(((a%nx)*(1-f)+(b%nx)*f)*cell-width/2,level-zmin+1.3,(Math.floor(a/nx)*(1-f)+Math.floor(b/nx)*f)*cell-length/2));}}
  for(let n=0;n+1<hits.length;n+=2)seg.push(...hits[n].toArray(),...hits[n+1].toArray());
 }
 const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(seg,3));contours=new THREE.LineSegments(cg,new THREE.LineBasicMaterial({color:0x47715c,transparent:true,opacity:.18,depthWrite:false}));scene.add(contours);
 const poly=terrain.releasePolygon.map(p=>pos(p[0],p[1],6));const relGeom=new THREE.BufferGeometry().setFromPoints(poly);
 scene.add(new THREE.Line(relGeom,new THREE.LineBasicMaterial({color:0x3a9c86,transparent:true,opacity:.9})));
 const center=terrain.releasePolygon.reduce((a,b)=>[a[0]+b[0],a[1]+b[1]],[0,0]).map(v=>v/terrain.releasePolygon.length);
 releasePoint=pos(...center,25);
 const grid=new THREE.GridHelper(6000,30,0xb9cbb5,0xccd8c7);grid.position.y=-58;grid.material.transparent=true;grid.material.opacity=.35;scene.add(grid);
 lineGeom=new THREE.BufferGeometry();lineGeom.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(241*3),3));lineGeom.setDrawRange(0,0);trail=new THREE.Line(lineGeom,new THREE.LineBasicMaterial({color:0x3f9979,transparent:true,opacity:.8,depthWrite:false}));scene.add(trail);
 const mg=new THREE.BufferGeometry();mg.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(400*6),3));mg.setDrawRange(0,0);
 motionTrails=new THREE.LineSegments(mg,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.9,depthWrite:false}));motionTrails.userData.dynamic=true;motionTrails.frustumCulled=false;scene.add(motionTrails);
 paintTerrain();
}
function paintTerrain(){
 const attr=mountain.geometry.attributes.color,normals=mountain.geometry.attributes.normal;
 for(let i=0;i<terrain.elevation.length;i++){
  const z=terrain.elevation[i],slope=1-Math.max(0,normals.getY(i)),noise=Math.sin(i*43.71)*.018;
  if(mode==='snow'){
   color.set('#849b7a');color.lerp(new THREE.Color('#b7bcb0'),clamp((z-1000)/800,0,1)*.9);
   color.lerp(new THREE.Color('#edf1ed'),clamp((z-1550)/400,0,1)*(1-slope*.5));
  }else{color.set('#899b72');color.lerp(new THREE.Color('#aea18b'),clamp((z-900)/1000,0,1));color.lerp(new THREE.Color('#bfbcb0'),clamp((z-1950)/400,0,1));}
  color.offsetHSL(0,0,noise-slope*.12);attr.setXYZ(i,color.r,color.g,color.b);
 }attr.needsUpdate=true;
}
function setView(type){cameraMode=type;following=type==='focus';$('focusBtn').classList.toggle('selected',following);$('perspectiveBtn').classList.toggle('selected',type==='perspective');$('topBtn').classList.toggle('selected',type==='top');
 if(following){orbit.target.copy(focusTarget);camera.position.copy(focusTarget).addScaledVector(focusOffset,focusDistance);}
 else if(type==='top'){camera.position.set(0,6500,1);orbit.target.set(0,650,0);}else{camera.position.set(3200,3200,4400);orbit.target.set(-50,700,-100);}camera.up.set(0,1,0);orbit.update();}
function init3d(){
 const probe=document.createElement('canvas');let hardware=false;try{hardware=!!probe.getContext('webgl2');}catch{}
 renderer=hardware?new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'}):new SoftwareRenderer($('world'));
 renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.8));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
 scene=new THREE.Scene();scene.background=new THREE.Color('#e4ece6');scene.fog=new THREE.Fog('#e4ece6',8000,18000);
 camera=new THREE.PerspectiveCamera(38,1,5,30000);orbit=new OrbitControls(camera,$('world'));orbit.enableDamping=true;orbit.dampingFactor=.07;orbit.minDistance=250;orbit.maxDistance=11000;orbit.maxPolarAngle=Math.PI*.49;
 scene.add(new THREE.HemisphereLight(0xffffff,0x6f8062,2.2));const sun=new THREE.DirectionalLight(0xfff8e5,3.3);sun.position.set(-2500,4500,1800);scene.add(sun);
 buildTerrain();focusTarget.copy(releasePoint);setView('focus');
 orbit.addEventListener('start',()=>{following=false;$('focusBtn').classList.remove('selected');});
 new ResizeObserver(()=>{const w=$('viewport').clientWidth,h=$('viewport').clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();chartDirty=true;}).observe($('viewport'));
 $('loading').hidden=true;
 requestAnimationFrame(animate);
}
function collectParams(){return mode==='snow'?{mode,mu:+$('muRange').value,xi:+$('xiRange').value,thickness:+$('depthRange').value}:{mode,mu:Math.tan(+$('muRange').value*Math.PI/180),volume:+$('depthRange').value};}
function updateInputText(){const snow=mode==='snow';params=collectParams();$('depthVal').innerHTML=snow?`${params.thickness.toFixed(2)} <small>m</small>`:`${fmt(params.volume)} <small>m³</small>`;$('muVal').textContent=snow?params.mu.toFixed(3):`${$('muRange').value}°`;$('xiVal').innerHTML=`${fmt(+$('xiRange').value)} <small>m/s²</small>`;$('volumeVal').textContent=fmt(snow?terrain.releaseSurfaceArea*params.thickness:params.volume)+' m³';}
function loadPreset(newMode){mode=newMode;document.body.classList.toggle('slide',mode==='slide');const snow=mode==='snow';$('snowBtn').classList.toggle('active',snow);$('slideBtn').classList.toggle('active',!snow);
 $('sceneNo').textContent=snow?'01':'02';$('sceneTitle').textContent=snow?'雪，从山顶出发。':'山体，开始流动。';$('sceneDesc').textContent=snow?'释放一层积雪，观察它在重力、摩擦与地形之间，如何加速、扩散、停积。':'借用已发表的滑坡体积与底面摩擦角，在同一公开地形上，观察颗粒物料的运移。';
 $('depthLabel').textContent=snow?'释放厚度 h₀':'初始体积 V₀';Object.assign($('depthRange'),snow?{min:.3,max:3,step:.1,value:1}:{min:5000,max:100000,step:1000,value:26000});
 $('depthMin').textContent=snow?'0.3 m':'5,000 m³';$('depthMax').textContent=snow?'3.0 m':'100,000 m³';$('depthHint').textContent=snow?'基准来自公开释放区 thickness 字段':'基准来自 Shum Wan 滑坡文献算例';
 $('muLabel').textContent=snow?'底面摩擦系数 μ':'底面有效摩擦角 δ';Object.assign($('muRange'),snow?{min:.08,max:.5,step:.005,value:.155}:{min:8,max:40,step:1,value:18});$('muMin').textContent=snow?'0.080 · 更易滑动':'8° · 更易滑动';$('muMax').textContent=snow?'0.500 · 更难滑动':'40° · 更难滑动';$('xiField').hidden=!snow;$('xiRange').value=4000;
 $('rhoLabel').textContent=snow?'雪密度 ρ':'摩擦模型';$('rhoValue').textContent=snow?'200 kg/m³':'库仑 μ = tan δ';$('boundaryNote').textContent=snow?'无侵蚀卷入 · 无粉雪云':'同一地形对照 · 非历史事故复现';
 if(mountain)paintTerrain();updateInputText();calculate();
}
function calculate(){
 worker?.terminate();activeParams={...collectParams()};frames=[];currentTime=0;frameId=-1;completed=false;playing=false;dirty=false;chartDirty=true;
 frontPoint=null;parcelVolumes=null;firstFocus=true;motionTrails.geometry.setDrawRange(0,0);$('frontTag').hidden=true;
 $('applyBtn').disabled=true;$('applyBtn').innerHTML='正在计算… <span>◌</span>';$('calcStatus').textContent='按当前参数重新计算运动过程';$('playBtn').disabled=true;$('playBtn').textContent='▶';$('computeLabel').textContent='深度平均求解中';$('timeline').value=0;
 if(particles){scene.remove(particles);particles.geometry.dispose();particles.material.dispose();particles=null;}
 worker=new Worker('./worker.js?v=3',{type:'module'});const computation=worker;
 worker.onmessage=e=>{
  if(worker!==computation)return;
  if(e.data.type==='init'){parcelVolumes=e.data.volumes;return;}
  if(e.data.type==='frame'){
   const f=e.data.frame,previousFrame=frames.at(-1);f.front=f.time>.3?trackBulkFront(f.positions,{previousPositions:previousFrame?.positions,initialPositions:frames[0]?.positions,previous:previousFrame?.front,weights:parcelVolumes,cell:terrain.cell}):null;
   frames.push(f);const a=f.positions;f.center=f.stats.escaped<.99999?[f.stats.centerX,f.stats.centerY]:null;
   if(!particles){particles=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial(),a.length/5);particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);particles.frustumCulled=false;scene.add(particles);}
   if(frames.length===1)drawFrame(0);if(frames.length>1)$('playBtn').disabled=false;chartDirty=true;
   $('calcStatus').textContent=`已计算 ${fmt(f.time,0)} / 180 s`;
  }else if(e.data.type==='done'){
   completed=true;$('applyBtn').disabled=false;$('applyBtn').innerHTML='重新计算 <span>↗</span>';$('calcStatus').textContent='计算完成 · 修改参数可再次运行';$('computeLabel').textContent=`${fmt(e.data.particles)} 个物料柱 · ${renderer.software?'兼容 3D 渲染':'WebGL'} · Δt ≤ 0.1 s`;chartDirty=true;
  }
 };
 worker.onerror=e=>{console.error(e);$('applyBtn').disabled=false;$('applyBtn').innerHTML='重试计算 <span>↗</span>';$('calcStatus').textContent='计算中断，请点击重试';$('computeLabel').textContent='计算未完成';showToast('计算未完成，可重新计算');};
 worker.postMessage({terrain,params:activeParams});
}
function drawFrame(t){
 if(!frames.length||!particles)return;const idx=Math.min(frames.length-1,Math.floor(t/.75)),f=frames[idx],f2=frames[Math.min(idx+1,frames.length-1)],r=f2.time>f.time?clamp((t-f.time)/(f2.time-f.time),0,1):0,a=f.positions,b=f2.positions;
 const speedMode=$('speedCheck').checked,snow=mode==='snow',enhanced=$('enhanceCheck').checked;
 let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 frontPoint=null;
 for(let n=0;n<particles.count;n++){
  const k=n*5,x=a[k]+(b[k]-a[k])*r,y=a[k+1]+(b[k+1]-a[k+1])*r,h=a[k+2]+(b[k+2]-a[k+2])*r,v=a[k+3]+(b[k+3]-a[k+3])*r,act=r<.5?a[k+4]:b[k+4];
  if(act<.5){dummy.position.set(0,-10000,0);dummy.scale.setScalar(0);}else{
   dummy.position.copy(pos(x,y,(enhanced?9:4)+Math.min(h,10)*.4));const sx=(sample(terrain.elevation,x+15,y)-sample(terrain.elevation,x-15,y))/30,sy=(sample(terrain.elevation,x,y+15)-sample(terrain.elevation,x,y-15))/30;
   normal.set(-sx,1,-sy).normalize();dummy.quaternion.setFromUnitVectors(up,normal);const size=enhanced?(v>.5||t<.3?10:7):(snow?4.7:4);
   dummy.scale.set(size,enhanced?clamp(h,2.2,7):clamp(h*.45,1,4),size);
   if(v>.5||t<.3){minX=Math.min(minX,dummy.position.x);maxX=Math.max(maxX,dummy.position.x);minY=Math.min(minY,dummy.position.y);maxY=Math.max(maxY,dummy.position.y);minZ=Math.min(minZ,dummy.position.z);maxZ=Math.max(maxZ,dummy.position.z);}
  }
  dummy.updateMatrix();particles.setMatrixAt(n,dummy.matrix);
  if(speedMode){const z=clamp(v/60,0,1);if(z<.5)color.set('#4489b9').lerp(new THREE.Color('#63c3b1'),z*2);else if(z<.8)color.set('#63c3b1').lerp(new THREE.Color('#e8cd69'),(z-.5)/.3);else color.set('#e8cd69').lerp(new THREE.Color('#d9673e'),(z-.8)/.2);}
  else if(enhanced){const moving=v>.5||t<.3;color.set(snow?(moving?(n%4===0?'#69d9ff':'#008cda'):'#294f87'):(moving?(n%4===0?'#ffc051':'#f96a19'):'#82452e'));}
  else color.set(snow?(n%4===0?'#c2dce4':'#f6fbff'):(n%4===0?'#8e633f':'#b18b5d'));
  particles.setColorAt(n,color);
 }particles.instanceMatrix.needsUpdate=true;if(particles.instanceColor)particles.instanceColor.needsUpdate=true;
 const bulk=(r<.5?f.front:f2.front)??f.front;
 if(bulk&&t>.3){
  if(bulk.status==='outside'){$('frontTag').hidden=true;$('frontTag').dataset.state='outside';$('frontTag').title='主体前缘已部分流出公开 DEM，域外前缘无法继续追踪';}
  else{const k=bulk.index*5,x=a[k]+(b[k]-a[k])*r,y=a[k+1]+(b[k+1]-a[k+1])*r,h=a[k+2]+(b[k+2]-a[k+2])*r;
   if((r===0?a[k+4]:b[k+4])>.5)frontPoint=pos(x,y,(enhanced?9:4)+Math.min(h,10)*.4);
   $('frontTag').dataset.state=bulk.status;$('frontTag').title='最大连通物料主体，沿流向的 98.5% 体积分位前沿';
   const label=$('frontTag').querySelector('span');label.firstChild.textContent=bulk.status==='stopped'?'停积前缘 ':'主体前缘 ';label.querySelector('small').textContent='主流动体 · 排除离群颗粒';
  }
 }
 if(Number.isFinite(minX)){focusTarget.set((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2);
  const span=Math.max(maxX-minX,maxY-minY,maxZ-minZ);focusDistance=clamp(span*2.5/Math.min(1,camera.aspect),1100,7200);
  if(frontPoint){const center=pos(...bulk.center,0);focusTarget.copy(center).lerp(frontPoint,.65);const bounds=bulk.bounds;
   const coreSpan=Math.max(bounds[2]-bounds[0],bounds[3]-bounds[1],Math.abs(center.y-frontPoint.y));focusDistance=clamp(coreSpan*2.7/Math.min(1,camera.aspect),1100,7200);}
  else if(bulk?.status==='outside')focusTarget.copy(pos(bulk.x,bulk.y,9));
  if(following&&firstFocus){orbit.target.copy(focusTarget);camera.position.copy(focusTarget).addScaledVector(focusOffset,focusDistance);firstFocus=false;}}
 const ma=motionTrails.geometry.attributes.position;let mc=0;
 if(enhanced&&t>.75)for(let n=0;n<particles.count;n+=75){const k=n*5;if(a[k+4]<.5||a[k+3]<=.5)continue;
  for(let j=Math.max(0,idx-5);j<idx;j++){const previous=frames[j].positions,next=frames[j+1].positions;if(previous[k+4]<.5||next[k+4]<.5)continue;
   const p1=pos(previous[k],previous[k+1],16),p2=pos(next[k],next[k+1],16);ma.setXYZ(mc++,p1.x,p1.y,p1.z);ma.setXYZ(mc++,p2.x,p2.y,p2.z);}}
 ma.needsUpdate=true;motionTrails.geometry.setDrawRange(0,mc);motionTrails.visible=enhanced;
 $('bodyLegend').hidden=!enhanced||speedMode;$('motionLegend').textContent=snow?'释放 / 运动雪体':'释放 / 运动土体';$('bodyLegend').classList.toggle('earth',!snow);
 const st={};for(const k of Object.keys(f.stats))st[k]=f.stats[k]+(f2.stats[k]-f.stats[k])*r;
 $('maxSpeed').textContent=fmt(st.vmax,1);$('runout').textContent=fmt(st.runout);$('moving').textContent=fmt(st.moving*100,1);$('timeVal').textContent=fmt(t,1);$('timeline').value=t;
 $('speedNote').textContent=t<.2?'静止的初始释放区':`平均速度 ${fmt(st.vmean,1)} m/s`;
 $('phaseBadge').textContent=t<.2?'● 待释放':bulk?.status==='outside'?'◌ 主体前缘已部分流出 DEM':st.escaped>.05?'◌ 部分流出计算域':st.moving<.02?'● 基本停积':'● 正在运移';
 $('boundaryNote').textContent=st.escaped>.005?`已有 ${fmt(st.escaped*100,1)}% 体积流出 DEM，后续未模拟`:(snow?'无侵蚀卷入 · 无粉雪云':'同一地形对照 · 非历史事故复现');
 $('releaseTagSub').textContent=snow?`公开边界 · 初始厚度 ${activeParams.thickness.toFixed(1)} m`:`文献参数 · V₀ ${fmt(activeParams.volume)} m³`;
 const verts=lineGeom.attributes.position;let count=0;for(let i=0;i<=idx;i++)if(frames[i].center){const p=pos(...frames[i].center,10);verts.setXYZ(count++,p.x,p.y,p.z);}verts.needsUpdate=true;lineGeom.setDrawRange(0,count);lineGeom.computeBoundingSphere();frameId=idx;chartDirty=true;
}
function drawChart(){
 const cv=$('chart'),ctx=cv.getContext('2d'),w=cv.width,h=cv.height,pad=7;ctx.clearRect(0,0,w,h);if(!frames.length)return;
 const max=Math.max(20,...frames.map(x=>x.stats.vmax))*1.1,sy=v=>h-pad-v/max*(h-2*pad),sx=t=>pad+t/180*(w-2*pad);
 ctx.strokeStyle='#dfe7d9';ctx.lineWidth=1;for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(pad,h*i/3);ctx.lineTo(w-pad,h*i/3);ctx.stroke();}
 ctx.beginPath();frames.forEach((f,i)=>i?ctx.lineTo(sx(f.time),sy(f.stats.vmax)):ctx.moveTo(sx(f.time),sy(f.stats.vmax)));ctx.strokeStyle=mode==='snow'?'#84a28a':'#b19676';ctx.lineWidth=2;ctx.stroke();
 const x=sx(currentTime);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.strokeStyle='#426e51';ctx.lineWidth=1;ctx.stroke();chartDirty=false;
}
function animate(wall){
 const dt=Math.min(.06,(wall-lastWall)/1000);lastWall=wall;
 if(playing&&frames.length>1){const max=frames.at(-1).time;currentTime=Math.min(currentTime+dt*+$('rateSelect').value,max);drawFrame(currentTime);if(completed&&currentTime>=180){playing=false;$('playBtn').textContent='▶';$('playBtn').setAttribute('aria-label','重新播放');}}
 if(following){const alpha=1-Math.exp(-dt/0.22),target=orbit.target.clone().lerp(focusTarget,alpha);orbit.target.copy(target);const desired=target.clone().addScaledVector(focusOffset,focusDistance);camera.position.lerp(desired,alpha);}
 orbit.update();camera.updateMatrixWorld(true);const p=releasePoint.clone().project(camera),w=$('viewport').clientWidth,h=$('viewport').clientHeight;$('releaseTag').style.left=`${(p.x*.5+.5)*w}px`;$('releaseTag').style.top=`${(-p.y*.5+.5)*h}px`;$('releaseTag').hidden=p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;
 if(frontPoint&&$('enhanceCheck').checked){const f=frontPoint.clone().project(camera);$('frontTag').style.left=`${(f.x*.5+.5)*w}px`;$('frontTag').style.top=`${(-f.y*.5+.5)*h}px`;$('frontTag').hidden=f.z>1||Math.abs(f.x)>1||Math.abs(f.y)>1;}else $('frontTag').hidden=true;
 renderer.render(scene,camera);if(chartDirty)drawChart();requestAnimationFrame(animate);
}
function bind(){
 const dlg=$('sourceDialog');$('sourcesBtn').onclick=$('dataLink').onclick=()=>dlg.showModal();$('closeDialog').onclick=()=>dlg.close();dlg.addEventListener('click',e=>{if(e.target===dlg){const r=dlg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dlg.close();}});
 $('snowBtn').onclick=()=>{if(mode!=='snow')loadPreset('snow');};$('slideBtn').onclick=()=>{if(mode!=='slide')loadPreset('slide');};$('resetParams').onclick=()=>loadPreset(mode);$('applyBtn').onclick=()=>{updateInputText();calculate();};
 for(const id of ['depthRange','muRange','xiRange'])$(id).addEventListener('input',()=>{updateInputText();dirty=true;$('calcStatus').textContent='参数已修改，点击「重新计算」后生效';});
 $('playBtn').onclick=()=>{if(dirty){showToast('参数已修改；当前播放仍使用上一次计算参数');}if(currentTime>=180)currentTime=0;playing=!playing;$('playBtn').textContent=playing?'Ⅱ':'▶';$('playBtn').setAttribute('aria-label',playing?'暂停仿真':'开始仿真');};
 $('restartBtn').onclick=()=>{playing=false;currentTime=0;$('playBtn').textContent='▶';drawFrame(0);};$('timeline').oninput=()=>{playing=false;$('playBtn').textContent='▶';currentTime=Math.min(+$('timeline').value,frames.at(-1)?.time||0);drawFrame(currentTime);};
 $('contourCheck').onchange=()=>contours.visible=$('contourCheck').checked;$('speedCheck').onchange=()=>{$('speedLegend').hidden=!$('speedCheck').checked;drawFrame(currentTime);};$('trailCheck').onchange=()=>trail.visible=$('trailCheck').checked;
 $('enhanceCheck').onchange=()=>drawFrame(currentTime);
 $('focusBtn').onclick=()=>setView('focus');$('homeBtn').onclick=()=>setView('focus');$('perspectiveBtn').onclick=()=>setView('perspective');$('topBtn').onclick=()=>setView('top');$('fullBtn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewport').requestFullscreen();}catch{showToast('当前浏览器不支持全屏，可横屏查看');}};
 $('exportBtn').onclick=()=>{
  if(!frames.length)return showToast('请等待计算结果');const header='# Gravity Lab educational approximation; NOT a reconstruction or hazard prediction\n# terrain=AvaFrame avaAlr; grid=15m; source_commit='+terrain.sourceCommit+'\n# parameters='+JSON.stringify(activeParams)+'\n# fixed_volume_m3='+frames[0].stats.volume+'\n';
  const body='time_s,max_speed_m_s,mean_speed_m_s,max_horizontal_displacement_m,moving_volume_fraction,escaped_volume_fraction,max_normal_thickness_m\n'+frames.map(f=>[f.time,f.stats.vmax,f.stats.vmean,f.stats.runout,f.stats.moving,f.stats.escaped,f.stats.maxH].map(n=>n.toFixed(6)).join(',')).join('\n');
  const blob=new Blob(['\uFEFF'+header+body],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`gravity-lab-${mode}-results.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast(completed?'已导出完整计算序列':'已导出当前已完成的计算序列');
 };
}
async function boot(){try{const response=await fetch('./terrain.json');if(!response.ok)throw new Error('DEM failed');terrain=await response.json();init3d();bind();loadPreset('snow');}catch(e){console.error(e);$('loading').hidden=true;$('webglError').hidden=false;$('webglError').textContent='地形或 3D 图形初始化失败。请刷新页面，或用支持 WebGL 的浏览器打开。';$('calcStatus').textContent='初始化未完成';}}
boot();
