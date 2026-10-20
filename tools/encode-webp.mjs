// Re-encode the heavy art as WebP.
//
//   node tools/encode-webp.mjs          # report what would change
//   node tools/encode-webp.mjs --write  # write the files
//
// Two jobs, because the two piles of art got heavy in different ways.
//
// 1. dist/assets -- the in-game art, drawn as PNG and JPEG. The originals stay in the repo: WebP is
//    written alongside, and only the references move. If a picture ever looks wrong, pointing the
//    reference back at the PNG or JPEG is a one-line revert.
//
// 2. arcade/ui/assets -- the arcade shell's own art, which was already WebP and so invisible to the
//    job above, but encoded at the size it was drawn rather than the size it is shown. A 1280x720
//    cover on a card 410px wide is five times the pixels anyone sees. The full-size files live in
//    arcade/assets-source (outside ui/, so the build never ships them) and the served copy is written
//    into arcade/ui/assets under the same name, so no reference moves at all. The one exception is
//    brand.png, which becomes brand.webp and does move its two references.
//
// Like the other tools here this runs by hand and commits its output, because the Vercel deploy runs
// `node build.mjs` on a machine with no Pillow.
import {execFileSync} from 'node:child_process';
import {readdirSync,statSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,relative,extname,basename} from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const ROOTS=['dist/assets'];
// Anything smaller than this is not worth a second copy of the file in the repo.
const MIN_BYTES=300*1024;
// 82 is the point where these illustrations stop being distinguishable from the source at a glance;
// the lossless flag keeps the sprite atlas crisp because its edges are flat colour, not photography.
const QUALITY=82;
const LOSSLESS=new Set(['blue-coins-atlas.png']);

// ---- the shell art ----
const SHELL_SOURCE='arcade/assets-source',SHELL_OUT='arcade/ui/assets';
// The largest box each one is drawn into, measured in the browser on the welcome, Play, Ranks, Prizes
// and My Bottle pages at 390 and 1440 wide. The encoded file is twice this, which is what a 2x screen
// asks for and nothing more; where the source is already smaller than that it is left at its own size
// and only re-encoded. `fit` is the object-fit the element uses, because a contained image is drawn
// smaller than its box on the axis that does not bind.
const SHELL={
 'cover-peak-blocks-v2.webp':{shown:[410,231],fit:'cover'},
 'cover-sequence-v2.webp':{shown:[410,231],fit:'cover'},
 'cover-ridge-run-v2.webp':{shown:[410,231],fit:'cover'},
 'decoration-snowy-mountain-range.webp':{shown:[670,174],fit:'cover'},
 'logo-ph-arcade.webp':{shown:[248,99],fit:'contain'},
 'bottle-ph-original.webp':{shown:[299,396],fit:'contain'},
 'prize-gold-trophy.webp':{shown:[402,143],fit:'contain'},
 'prize-gift-box.webp':{shown:[402,143],fit:'contain'},
 'brand.png':{shown:[184,64],fit:'contain',out:'brand.webp'},
 'icon-nav-play-default.webp':{shown:[29,29],fit:'contain'},
 'icon-nav-play-active.webp':{shown:[29,29],fit:'contain'},
 'icon-nav-ranks-default.webp':{shown:[29,29],fit:'contain'},
 'icon-nav-ranks-active.webp':{shown:[29,29],fit:'contain'},
 'icon-nav-prizes-default.webp':{shown:[29,29],fit:'contain'},
 'icon-nav-prizes-active.webp':{shown:[29,29],fit:'contain'},
 'icon-nav-my-bottle-default.webp':{shown:[29,29],fit:'contain'},
 'icon-nav-my-bottle-active.webp':{shown:[29,29],fit:'contain'},
};
// A nav icon is a flat two-colour glyph at 58px: lossy encoding spends its bits on ringing around the
// edges, and lossless is both smaller and sharper at that size.
const SHELL_LOSSLESS=name=>name.startsWith('icon-');
const DPR=2;

const write=process.argv.includes('--write');

const py=`
import sys
from PIL import Image
src, out, quality, lossless, box = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == '1', sys.argv[5]
im = Image.open(src)
if im.mode in ('P', 'LA'):
    im = im.convert('RGBA')
if box != '-':
    w, h = (int(v) for v in box.split('x'))
    im.thumbnail((w, h), Image.LANCZOS)
if lossless:
    im.save(out, 'WEBP', lossless=True, method=6)
else:
    im.save(out, 'WEBP', quality=quality, method=6)
`;

const run=(src,out,quality,lossless,box)=>execFileSync('uv',
  ['run','--quiet','--with','pillow','python','-c',py,src,out,String(quality),lossless?'1':'0',box],
  {stdio:'inherit',cwd:root});

const report=[];
const line=(src,out,before,after,note='')=>{
  report.push(`${(before/1024).toFixed(0).padStart(6)}KB -> ${(after/1024).toFixed(0).padStart(6)}KB  ` +
    `${after?((1-after/before)*100).toFixed(0).padStart(3):'  ?'}%  ${src}${note?'  '+note:''}`);
};

// ---- job 1: the in-game art ----
const targets=[];
const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){
  const p=join(d,e.name);
  if(e.isDirectory()){walk(p);continue;}
  if(!['.png','.jpg','.jpeg'].includes(extname(p).toLowerCase()))continue;
  if(statSync(p).size<MIN_BYTES)continue;
  targets.push(p);
}};
for(const r of ROOTS)walk(join(root,r));
targets.sort((a,b)=>statSync(b).size-statSync(a).size);

let before=0,after=0;
for(const p of targets){
  const out=p.replace(/\.(png|jpe?g)$/i,'.webp');
  const name=basename(p);
  const lossless=LOSSLESS.has(name);
  if(write)run(p,out,QUALITY,lossless,'-');
  const b=statSync(p).size,a=existsSync(out)?statSync(out).size:0;
  before+=b;after+=a;
  line(relative(root,p).replace(/\\/g,'/'),out,b,a,lossless?'(lossless)':'');
}
console.log(report.splice(0).join('\n'));
console.log('-'.repeat(68));
console.log(`${(before/1024).toFixed(0).padStart(6)}KB -> ${(after/1024).toFixed(0).padStart(6)}KB  ` +
  `in-game art, ${targets.length} files`);

// ---- job 2: the shell art ----
// What the image is actually drawn at inside its box, which is the box itself when it is cropped to
// fill and the smaller contained rectangle when it is not.
const drawnAt=(natural,shown,fit)=>{
  const [nw,nh]=natural,[bw,bh]=shown;
  const scale=fit==='cover'?Math.max(bw/nw,bh/nh):Math.min(bw/nw,bh/nh);
  return [Math.round(nw*scale),Math.round(nh*scale)];
};
const naturalOf=p=>{
  const out=execFileSync('uv',['run','--quiet','--with','pillow','python','-c',
    'import sys;from PIL import Image;im=Image.open(sys.argv[1]);print(im.width,im.height)',p],
    {cwd:root,encoding:'utf8'});
  return out.trim().split(/\s+/).map(Number);
};
mkdirSync(join(root,SHELL_OUT),{recursive:true});
let sBefore=0,sAfter=0,count=0;
for(const [name,spec] of Object.entries(SHELL)){
  const src=join(root,SHELL_SOURCE,name);
  if(!existsSync(src)){console.log(`  missing source: ${SHELL_SOURCE}/${name}`);continue;}
  const out=join(root,SHELL_OUT,spec.out||name);
  const natural=naturalOf(src);
  const drawn=drawnAt(natural,spec.shown,spec.fit);
  const want=[drawn[0]*DPR,drawn[1]*DPR];
  // Never upscale: a source smaller than the target keeps its own pixels and is only re-encoded.
  const box=(natural[0]>want[0]||natural[1]>want[1])
    ?[Math.min(natural[0],want[0]),Math.min(natural[1],want[1])]:null;
  const lossless=SHELL_LOSSLESS(name);
  if(write)run(src,out,QUALITY,lossless,box?`${box[0]}x${box[1]}`:'-');
  const b=statSync(src).size,a=existsSync(out)?statSync(out).size:0;
  sBefore+=b;sAfter+=a;count++;
  line(`${SHELL_OUT}/${spec.out||name}`,out,b,a,
    `${natural.join('x')} -> ${box?box.join('x'):natural.join('x')}${lossless?' lossless':''}`);
}
console.log(report.splice(0).join('\n'));
console.log('-'.repeat(68));
console.log(`${(sBefore/1024).toFixed(0).padStart(6)}KB -> ${(sAfter/1024).toFixed(0).padStart(6)}KB  ` +
  `shell art, ${count} files`);
console.log(`${((before+sBefore)/1024).toFixed(0).padStart(6)}KB -> ${((after+sAfter)/1024).toFixed(0).padStart(6)}KB  ` +
  `total` + (write?'':'  (nothing written: pass --write)'));

// ---- the sizes the markup declares ----
// Every image the shell serves, with the size it is actually encoded at. The markup puts these on the
// <img> as width and height so the browser can reserve the right box before the bytes arrive, which is
// what stops the page jumping as a lazy image lands. Generated rather than typed, because a re-encode
// that changes a size and leaves the markup claiming the old one is exactly the bug this prevents.
const dims=readdirSync(join(root,SHELL_OUT))
  .filter(n=>/\.(webp|png|jpe?g)$/i.test(n)).sort()
  .map(n=>[n,naturalOf(join(root,SHELL_OUT,n))]);
const dimsFile=join(root,SHELL_OUT,"..","asset-dims.js");
const dimsBody=`// Generated by tools/encode-webp.mjs --write. Do not edit by hand.
//
// The intrinsic size of every image in ui/assets. The markup declares these so a box is reserved
// before the image arrives; tests/shell-images.test.js checks they still match the files.
export const ASSET_DIMS={
${dims.map(([n,[w,h]])=>` '${n}':[${w},${h}],`).join("\n")}
};
`;
if(write){writeFileSync(dimsFile,dimsBody.replace(/\n/g,"\r\n"));
  console.log(`wrote ${relative(root,dimsFile).replace(/\\/g,"/")} (${dims.length} images)`);}
