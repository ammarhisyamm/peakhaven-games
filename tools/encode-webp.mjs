// Re-encode the heavy art as WebP.
//
//   node tools/encode-webp.mjs          # report what would change
//   node tools/encode-webp.mjs --write  # write the .webp files
//
// The originals stay in the repo: WebP is written alongside, and only the references move. If a
// picture ever looks wrong, pointing the reference back at the PNG or JPEG is a one-line revert.
//
// Like the other tools here this runs by hand and commits its output, because the Vercel deploy runs
// `node build.mjs` on a machine with no Pillow.
import {execFileSync} from 'node:child_process';
import {readdirSync,statSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,relative,extname} from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const ROOTS=['dist/assets'];
// Anything smaller than this is not worth a second copy of the file in the repo.
const MIN_BYTES=300*1024;
// 82 is the point where these illustrations stop being distinguishable from the source at a glance;
// the lossless flag keeps the sprite atlas crisp because its edges are flat colour, not photography.
const QUALITY=82;
const LOSSLESS=new Set(['blue-coins-atlas.png']);

const write=process.argv.includes('--write');
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

const py=`
import sys
from PIL import Image
src, out, quality, lossless = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == '1'
im = Image.open(src)
if im.mode in ('P', 'LA'):
    im = im.convert('RGBA')
if lossless:
    im.save(out, 'WEBP', lossless=True, method=6)
else:
    im.save(out, 'WEBP', quality=quality, method=6)
`;

let before=0,after=0;
for(const p of targets){
  const out=p.replace(/\.(png|jpe?g)$/i,'.webp');
  const name=p.split(/[\\/]/).pop();
  const lossless=LOSSLESS.has(name)?'1':'0';
  if(write)execFileSync('uv',['run','--quiet','--with','pillow','python','-c',py,p,out,String(QUALITY),lossless],
    {stdio:'inherit',cwd:root});
  const b=statSync(p).size,a=existsSync(out)?statSync(out).size:0;
  before+=b;after+=a;
  const rel=relative(root,p).replace(/\\/g,'/');
  console.log(`${(b/1024).toFixed(0).padStart(6)}KB -> ${(a/1024).toFixed(0).padStart(6)}KB  ` +
    `${a?((1-a/b)*100).toFixed(0).padStart(3):'  ?'}%  ${rel}${lossless==='1'?'  (lossless)':''}`);
}
console.log(`${'-'.repeat(60)}`);
console.log(`${(before/1024).toFixed(0).padStart(6)}KB -> ${(after/1024).toFixed(0).padStart(6)}KB  ` +
  `total across ${targets.length} files` + (write?'':'  (nothing written: pass --write)'));
