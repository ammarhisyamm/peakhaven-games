import {PLAIN,STRIPE_V,STRIPE_H,WRAP,BOMB} from './sequence-v3.js';
const images=new Map();
export const crystalSprites=['crystal-blue','crystal-cyan','crystal-gold','crystal-purple','crystal-green','crystal-pink','crystal-white'];
export const sequenceSpecialSprites=['special-stripe','special-wrap','special-colour-bomb'];
export const vialSprites=['vial-cyan','vial-pink','vial-green','vial-gold'];
export function spriteImage(name){
  if(!images.has(name)&&typeof Image!=='undefined'){const image=new Image();image.src=`assets/gameplay/${name}.webp`;images.set(name,image);}
  return images.get(name);
}
export function drawSprite(ctx,name,x,y,width,height,rotation=0){
  const image=spriteImage(name);if(!image?.complete||!image.naturalWidth)return false;
  const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.drawImage(image,-w/2,-h/2,w,h);ctx.restore();return true;
}

// Keep the chrome neck and Peak Haven label proportional. Only the glass body
// extends to the screen edge; bubbles are drawn as circles, never stretched.
export function drawBottleObstacle(ctx,x,edge,height,width=70,inverted=false){
  if(height<=0)return false;
  const image=spriteImage('vial-cyan');if(!image?.complete||!image.naturalWidth)return false;
  const sw=image.naturalWidth,sh=image.naturalHeight,scale=width/sw,neck=sh*.35*scale;
  ctx.save();ctx.translate(x,edge);if(inverted)ctx.rotate(Math.PI);
  const glass=ctx.createLinearGradient(-width/2,0,width/2,0);
  glass.addColorStop(0,'#c4ffff');glass.addColorStop(.12,'#0087dce8');glass.addColorStop(.38,'#2fe1f3bb');glass.addColorStop(.77,'#007ce8d9');glass.addColorStop(1,'#beffff');
  ctx.fillStyle=glass;ctx.beginPath();ctx.roundRect(-width/2,neck*.82,width,Math.max(1,height-neck*.82)+2,[13,13,0,0]);ctx.fill();
  ctx.strokeStyle='#c7ffffaa';ctx.lineWidth=2;ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle='#ffffff70';ctx.fillRect(-width*.33,neck+4,3,Math.max(0,height-neck));
  for(let y=neck+65,n=0;y<height-8;y+=44,n++){const bx=(n%2?1:-1)*width*.16,r=n%3?5:9;ctx.strokeStyle='#ccffffb0';ctx.fillStyle='#49eaffe0';ctx.beginPath();ctx.arc(bx,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(bx-r*.3,y-r*.4,2,0,Math.PI*2);ctx.fill();}
  ctx.drawImage(image,0,0,sw,sh*.35,-width/2,0,width,neck);
  ctx.drawImage(image,0,sh*.49,sw,sh*.23,-width/2,neck+12,width,sh*.23*scale);
  ctx.restore();return true;
}


// Keep the original gem colour visible under the generated transparent harness.
// Rotation follows the clear direction, including vertical-four → horizontal blast.
export function drawSequenceCrystal(ctx,kind,colour,x,y,size){
  if(kind===BOMB&&drawSprite(ctx,'special-colour-bomb',x,y,size,size))return true;
  drawSprite(ctx,crystalSprites[kind===BOMB?6:colour],x,y,size,size);
  if(kind===PLAIN)return true;
  if(kind===STRIPE_V||kind===STRIPE_H)return drawSprite(ctx,'special-stripe',x,y,size,size,kind===STRIPE_H?Math.PI/2:0);
  if(kind===WRAP)return drawSprite(ctx,'special-wrap',x,y,size,size);
  return false; // Canvas special markers remain available if an asset cannot load.
}
