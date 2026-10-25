import {Simulation} from './physics.js';
let token=0;
self.onmessage=async e=>{
 const id=++token,{terrain,params}=e.data,sim=new Simulation(terrain,params);let next=0,vmax=0;
 const end=180;
 while(sim.time<end-1e-6){
  if(id!==token)return;
  if(sim.time>=next-1e-6){const f=sim.snapshot();self.postMessage({type:'frame',frame:f},[f.positions.buffer]);next+=.75;}
  const dt=Math.min(.1,.28*terrain.cell/(vmax+Math.sqrt(9.81*Math.max(1,sim.initialDepth))),next-sim.time,end-sim.time);
  vmax=sim.step(Math.max(.000001,dt));
  if(Math.floor(sim.time*10)%40===0)await new Promise(r=>setTimeout(r,0));
 }
 const f=sim.snapshot();self.postMessage({type:'frame',frame:f},[f.positions.buffer]);self.postMessage({type:'done',particles:sim.N});
};
