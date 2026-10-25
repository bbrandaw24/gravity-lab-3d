import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation,frictionSpeed} from '../dist/physics.js';

// Analytic flat-plane Coulomb stopping: v(t)=max(v0-mu*g*t,0).
let v=12;for(let i=0;i<500;i++)v=frictionSpeed(v,.02,.3,9.81,Infinity,1);
assert.equal(v,0);
v=12;for(let i=0;i<50;i++)v=frictionSpeed(v,.02,.3,9.81,Infinity,1);
assert.ok(Math.abs(v-(12-.3*9.81))<1e-10);

// Uniform blanket on an infinite inclined plane: analytic Voellmy velocity.
const nx=25,ny=90,cell=50,angle=Math.PI/6,mu=.155,xi=4000,h=1;
const d={nx,ny,cell,width:(nx-1)*cell,length:(ny-1)*cell,valid:new Array(nx*ny).fill(1),
 elevation:Array.from({length:nx*ny},(_,i)=>3000-Math.floor(i/nx)*cell*Math.tan(angle)),
 releasePlanArea:40000,releaseSurfaceArea:40000/Math.cos(angle),releasePolygon:[[400,1000],[600,1000],[600,1200],[400,1200],[400,1000]]};
const plane=new Simulation(d,{particles:100,mu,xi,thickness:h});
plane.project=()=>plane.sm.fill(h); // prescribed spatially uniform blanket, zero thickness gradient
let speed=0;for(let i=0;i<2000;i++)speed=plane.step(.01);
const acc=9.81*(Math.sin(angle)-mu*Math.cos(angle)),terminal=Math.sqrt(xi*h*(Math.sin(angle)-mu*Math.cos(angle))),expected=terminal*Math.tanh(acc*20/terminal);
assert.ok(Math.abs(speed-expected)/expected<.002,`inclined-plane mismatch ${speed} vs ${expected}`);

const real=JSON.parse(fs.readFileSync(new URL('../dist/terrain.json',import.meta.url)));
const sim=new Simulation(real,{mode:'snow'});let vm=0;
for(let i=0;i<200;i++)vm=sim.step(.05);
sim.project();const projected=sim.h.reduce((a,b)=>a+b,0)*real.cell**2;
const activeVolume=sim.q.reduce((a,b,i)=>a+b*sim.active[i],0);
assert.ok(Math.abs(projected-activeVolume)/sim.volume<1e-10,'particle-grid volume conservation');
const f=sim.snapshot();assert.ok(f.stats.vmax>0&&f.stats.vmax<150);assert.ok([...f.positions].every(Number.isFinite));
const high=new Simulation(real,{mode:'snow',mu:.45});for(let i=0;i<200;i++)high.step(.05);
assert.ok(high.snapshot().stats.vmean<f.stats.vmean,'increased friction must lower early mean speed');
console.log(JSON.stringify({checks:'passed',inclinedPlaneRelativeError:Math.abs(speed-expected)/expected,volumeRelativeError:Math.abs(projected-activeVolume)/sim.volume,publicDEMSpeed10s:f.stats.vmean,highFrictionSpeed10s:high.snapshot().stats.vmean},null,2));
