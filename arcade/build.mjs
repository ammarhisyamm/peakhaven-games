import {cp, mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, '..');
const output = join(root, 'build');
const gameplay = join(repository, 'dist');

// The repo's dist/ is the gameplay source maintained by game developers.
// ui/ supplies the production V2 interface and iframe bridge, so game updates
// flow into production without replacing the arcade with the original app shell.
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
await cp(gameplay, join(output, 'game'), {recursive: true});
await cp(join(root, 'ui'), output, {recursive: true});

async function validateModules(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await validateModules(path);
    } else if (entry.name.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', path], {stdio: 'inherit'});
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(/\b(?:import|export)\b[^;\n]*?\bfrom\s*['"](\.[^'"]+)['"]/g)) {
        await stat(resolve(dirname(path), match[1]));
      }
    }
  }
}
await validateModules(output);
// Supabase's browser bundle, for sign-in. Copied after validation because it's a prebuilt third-party file.
await mkdir(join(output, 'vendor'), {recursive: true});
await cp(join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'), join(output, 'vendor', 'supabase.js'));
for (const path of ['index.html', 'app.js', 'account.js', 'admin.html', 'admin.js', 'month-prizes.js', 'vendor/supabase.js', 'styles.css', 'game/index.html', 'game/puzzle-games.js', 'game/tryout-games.js']) {
  await stat(join(output, path));
}
let commit = process.env.VERCEL_GIT_COMMIT_SHA;
if (!commit) {
  try {commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repository, encoding: 'utf8'}).trim();}
  catch {commit = 'local';}
}
await writeFile(join(output, 'version.json'), JSON.stringify({
  interface: 'ph-arcade-v2',
  repository: 'ammarhisyamm/peakhaven-games',
  commit,
}, null, 2) + '\n');
console.log(`Built PH Arcade V2 with gameplay from ${commit}.`);
