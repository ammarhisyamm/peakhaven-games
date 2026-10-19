import test from 'node:test';
import assert from 'node:assert/strict';
import {drawSequenceCrystal,sequenceSpecialSprites} from '../dist/gameplay-art.js';
import {PLAIN,STRIPE_V,STRIPE_H,WRAP,BOMB} from '../dist/sequence-v3.js';
let ready=true;
globalThis.Image=class {complete=true;naturalHeight=256;set src(v){this.url=v;}get naturalWidth(){return ready?256:0;}};
function canvas(){const calls=[];return {calls,globalAlpha:.35,save(){},restore(){},translate(){},rotate(v){calls.push(['rotate',v]);},drawImage(image){calls.push(['image',image.url]);}};}
const images=c=>c.calls.filter(a=>a[0]==='image').map(a=>a[1]);
test('four-match art preserves each gem colour and points along the row or column blast',()=>{
 for(let colour=0;colour<7;colour++){
  const vertical=canvas(),horizontal=canvas();
  assert.equal(drawSequenceCrystal(vertical,STRIPE_V,colour,20,20,28),true);
  assert.equal(drawSequenceCrystal(horizontal,STRIPE_H,colour,20,20,28),true);
  assert.equal(images(vertical).length,2);assert.equal(images(horizontal)[0],images(vertical)[0]);
  assert.ok(images(vertical)[1].endsWith('/special-stripe.webp'));
  assert.deepEqual(vertical.calls.filter(a=>a[0]==='rotate').map(a=>a[1]),[0,0]);
  assert.deepEqual(horizontal.calls.filter(a=>a[0]==='rotate').map(a=>a[1]),[0,Math.PI/2]);
  assert.equal(vertical.globalAlpha,.35,'clearing fade is retained');
 }
});
test('wrapped art overlays its original colour; colour bomb replaces the ordinary gem',()=>{
 const wrapped=canvas(),bomb=canvas(),plain=canvas();
 assert.equal(drawSequenceCrystal(wrapped,WRAP,3,0,0,30),true);
 assert.deepEqual(images(wrapped),['assets/gameplay/crystal-purple.webp','assets/gameplay/special-wrap.webp']);
 assert.equal(drawSequenceCrystal(bomb,BOMB,7,0,0,30),true);
 assert.deepEqual(images(bomb),['assets/gameplay/special-colour-bomb.webp']);
 drawSequenceCrystal(plain,PLAIN,0,0,0,30);assert.deepEqual(images(plain),['assets/gameplay/crystal-blue.webp']);
 assert.equal(sequenceSpecialSprites.length,3);
});
test('unavailable special artwork falls back to the original canvas marker',()=>{
 ready=false;try{for(const kind of [STRIPE_V,STRIPE_H,WRAP,BOMB])assert.equal(drawSequenceCrystal(canvas(),kind,0,0,0,30),false);}finally{ready=true;}
});
