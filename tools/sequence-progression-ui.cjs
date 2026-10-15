// Local guest UI checks. Uses a fixed board seed only in the test browser; production code is untouched.
const {chromium,webkit}=require(process.env.PH_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const base=process.env.PH_SEQUENCE_URL||'http://localhost:8781',repo=path.resolve(__dirname,'..'),out=process.env.PH_SEQUENCE_OUTPUT||'/tmp/ph-sequence-ui';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await (process.env.PH_WEBKIT?webkit.launch({headless:true}):chromium.launch({headless:true,channel:'chrome'}));
 try{
 for(const [width,height,level] of [[1440,1000,5],[390,844,9],[320,568,30]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))errors.push(`${r.status()} ${r.url()}`);});
  await page.route('**/game/rng.js',async route=>{const response=await route.fetch(),body=(await response.text()).replace(/export function makeSeed\(\)\{[^\n]+/, 'export function makeSeed(){return 42;}');await route.fulfill({response,body});});
  await page.goto(base+'/#play');await page.locator('#continue-as-guest').click();await page.locator('[data-game=sequence]').waitFor();
  await page.evaluate(level=>localStorage.setItem('ph-arcade-v1',JSON.stringify({version:1,gameLevels:{sequence:level},tutorials:['sequence']})),level);
  await page.locator('[data-game=sequence]').click();await page.locator('#start-game').click();const f=page.frameLocator('#game-frame');await f.locator('#sequence-goals').waitFor();await page.locator('.game-load-state').waitFor({state:'detached'});
  const bounds=await f.locator('#sequence-goals').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(bounds.scroll<=bounds.width);
  await f.locator('#sequence-goals img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));await page.screenshot({path:`${out}/${width}-level-${level}.png`});
  if(level===9){
   const plan=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
    globalThis.window={devicePixelRatio:1};globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};globalThis.Image=class{};
    const {SequenceEngine}=await import('${repo}/dist/tryout-games.js');const {driveSequence,greedyMove}=await import('${repo}/tools/sequence-bot.mjs');const noop=()=>{};let result;
    const e=new SequenceEngine({getContext:()=>({setTransform:noop}),getBoundingClientRect:()=>({width:480,height:720}),addEventListener:noop,removeEventListener:noop},{hud:noop,message:noop,sound:noop,end:r=>result=r},{seed:42,level:9,motion:false});driveSequence(e,greedyMove);console.log(JSON.stringify(result));`],{encoding:'utf8'}));assert.ok(plan.won);
   const realFrame=page.frames().find(f=>f.url().includes('/game/'));
   for(const [,a,b] of plan.replay.moves){
    for(const i of [a,b]){
     const pos=await f.locator('#game-canvas').evaluate((c,i)=>{const r=c.getBoundingClientRect(),scale=Math.min(r.width/480,r.height/720),w=r.width/scale,h=r.height/scale,top=148/scale,bottom=84/scale,size=Math.min(w-36,h-top-bottom-24,560),cell=size/7;return {x:((w-size)/2+(i%7+.5)*cell)*scale,y:(top+(h-top-bottom-size)/2+(Math.floor(i/7)+.5)*cell)*scale};},i);
     await f.locator('#game-canvas').click({position:pos});
    }
    await realFrame.waitForFunction(()=>document.querySelector('.kg-dialog')||document.querySelector('#game-message')?.textContent,{},{timeout:10000});
   }
   await f.locator('.kg-dialog').waitFor();assert.equal(await f.locator('#kg-result-title').textContent(),'LEVEL CLEARED');assert.match(await f.locator('.kg-objectives').textContent(),/10\/10.*2\/2.*9\/9/);await f.locator('.kg-mascot').evaluate(i=>i.decode());await page.screenshot({path:`${out}/390-level-9-cleared.png`});
   await f.locator('#kg-replay').click();await f.locator('#sequence-goals').filter({hasText:'Level 10'}).waitFor();
  }else{
   await f.locator('#game-back').click();await f.locator('#finish-run').click();await f.locator('.kg-dialog').waitFor();assert.equal(await f.locator('#kg-result-title').textContent(),'LEVEL NOT CLEARED');await f.locator('.kg-mascot').evaluate(i=>i.decode());await page.screenshot({path:`${out}/${width}-level-${level}-result.png`});
  }
  assert.deepEqual(errors,[]);console.log(`Passed ${width}x${height}, level ${level}${level===9?', actual taps clear every goal and advance to level 10':''}`);await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
