// Rebuild the subset web font.
//
//   node tools/subset-font.mjs
//
// Inter ships here as an 876KB variable TTF and was 81% of the arcade's first load. This cuts it to
// the characters the UI can actually draw and writes a woff2 beside the original.
//
// Why this is a tools script and not part of `npm run build`: Vercel runs `node build.mjs` on every
// deploy, and that machine has no uv and no fonttools. A deploy that had to subset a font would be a
// deploy that could fail on a toolchain problem. So the woff2 is generated here, committed, and the
// build just copies it like any other asset. tests/mobile-guards.test.js fails if the committed file
// goes missing or stops covering the characters below, so a stale subset is caught in CI instead of
// silently shipping tofu boxes.
//
// The full TTF stays in the repo and stays referenced as a fallback src, so a browser that cannot do
// woff2 — or a character outside the subset — still renders.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');

// Latin, digits and punctuation, plus every non-ASCII character the source actually contains.
// Regenerate the tail with: node tools/subset-font.mjs --scan
export const EXTRA_CHARS='·×–—’•…→✓✧';
export const UNICODES=[
  'U+0020-007E',            // printable ASCII: letters, digits, punctuation
  'U+00A0',                 // non-breaking space
  ...[...EXTRA_CHARS].map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')),
];

const TARGETS=[
  {ttf:'arcade/ui/assets/inter.ttf',woff2:'arcade/ui/assets/inter-subset.woff2'},
  {ttf:'dist/assets/inter.ttf',woff2:'dist/assets/inter-subset.woff2'},
  // Anybody is the game's display face. It is not on the arcade's first load, but it is 197KB on the
  // game page and subsets just as well.
  {ttf:'dist/assets/anybody.ttf',woff2:'dist/assets/anybody-subset.woff2'},
];

// Nothing below runs on import: tests read EXTRA_CHARS from here, and regenerating fonts as a side
// effect of importing a constant would be a surprising and slow thing to do.
const RUN_DIRECTLY=process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1];

// Scan mode: list the non-ASCII characters in the source, so EXTRA_CHARS can be kept honest.
if(RUN_DIRECTLY&&process.argv.includes('--scan')){
  const {readdirSync}=await import('node:fs');
  const exts=new Set(['.js','.mjs','.html','.css','.json']);
  const found=new Set();
  const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){
    if(e.name==='node_modules'||e.name==='build')continue;
    const p=join(d,e.name);
    if(e.isDirectory())walk(p);
    else if(exts.has(p.slice(p.lastIndexOf('.')))){
      for(const ch of readFileSync(p,'utf8'))if(ch.codePointAt(0)>126&&!'\r\n\t'.includes(ch))found.add(ch);
    }}};
  for(const d of ['arcade/ui','dist'])walk(join(root,d));
  const list=[...found].sort();
  console.log(`${list.length} non-ASCII characters in the source:`);
  for(const c of list)console.log(`  U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}  ${c}`);
  const missing=list.filter(c=>!EXTRA_CHARS.includes(c));
  if(missing.length){console.error('NOT in EXTRA_CHARS: '+missing.join(' '));process.exitCode=1;}
  else console.log('all covered by EXTRA_CHARS');
  process.exit();
}

// fonttools runs in an ephemeral uv environment: nothing is added to package.json and nothing is
// left installed on the machine.
for(const {ttf,woff2} of (RUN_DIRECTLY?TARGETS:[])){
  const from=join(root,ttf),to=join(root,woff2);
  execFileSync('uv',['run','--quiet','--with','fonttools[woff]','--with','brotli',
    'python','-m','fontTools.subset',from,
    `--unicodes=${UNICODES.join(',')}`,
    '--flavor=woff2','--layout-features=kern,liga,calt','--no-hinting',
    `--output-file=${to}`],{stdio:'inherit',cwd:root});
  const before=statSync(from).size,after=statSync(to).size;
  console.log(`${woff2}  ${(before/1024).toFixed(0)}KB -> ${(after/1024).toFixed(0)}KB  ` +
    `(${(100-after/before*100).toFixed(1)}% smaller)`);
}
