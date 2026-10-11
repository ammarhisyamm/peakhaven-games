const images=new Map();
export const crystalSprites=['crystal-blue','crystal-cyan','crystal-gold','crystal-purple','crystal-green','crystal-pink','crystal-white'];
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

