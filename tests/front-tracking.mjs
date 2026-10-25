import assert from 'node:assert/strict';
import {trackBulkFront} from '../dist/front-tracking.js';
const frame=pts=>Float32Array.from(pts.flatMap(([x,y,v=2,active=1])=>[x,y,1,v,active]));
const main=Array.from({length:100},(_,i)=>[(i%10)*4,Math.floor(i/10)*4+100]);
const a=frame([...main,[2000,5000]]),previous=frame([...main.map(([x,y])=>[x,y-8]),[2000,4992]]);
let f=trackBulkFront(a,{previousPositions:previous});
assert.ok(f.index<100&&f.y>=128&&f.y<=136,'front must stay on dense main flow and reject detached outlier');

// The rear parcel travels farther from its own start; it is still not the front.
const body=frame(Array.from({length:20},(_,i)=>[0,100+i*5]));
const initial=body.slice();initial[1]=-5000;
f=trackBulkFront(body,{initialPositions:initial,direction:[0,1]});
assert.ok(f.y>=180&&f.index!==0,'individual travel distance must not select the front');

// A front can stop while the material behind continues moving.
const p=body.slice();for(let i=16;i<20;i++)p[i*5+3]=0;
const starts=body.slice();for(let i=0;i<20;i++)starts[i*5+1]-=100;
const stoppedEdge=trackBulkFront(p,{initialPositions:starts,direction:[0,1]});
assert.ok(stoppedEdge.y>=180,'the stationary leading deposit must not be replaced by the moving rear');

// Follow a change in flow direction using displacement of the same particles.
const bent=frame(Array.from({length:50},(_,i)=>[100+(i%10)*5,100+Math.floor(i/10)*5]));
const bentPrevious=bent.slice();for(let i=0;i<50;i++)bentPrevious[i*5]-=15;
const bend=trackBulkFront(bent,{previousPositions:bentPrevious});
assert.ok(bend.direction[0]>.99&&bend.x>=135,'front must follow the actual flow direction');

// Once the front exits the domain, never relabel the trailing body as the front.
const gone=a.slice();
const lead=trackBulkFront(a,{previousPositions:previous});
for(const i of lead.support)gone[i*5+4]=0;
const exited=trackBulkFront(gone,{previous:lead,previousPositions:a});
assert.equal(exited.status,'outside');assert.equal(exited.x,lead.x);assert.equal(exited.y,lead.y);
assert.equal(trackBulkFront(a,{previous:exited}).status,'outside');
const rewind=trackBulkFront(a,{previousPositions:previous});assert.deepEqual(rewind,lead,'seeking backwards must reproduce the same front');

const stopped=body.slice();for(let i=0;i<20;i++)stopped[i*5+3]=0;
assert.equal(trackBulkFront(stopped,{initialPositions:starts}).status,'stopped');
assert.equal(trackBulkFront(frame([[0,0,0]]),{initialPositions:frame([[0,0,0]])}),null);
assert.equal(trackBulkFront(frame([[0,0,4,0]])),null);
console.log('Bulk-front tracking: outlier, geometric front, stationary toe, turn, domain exit, rewind and empty-state checks passed');
