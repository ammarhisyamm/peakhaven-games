// The client playtest feedback, through real controls. PH_FEEDBACK_LAYOUT=1 also captures the bounded visual pass.
const {chromium,webkit}=require(process.env.PH_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.PH_FEEDBACK_URL||'http://localhost:8783',out=process.env.PH_FEEDBACK_OUTPUT||'/tmp/ph-feedback-review';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await (process.env.PH_WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true})),checks=[];
async function setup(width=390,height=844,ranked=false){
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<700,reducedMotion:width===320?'reduce':'no-preference'}),p=await context.newPage();p.errors=[];
 p.on('pageerror',e=>p.errors.push(e.message));p.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))p.errors.push(`${r.status()} ${r.url()}`)});
 await p.addInitScript(()=>localStorage.setItem('ph-arcade-v1',JSON.stringify({version:1,gameLevels:{sequence:7},tutorials:['blocks','sequence','ridge'],hintRuns:{blocks:3,sequence:3,ridge:3},motion:true})));
 await p.goto(base+'/#play');
 if(ranked){await p.locator('#join-email').fill(`feedback-${Date.now()}@example.test`);await p.locator('#join-code').fill('DEV');await p.locator('#join-name').fill('Feedback Player');await p.locator('#join-submit').click();}
 else await p.locator('#continue-as-guest').click();
 return p;
}
async function start(p,game){await p.locator(`[data-game=${game}]`).click();await p.locator('#start-game').click();const f=p.frameLocator('#game-frame');await f.locator('.scene-'+game).waitFor();await p.locator('.game-load-state').waitFor({state:'detached'});return f;}
async function finish(p,f){await f.locator('#game-back').click();await f.locator('#finish-run').click();await f.locator('.kg-dialog').waitFor();}
const sizeState=root=>{const r=root.getBoundingClientRect();return Object.fromEntries(['.hud','.block-board','.block-tray','.game-tools','.sequence-goals','.sequence-guide','.ridge-route'].map(n=>{const el=root.querySelector(n);if(!el)return[n,null];const q=el.getBoundingClientRect();return[n,{x:q.x,y:q.y,w:q.width,h:q.height,inside:q.top>=r.top&&q.bottom<=r.bottom&&q.left>=r.left&&q.right<=r.right}]}));};
if(process.env.PH_FEEDBACK_LAYOUT)for(const [width,height]of [[1440,1000],[390,844],[320,568]])for(const game of ['blocks','sequence','ridge']){
 const p=await setup(width,height),f=await start(p,game);await p.waitForTimeout(180);
 if(game==='sequence'){assert.match(await f.locator('#sequence-goals').innerText(),/Level 7 goals/);await f.locator('.sequence-help').click();assert.match(await f.locator('.steps').innerText(),/padlock/);await f.locator('#resume-game').click();}
 const sizes=await f.locator('.game-world').evaluate(sizeState);for(const [name,v]of Object.entries(sizes))if(v)assert.ok(v.inside,`${width} ${game} ${name}: ${JSON.stringify(v)}`);
 await p.screenshot({path:path.join(out,`${width}-${game}.png`)});assert.deepEqual(p.errors,[]);checks.push({width,height,game,sizes});await p.context().close();
}
// Fill a real tray until no piece fits, without changing the engine's state or its rules.
{
 const p=await setup(),f=await start(p,'blocks');let moves=0;
 for(;moves<180;moves++){
  const choice=await f.locator('#block-board').evaluate(board=>{const occupied=[...board.children].map(c=>c.classList.contains('filled')),all=[];for(const slot of document.querySelectorAll('[data-shape]:not([disabled])')){const shape=[...slot.querySelectorAll('i')].map(i=>[+i.style.gridColumn-1,+i.style.gridRow-1]);for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(shape.every(([x,y])=>r+y<8&&c+x<8&&!occupied[(r+y)*8+c+x]))all.push({piece:slot.dataset.shape,cell:r*8+c});}return all.length?all[Math.floor(Math.random()*all.length)]:null;});
  if(!choice)break;await f.locator(`[data-shape="${choice.piece}"]`).click();await f.locator(`[data-cell="${choice.cell}"]`).click();
 }
 assert.ok(moves<180,'a real blocked tray should be reached');await f.locator('.block-assist:not([hidden])').waitFor();assert.match(await f.locator('.block-assist').innerText(),/No pieces fit/);assert.ok(await f.locator('.tool-suggested').count()>=2);
 const tilePositions=await f.locator('.game-world').evaluate(root=>[1,2,3,7,8,9].map(n=>{const el=document.createElement('i');el.className=`block-${n}`;root.append(el);const value=getComputedStyle(el).backgroundPosition;el.remove();return value;}));assert.ok(tilePositions.every(v=>v.startsWith('0%')),'every late-game colour uses the PH emblem');
 const target=await f.locator('#block-board').evaluate(board=>{const cells=[...board.children];let best={count:-1};for(let r=1;r<7;r++)for(let c=1;c<7;c++){let count=0;for(let y=r-1;y<=r+1;y++)for(let x=c-1;x<=c+1;x++)if(cells[y*8+x].classList.contains('filled'))count++;if(count>best.count)best={cell:r*8+c,count};}return best;});
 const before=await f.locator('.block-cell.filled').count(),button=await f.locator('[data-tool=bomb]').boundingBox(),cell=await f.locator(`[data-cell="${target.cell}"]`).boundingBox();
 await p.mouse.move(button.x+button.width/2,button.y+button.height/2);await p.mouse.down();await p.mouse.move(cell.x+cell.width/2,cell.y+cell.height/2,{steps:8});assert.equal(await f.locator('.bomb-target').count(),9);assert.match(await f.locator('.block-assist').innerText(),/Bomb ready/);assert.equal(await f.locator('.block-assist strong').evaluate(e=>getComputedStyle(e).color),'rgb(21, 44, 66)');
 if(process.env.PH_FEEDBACK_LAYOUT)await p.screenshot({path:path.join(out,'bomb-drag.png')});await p.mouse.up();assert.equal(await f.locator('[data-tool=bomb] b').textContent(),'2');assert.equal(await f.locator('.block-cell.filled').count(),before-target.count);
 // An invalid drop / cancellation cannot spend a tool.
 const bomb=await f.locator('[data-tool=bomb]').boundingBox();await p.mouse.move(bomb.x+20,bomb.y+20);await p.mouse.down();await p.mouse.move(5,5,{steps:5});await p.mouse.up();assert.equal(await f.locator('[data-tool=bomb] b').textContent(),'2');await f.locator('[data-tool=bomb]').click();
 await f.locator('[data-tool=shuffle]').click();assert.ok(await f.locator('.shape-preview').evaluateAll(els=>els.some(e=>e.getAnimations().length>0)),'new pieces visibly shuffle');
 // Keyboard Bomb remains supported; pause cancels active targeting.
 await f.locator('[data-tool=bomb]').click();await f.locator('#game-back').click();await f.locator('#resume-game').click();assert.equal(await f.locator('[data-tool=bomb]').getAttribute('aria-pressed'),'false');
 await finish(p,f);await f.locator('#kg-exit').click();assert.deepEqual(p.errors,[]);checks.push({blocks:'real no-fit help, nine-cell bomb drag, exact clearing, invalid drop, shuffle motion, pause cancellation, results',moves});await p.context().close();
}
// The mobile touch lift is the same gesture as piece dragging, including a safe cancellation.
if(!process.env.PH_WEBKIT){
 const p=await setup(),f=await start(p,'blocks');await f.locator('[data-shape="0"]').click();await f.locator('[data-cell="0"]').click();const bomb=await f.locator('[data-tool=bomb]').boundingBox(),cell=await f.locator('[data-cell="0"]').boundingBox(),next=await f.locator('[data-cell="8"]').boundingBox(),cdp=await p.context().newCDPSession(p);
 const x=bomb.x+bomb.width/2,y=bomb.y+bomb.height/2,tx=cell.x+cell.width/2,ty=cell.y+cell.height/2+1.5*(next.y-cell.y);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty}]});assert.ok(await f.locator('.bomb-target').count()>0);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await f.locator('[data-tool=bomb] b').textContent(),'3');assert.equal(await f.locator('[data-tool=bomb]').getAttribute('aria-pressed'),'false');
 assert.deepEqual(p.errors,[]);checks.push({touch:'lifted bomb footprint and pointer cancellation do not spend a use'});await p.context().close();
}
// Revive is used through the actual ranked iframe and verified by the server, then its second crash ends.
if(!process.env.PH_FEEDBACK_URL){
 const p=await setup(390,844,true),f=await start(p,'ridge');assert.equal(await p.evaluate(()=>window.phRankedRun.rulesVersion),6);await f.locator('#game-canvas').press('Space');await f.locator('[data-revive]').waitFor({timeout:10000});
 if(process.env.PH_FEEDBACK_LAYOUT)await p.screenshot({path:path.join(out,'ridge-revive.png')});await f.locator('[data-revive]').click();await f.locator('#game-canvas').press('Space');await f.locator('.kg-dialog').waitFor({timeout:10000});await f.locator('.kg-primary-label').filter({hasText:'PLAY AGAIN'}).waitFor();
 assert.equal(await p.evaluate(()=>window.phRankedRun.done),true);assert.equal(await p.evaluate(()=>window.phRankedRun.message.replay.revives.length),1);assert.deepEqual(p.errors,[]);checks.push({ridge:'ranked start v6, one revive, second crash, server verifies replay and returns saved result'});await p.context().close();
}
await browser.close();fs.writeFileSync(path.join(out,process.env.PH_FEEDBACK_LAYOUT?'layout.json':process.env.PH_WEBKIT?'webkit.json':'chromium.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks.map(c=>({width:c.width,game:c.game,blocks:c.blocks,touch:c.touch,ridge:c.ridge})),null,2));
})().catch(e=>{console.error(e);process.exit(1)});
