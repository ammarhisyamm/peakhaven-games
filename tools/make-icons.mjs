// Rebuild the square app icons.
//
//   node tools/make-icons.mjs
//
// peak-haven-mark.png is 512x469, and iOS stretches a non-square apple-touch-icon to fit, which
// squashes the mark. These pad it onto the brand background instead, so the proportions survive.
//
// Like tools/subset-font.mjs this runs by hand and commits its output: the Vercel deploy runs
// `node build.mjs` on a machine with no Pillow, so generating icons at deploy time would be a deploy
// that can fail on a toolchain problem.
import {execFileSync} from 'node:child_process';
import {statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE='dist/assets/peak-haven-mark.png';
// The mark is near-black teal on transparent, so it needs a light ground: on the navy it all but
// disappears. White matches the arcade header and the shell's own theme-color.
const BACKGROUND='#FFFFFF';
// 180 is what iOS asks for; 192 and 512 are what a web app manifest wants. The mark keeps 78% of the
// square, which leaves the margin iOS expects and stops the rounded corner clipping it.
const SIZES=[180,192,512];
const INSET=0.78;

const py=`
import sys
from PIL import Image
src = Image.open(sys.argv[1]).convert('RGBA')
bg = tuple(int(sys.argv[2].lstrip('#')[i:i+2], 16) for i in (0, 2, 4)) + (255,)
for size in [int(s) for s in sys.argv[4:]]:
    box = int(size * ${INSET})
    scale = min(box / src.width, box / src.height)
    w, h = max(1, round(src.width * scale)), max(1, round(src.height * scale))
    mark = src.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), bg)
    canvas.alpha_composite(mark, ((size - w) // 2, (size - h) // 2))
    out = sys.argv[3].replace('SIZE', str(size))
    canvas.convert('RGB').save(out, 'PNG', optimize=True)
    print(out)
`;

for(const dir of ['arcade/ui/assets','dist/assets']){
  const out=join(root,dir,'icon-SIZE.png');
  execFileSync('uv',['run','--quiet','--with','pillow','python','-c',py,
    join(root,SOURCE),BACKGROUND,out,...SIZES.map(String)],{stdio:'inherit',cwd:root});
}
for(const size of SIZES){
  const p=join(root,'arcade/ui/assets',`icon-${size}.png`);
  console.log(`  icon-${size}.png  ${(statSync(p).size/1024).toFixed(1)}KB`);
}
