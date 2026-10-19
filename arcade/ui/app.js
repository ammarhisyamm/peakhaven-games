import {startRequestStore} from './start-request.js';
import {pendingResultStore} from './pending-result.js';
import {freePlaysLeft,availablePlays,consumePlay,playWallet} from './game/play-credits.js';
import {showReferenceResults} from './game/reference-results.js';
import {initAccount} from './account.js';
import {withGuestMode} from './guest-mode.js';
import {BOTTLE_SKINS,bottleUnlocked,pointsForGame} from './bottle-unlocks.js';
import {PRIZE_FALLBACK,winnerModal} from './month-prizes.js';
import {supportLine,bindSupport,withSupport,linkErrorMessage} from './support.js';
const $=s=>document.querySelector(s),main=$('#main'),modal=$('#modal'),gameModal=$('#game-modal'),frame=$('#game-frame');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={guest:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',gamepad:'<path d="M7 7h10c4 0 6 11 3 12-2 1-4-3-5-3H9c-1 0-3 4-5 3C1 18 3 7 7 7Z"/><path d="M7 10v4m-2-2h4m7-1h.01m2 3h.01"/>',bars:'<path d="M5 20V11m7 9V4m7 16V8"/>',cart:'<path d="M3 3h2l3 12h10l3-9H6M9 20h.01M18 20h.01"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="m5 12 4 4L19 6"/>',lock:'<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',edit:'<path d="m15 4 5 5L9 20H4v-5zM13 6l5 5"/>',document:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',crown:'<path d="M4 18h16L18 7l-4 4-2-6-2 6-4-4z"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[n]||paths.arrow}</svg>`;
const img=(name,alt='',cls='')=>`<img src="assets/${name}.webp" alt="${escape(alt)}" class="${cls}" decoding="async">`;
const bottles=BOTTLE_SKINS;
let state={name:'HavenPlayer',bottle:'ph-original',cap:'silver',accessory:'none',sound:true,runs:0,points:0};try{state={...state,...JSON.parse(localStorage.getItem('ph-clean-concept-v2')||'{}')};}catch{}
if(!bottles.some(b=>b.id===state.bottle))state.bottle='ph-original';state.name=String(state.name||'HavenPlayer').slice(0,24);state.runs=Math.max(0,Number(state.runs)||0);state.points=Math.max(0,Number(state.points)||0);
let preview=state.bottle,cap=state.cap,accessory=state.accessory,customTab='colour',period='monthly',boardGame='blocks',filter='all',view='play',activeGame=null,toastTimer;
// Competition accounts. With accounts on, plays, scores and the leaderboard come from the server; without them
// (a static preview) the arcade keeps its on-device demo behaviour.
let account;try{account=await initAccount();}catch{account={enabled:true,broken:true,signedIn:()=>false,email:()=>null,api:async()=>({ok:false,error:'Sign-in could not load. Refresh to try again.'}),join:async()=>({ok:false,error:'Sign-in could not load. Refresh to try again.'}),signIn:async()=>({ok:false,error:'Sign-in could not load. Refresh to try again.'}),signOut:async()=>{},onChange(){}};}
account=withGuestMode(account);
const pendingResults=pendingResultStore(),startRequests=startRequestStore();
let recoveringResult=false,accountRevision=0;
// `coins`, `purchases` and `shop` are the paid extra tries: the balance, anything waiting for payment, and
// whether the shop can be shown at all on this deployment.
const emptyServer=()=>({plays:null,player:null,email:null,wins:[],admin:false,error:null,status:0,coins:0,purchases:[],shop:null});
let server=emptyServer(),boards={},joinTab='join',joinNote='',joinError=false;
async function refreshMe(){if(!account.enabled||!account.signedIn())return;const revision=accountRevision,r=await account.api('me');if(revision!==accountRevision)return;if(r.ok){server={plays:r.plays,player:r.player,email:r.email,wins:r.wins||[],admin:Boolean(r.admin),error:null,status:200,coins:Math.max(0,Math.floor(Number(r.coins)||0)),purchases:Array.isArray(r.purchases)?r.purchases:[],shop:r.shop??null};state.name=r.player.name;if(bottles.some(b=>b.id===r.player.bottle))state.bottle=r.player.bottle;save();}else server={...server,error:r.error,status:r.status};}
// Lifetime points and podium finishes unlock bottles. Signed-in players get them from the server; guests earn them on this device.
const progress=()=>account.enabled&&server.player?{points:Math.max(0,Number(server.player.points)||0),podium:Boolean(server.player.podium)}:{points:state.points,podium:false};
const isUnlocked=id=>bottleUnlocked(id,progress());
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');
// Leaderboards are per game, so boards are cached by game and period.
const boardKey=(game,which)=>`${game}:${which}`;
async function loadBoard(game,which){const revision=accountRevision,r=await account.api('leaderboard',{query:{period:which,game}});if(revision!==accountRevision)return r;boards[boardKey(game,which)]=r.ok?r:{error:r.error,top:[],players:0};return boards[boardKey(game,which)];}
const boardLabel=b=>!b?.key?'':b.period==='yearly'?b.key:new Date(`${b.key}-01T12:00:00`).toLocaleString('en-AU',{month:'long',year:'numeric'});
const boardRows=(top,empty)=>top.length?top.map(r=>`<tr${r.you?' class="you"':''}><td>${r.rank}</td><td><span class="player-cell">${img(`bottle-${bottles.some(b=>b.id===r.bottle)?r.bottle:'ph-original'}`,'')}${escape(r.name)}${r.you?' (You)':''}</span></td><td>${r.points.toLocaleString('en-AU')} pts</td></tr>`).join(''):`<tr><td colspan="3">${empty}</td></tr>`;
const save=()=>{try{localStorage.setItem('ph-clean-concept-v2',JSON.stringify(state));}catch{toast('Your browser could not save changes. You can keep playing.');}};
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3200);}
const navItems=[['play','Play','play'],['ranks','Ranks','ranks'],['prizes','Prizes','prizes'],['bottle','My Bottle','my-bottle']];
const games=[['blocks','Peak Blocks','Stack. Clear. Chain.','Endless','blocks.png','blocks','Fit every piece. Clear rows. Build your combo.'],['sequence','Sequence','Swap. Match. Beat the goal.','Levels','sequence.png','sequence-v2','Match three or more before you run out of moves.'],['ridge','Ridge Run','Tap. Fly. Go further.','Endless','ridge.png','ridge-v2','Thread the bottle caps. The course speeds up.']];
// How-to-play popups lead with the goal, then the controls.
const howTo={blocks:{goal:'Clear rows and columns to score. Chain clears for a combo.',how:'Drag a piece onto the board, or tap it, then tap a square.'},sequence:{goal:'Complete the goals shown above the board before your moves run out.',how:'Swap neighbours to match 3. Match on or beside ice; each rim needs one hit. Match beside padlocks to open them. Match the requested colour to collect it.'},ridge:{goal:'Fly as far as you can.',how:'Tap or press Space to lift your round crystal between the vial caps. Every 50 gates brings a new colour, more speed and tighter gaps. One free revive per run.'}};
const playsText=n=>`${n} free play${n===1?'':'s'} today`;
function equipped(){return `<span class="equipped"><b>${icon('check')}</b>Equipped</span>`;}
function shell(title,subtitle,content,heroNote=''){
 document.body.dataset.page=view;document.title=`${title} — Peak Haven Arcade`;
 $('.main-nav').innerHTML=navItems.map(([id,label,key])=>`<a href="#${id}" class="nav-link" ${view===id?'aria-current="page"':''}>${img(`icon-nav-${key}-${view===id?'active':'default'}`)}<span>${label}</span></a>`).join('');
 main.innerHTML=`${account.enabled&&server.error&&server.status!==403?`<aside class="pending-result" role="status"><p>${escape(server.error)}</p><button class="secondary" type="button" data-retry-account>Retry loading plays</button></aside>`:''}${pendingNotice()}<div class="breadcrumbs" aria-label="Breadcrumb"><a href="#play">Home</a>${icon('chevron')}<a href="#play" ${view==='play'?'aria-current="page"':''}>Arcade</a>${view==='play'?'':`${icon('chevron')}<span>${title}</span>`}</div><section class="hero ${view==='play'?'hero-play':''}" aria-label="${title}"><div class="hero-logo">${img('logo-ph-arcade','PH Arcade')}<p>PLAY &nbsp;•&nbsp; EARN &nbsp;•&nbsp; WIN</p></div><div class="hero-copy"><h1>${title}</h1><p>${subtitle}</p>${heroNote?`<p class="hero-note">${heroNote}</p>`:''}</div>${img('decoration-snowy-mountain-range','','hero-mountains')}${img('bottle-ph-original','','hero-bottle')}</section>${content}`;
}

function prizeCards(detailed=false){return `<div class="prize-row ${detailed?'detailed':''}"><article class="prize-card panel dark">${img('prize-gold-trophy','Golden trophy','prize-art')}<div class="prize-info"><p class="eyebrow">MONTHLY WINNER</p><div class="prize-offer"><span class="prize-number">1</span><div class="prize-words"><strong>FREE<br>PRODUCT</strong><p>Your choice.</p></div></div></div>${detailed?'<p class="prize-explain">Top a game&rsquo;s monthly board.<br>Choose your product.</p>':''}</article><article class="prize-card panel">${img('prize-gift-box','Peak Haven gift box','prize-art')}<div class="prize-info"><p class="eyebrow">YEARLY WINNER</p><div class="prize-offer"><span class="prize-number">12</span><div class="prize-words"><strong>FREE<br>PRODUCTS</strong><p>Your choice.</p></div></div></div>${detailed?'<p class="prize-explain">Win the yearly leaderboard.<br>Choose your products.</p>':''}</article></div><p class="rule-note"><button class="rule-link" type="button" data-rules>Prize rules apply.</button></p>`;}
function playsLeft(id){if(account.enabled)return Math.max(0,Math.floor(Number(server.plays?.[id])||0));return freePlaysLeft(id);}
// Signed in, coins come from the server and buy an extra run of any ranked game once that game's free plays are
// gone; the blue-coin wallet in play-credits.js is the on-device demo's own.
const coinsNow=()=>account.enabled?Math.max(0,Math.floor(Number(server.coins)||0)):playWallet().coins;
const shopOpen=()=>account.enabled&&Boolean(server.shop?.enabled);
const pendingPurchase=()=>(server.purchases||[]).find(p=>p?.status==='pending')??null;
function availableNow(id){return account.enabled?playsLeft(id)+coinsNow():availablePlays(id);}
// The shop, or an explanation when there is nothing to sell. Signed in it shows the real balance and the real
// packs, and buying hands back a reference to pay; the on-device demo keeps its simulated purchase.
function openExtraPlays(){
 if(account.enabled){
  if(!shopOpen()){
   showModal(`<h2 id="modal-title">No plays left today</h2><p>You get 3 free plays of each game every day. They refresh at midnight, Melbourne time.</p>${supportLine('modal-support')}<button class="primary" id="extra-done">Got it ${icon('check')}</button>`);
   bindSupport(modal,toast);
   $('#extra-done').onclick=()=>modal.close();
   return;
  }
  const waiting=pendingPurchase();
  showReferenceResults({shopOnly:true,assetBase:'game/assets/',
   accountShop:{coins:coinsNow(),packs:server.shop.packs||[],pending:waiting,pendingInstructions:server.shop.payment,
    buy:async coins=>{
     const r=await account.api('buy',{body:{coins}});
     if(r.ok)await refreshMe();
     return r.ok?{ok:true,purchase:r.purchase,instructions:r.instructions}:{ok:false,error:r.error};
    }},
   onExit:()=>{refreshMe().then(()=>{if(view==='play'||view==='bottle')route();});}});
  return;
 }
 showReferenceResults({shopOnly:true,assetBase:'game/assets/',onExit:()=>{if(view==='play')renderPlay();}});
}
// "+N coins added", once per purchase on this device, the next time the player opens the arcade after an admin
// has matched their payment.
function announceCoins(){
 if(!account.enabled)return;
 for(const purchase of server.purchases||[]){
  if(purchase?.status!=='paid'||!purchase.reference)continue;
  const key=`ph-arcade-coins-${purchase.reference}`;
  try{if(localStorage.getItem(key)==='1')continue;localStorage.setItem(key,'1');}catch{continue;}
  toast(`+${fmt(purchase.coins)} coin${Number(purchase.coins)===1?'':'s'} added. Payment received.`);
  return;
 }
}
// One line about the balance, wherever it is shown.
const coinLine=()=>{const coins=coinsNow();return `${coins} coin${coins===1?'':'s'}`;};
// The balance and anything waiting for payment, on the profile. Nothing shows in demo mode, or before the shop
// is set up for someone who has never had a coin.
function walletBlock(){
 if(!account.enabled||!account.signedIn())return '';
 const coins=coinsNow(),waiting=pendingPurchase();
 if(!coins&&!waiting&&!shopOpen())return '';
 return `<div class="wallet-block"><span class="wallet-balance">${icon('cart')}<b>${fmt(coins)}</b> ${coins===1?'coin':'coins'}<small>1 coin = 1 extra try on any game</small></span>${waiting?`<p class="wallet-waiting">Waiting for payment: <b>${escape(waiting.reference)}</b> · ${escape(waiting.price)} for ${fmt(waiting.coins)} coins. They are added once it lands.</p>`:''}${shopOpen()?`<button class="secondary" id="wallet-shop" type="button">${waiting?'Payment details':'Get extra tries'} ${icon('arrow')}</button>`:''}</div>`;
}
function renderPlay(){
 const artwork={blocks:'cover-peak-blocks-v2',ridge:'cover-ridge-run-v2',sequence:'cover-sequence-v2'};
 shell('Play','Play free. Win product.',`${prizeCards()}<section class="daily-intro" aria-labelledby="daily-title"><h2 id="daily-title">Three games. Nine free plays.</h2><p>3 free plays per game, every day.</p></section><div class="daily-games" aria-label="Choose a game">${games.map(([id,name,headline,,,,sub])=>{const left=playsLeft(id);return `<article class="daily-game"><div class="daily-game-image"><img src="assets/${artwork[id]}.webp" alt="${name} game artwork" width="1280" height="720" decoding="async">${img(`bottle-${state.bottle}`,'','daily-game-badge')}</div><div class="daily-game-copy"><h3>${name}</h3><p><strong>${headline}</strong> <span>${sub}</span></p><span class="plays-left">${icon('gamepad')}<span>${account.enabled&&!server.plays?'Plays unavailable':playsText(left)}${!left&&coinsNow()?` · ${coinLine()}`:''}</span></span></div><button class="primary daily-play-button" data-game="${id}" aria-label="${account.enabled&&!server.plays?`Retry loading plays for ${name}`:availableNow(id)?`Play ${name}`:shopOpen()||!account.enabled?`Get coins to play ${name}`:`No plays left for ${name} today`}">${account.enabled&&!server.plays?'Retry':availableNow(id)?'Play':shopOpen()||!account.enabled?'Get coins':'No plays left'} ${icon('arrow')}</button></article>`;}).join('')}</div><section class="play-shortcuts" aria-label="More from PH Arcade"><div class="play-shortcut leaderboard-shortcut"><span class="shortcut-icon" aria-hidden="true">${icon('bars')}</span><div class="shortcut-copy"><h3>Leaderboards</h3><p>Pick a game. See who is on top.</p></div><div class="shortcut-filters">${boardTabs('preview')}</div><a class="text-link ranks-preview" href="#ranks">See full ranks ${icon('arrow')}</a><div class="play-leaderboard-preview">${leaderboardTable(boardGame,period)}</div></div><div class="play-shortcut bottle-shortcut">${img(`bottle-${state.bottle}`,'','shortcut-bottle')}<div class="shortcut-copy"><h3>My Bottle</h3><p>Make it yours.</p></div><a class="customise-link" href="#bottle">Customise ${icon('arrow')}</a></div></section><div class="play-end"><button class="extra-plays" id="extra-plays">${shopOpen()||!account.enabled?icon('cart'):icon('gamepad')}<span>${shopOpen()?`Extra tries · ${coinLine()}`:account.enabled?'How plays work':'Get blue coins'}</span>${icon('chevron')}</button></div>`,'Nine free plays every day. Top the leaderboard and choose your prize.');
 main.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>openGame(b.dataset.game));
 const redrawPreview=()=>{const box=$('.play-leaderboard-preview');if(view==='play'&&box)box.innerHTML=leaderboardTable(boardGame,period);};
 bindBoardTabs('preview',()=>{redrawPreview();const game=boardGame,which=period;if(account.enabled&&!boards[boardKey(game,which)])loadBoard(game,which).then(()=>{if(boardGame===game&&period===which)redrawPreview();});});
 $('#extra-plays').onclick=openExtraPlays;
 if(account.enabled&&!boards[boardKey(boardGame,period)])loadBoard(boardGame,period).then(redrawPreview);
}
// Game and period pickers, shared by the Play page preview and the Ranks page.
function boardTabs(scope){return `<div class="tabs board-games" role="tablist" aria-label="Leaderboard game">${games.map(([id,name])=>`<button role="tab" aria-selected="${boardGame===id}" data-${scope}-game="${id}">${name}</button>`).join('')}</div><div class="tabs board-period" role="tablist" aria-label="Leaderboard period">${['monthly','yearly'].map(id=>`<button role="tab" aria-selected="${period===id}" data-${scope}-period="${id}">${id==='monthly'?'Monthly':'Yearly'}</button>`).join('')}</div>`;}
function bindBoardTabs(scope,changed){
 const sync=()=>{main.querySelectorAll(`[data-${scope}-game]`).forEach(el=>el.setAttribute('aria-selected',String(el.getAttribute(`data-${scope}-game`)===boardGame)));main.querySelectorAll(`[data-${scope}-period]`).forEach(el=>el.setAttribute('aria-selected',String(el.getAttribute(`data-${scope}-period`)===period)));};
 main.querySelectorAll(`[data-${scope}-game]`).forEach(b=>b.onclick=()=>{boardGame=b.getAttribute(`data-${scope}-game`);sync();changed(b);});
 main.querySelectorAll(`[data-${scope}-period]`).forEach(b=>b.onclick=()=>{period=b.getAttribute(`data-${scope}-period`);sync();changed(b);});
}

function renderPrizes(){shell('Prizes','Your play. Your prize.',`${prizeCards(true)}<div class="prizes-bottom"><section class="panel"><h2>How it works</h2><div class="steps"><div class="step"><b>1</b><span>Play 3 free rounds of each game, every day.</span></div><div class="step"><b>2</b><span>Score points and climb the leaderboards.</span></div><div class="step"><b>3</b><span>Winners choose their own product.</span></div></div><p class="steps-note">Every month, 1st place in each game wins a prize: three winners a month. Yearly winner, 12 free products.</p><button class="rules-button" data-rules>${icon('document')}<span>Competition rules</span><span>View rules ${icon('arrow')}</span></button></section><section class="panel"><h2>Your prizes</h2><div class="empty-prizes">${img('prize-empty-state-gift','')}<div><h3>No prize to claim yet.</h3><p>Your winning rewards will appear here.</p></div><a class="primary" href="#ranks">View ranks ${icon('arrow')}</a></div></section></div>`);}
// Sample standings for guests, who play on this device without the competition server.
const samplePlayers={blocks:['ApexLab','ChemRunner','PeakSeeker','SnowPilot','CrystalFox'],sequence:['CrystalFox','PeakSeeker','ApexLab','ChemRunner','SnowPilot'],ridge:['SnowPilot','ApexLab','CrystalFox','PeakSeeker','ChemRunner']};
const sampleScores={blocks:{monthly:[4820,4310,3960,3480,3120],yearly:[7940,7210,6890,6420,5980]},sequence:{monthly:[12650,11480,10320,9870,9210],yearly:[18420,17360,16190,15240,14870]},ridge:{monthly:[186,164,151,139,122],yearly:[242,221,206,190,177]}};
const sampleBoard=(game,which)=>({top:samplePlayers[game].map((name,i)=>({rank:i+1,name,bottle:'ph-original',points:sampleScores[game][which][i]})),players:samplePlayers[game].length});
function localBest(game){try{return Math.max(0,Number(JSON.parse(localStorage.getItem('ph-arcade-v1')||'{}').best?.[game])||0);}catch{return 0;}}
const gameName=id=>games.find(g=>g[0]===id)?.[1]||'';
const topFive=which=>which==='yearly'?'Top five this year':'Top five this month';
function leaderboardTable(game,which){const label=topFive(which);let body;if(account.enabled){const b=boards[boardKey(game,which)];body=b?boardRows((b.top||[]).slice(0,5),b.error?`${escape(b.error)} <button class="text-link" type="button" data-retry-board>Try again</button>`:'No scores yet. Be the first.'):'<tr><td colspan="3">Loading standings…</td></tr>';}else body=boardRows(sampleBoard(game,which).top,'');return `<p class="board-caption">${label} · ${gameName(game)}${!account.enabled?' · Demo standings':''}</p><table aria-label="${label} in ${gameName(game)}"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Points</th></tr></thead><tbody>${body}</tbody></table>`;}
// A board says what first place wins. Only first place does: second and third are runners-up.
const boardPrize=b=>account.enabled?(b?.prize||PRIZE_FALLBACK):PRIZE_FALLBACK;
const placeLabel=rank=>rank===2?'2nd':rank===3?'3rd':`${rank}th`;
function lastMonthPanel(b,name){
 const last=b?.lastMonth;if(!last||!last.podium?.length)return '';
 const rows=last.podium.map(r=>`<li class="${r.winner?'winner':'runner-up'}">${r.winner?`<span class="past-crown" aria-hidden="true">${icon('crown')}</span>`:`<span class="past-place" aria-hidden="true">${placeLabel(r.rank)}</span>`}${img(`bottle-${bottles.some(x=>x.id===r.bottle)?r.bottle:'ph-original'}`,'')}<div class="past-who"><strong>${escape(r.name)}${r.you?' (You)':''}</strong><small>${r.winner?'Winner · wins the prize':'Runner-up'}</small></div><span class="past-score">${fmt(r.score)}</span></li>`).join('');
 return `<section class="panel last-month" aria-label="Last month's winners in ${escape(name)}"><h2>Last month&rsquo;s winners</h2><p>${escape(name)} · ${escape(last.label||'')}</p><ol class="last-month-list">${rows}</ol><p class="micro">1st place wins the prize. 2nd and 3rd are runners-up.</p></section>`;
}
// One modal for a player who topped a game last month, whatever they won, shown once per month on this device.
function announceWin(){
 if(!account.enabled||modal.open||gameModal.open)return;
 const win=winnerModal(server.wins);if(!win)return;
 const key=`ph-arcade-win-${win.month}`;
 try{if(localStorage.getItem(key)==='1')return;localStorage.setItem(key,'1');}catch{}
 showModal(`${img('prize-gold-trophy','Golden trophy','modal-image')}<h2 id="modal-title">${escape(win.title)}</h2>${win.games.length>1?`<ul class="win-games">${win.games.map(g=>`<li>${icon('check')}${escape(g)}</li>`).join('')}</ul>`:''}<p>${escape(win.note)}</p><button class="primary" id="win-done">Great ${icon('check')}</button>`);
 $('#win-done').onclick=()=>modal.close();
}
function renderRanks(){
 const yearly=period==='yearly',name=gameName(boardGame);let b,top,me,summary;
 if(account.enabled){b=boards[boardKey(boardGame,period)];top=b?.top||[];me=b?.me;if(!b){const game=boardGame,which=period;loadBoard(game,which).then(()=>{if(view==='ranks'&&boardGame===game&&period===which)renderRanks();});}summary=!b?'Loading standings…':b.error?escape(b.error):`${name} · ${boardLabel(b)} · ${b.players} player${b.players===1?'':'s'}`;}
 else{b=sampleBoard(boardGame,period);top=b.top;const best=localBest(boardGame);me=best?{rank:1+top.filter(r=>r.points>best).length,points:best}:null;summary=`${name} · Best scores ${yearly?'this year':'this month'}`;}
 const podium=(r,num,cls)=>r?`<div class="podium-place ${cls}">${img(`bottle-${bottles.some(x=>x.id===r.bottle)?r.bottle:'ph-original'}`,'')}<div class="podium-block"><span class="podium-medal">${num}</span>${escape(r.name)}</div></div>`:`<div class="podium-place ${cls} empty"><div class="podium-block"><span class="podium-medal">${num}</span>Open</div></div>`;
 const rows=account.enabled?(b?boardRows(top,b.error?`${escape(b.error)} <button class="text-link" type="button" data-retry-board>Try again</button>`:'No scores yet. Be the first.'):'<tr><td colspan="3">Loading standings…</td></tr>')+(me&&!top.some(r=>r.you)?boardRows([me],''):''):boardRows(top,'');
 shell('Ranks','Your climb starts here.',`${prizeCards()}<div class="ranks-filters">${boardTabs('ranks')}</div><div class="ranks-layout" id="ranks-panel" role="tabpanel" aria-label="${name} ${yearly?'yearly':'monthly'} leaderboard"><section class="panel championship"><h2>${yearly?'Yearly':'Monthly'} championship</h2><p>${summary}</p><p class="prize-line">${icon('info')}<span>${escape(boardPrize(b))}</span></p><div class="podium-scene">${img('decoration-snowy-mountain-range','','podium-mountains')}${podium(top[1],2,'second')}${podium(top[0],1,'first')}${podium(top[2],3,'third')}</div><div class="your-rank"><strong>${me?me.rank:'–'}</strong>${img(`bottle-${state.bottle}`,'')}<div class="rank-name">${escape(state.name)} (You)<small>${me?'Your rank':'Play to get ranked'}</small></div><div class="rank-points">${fmt(me?.points)} pts<small>Your best score</small></div></div><div class="championship-actions"><a href="#play" class="primary">Play now ${icon('arrow')}</a><button class="text-link" data-rules>Rules &amp; scoring ${icon('arrow')}</button></div></section><section class="panel leaderboard" aria-label="${name} ${yearly?'yearly':'monthly'} leaderboard"><table><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Points</th></tr></thead><tbody>${rows}</tbody></table></section>${lastMonthPanel(b,name)}</div>`);
 bindBoardTabs('ranks',btn=>{const sel=btn.hasAttribute('data-ranks-game')?`[data-ranks-game="${boardGame}"]`:`[data-ranks-period="${period}"]`;renderRanks();main.querySelector(sel)?.focus({preventScroll:true});});
}
// Sign-in screen for invited players. Joining sends an email link; so does signing in again later.
function renderJoin(){
 const joining=joinTab==='join';
 const fields=joining?[['join-email','Email','email','email'],['join-code','Invite code','text','off'],['join-name','Player name','text','nickname']]:[['join-email','Email','email','email']];
 shell('Welcome','Invite only. Play daily. Climb the ranks.',`<section class="panel join-panel" aria-labelledby="join-title"><h2 id="join-title">${joining?'Join PH Arcade':'Sign in'}</h2><div class="tabs join-tabs" role="tablist" aria-label="Join or sign in">${[['join','I have an invite'],['signin','Sign in']].map(([id,label])=>`<button type="button" role="tab" aria-selected="${joinTab===id}" data-join-tab="${id}">${label}</button>`).join('')}</div><form id="join-form" novalidate>${fields.map(([id,label,type,ac])=>`<div class="name-field"><label for="${id}">${label}</label><div class="name-input"><input id="${id}" name="${id}" type="${type}" autocomplete="${ac}" ${id==='join-code'?'autocapitalize="characters" spellcheck="false"':''} maxlength="${id==='join-name'?24:254}" required></div></div>`).join('')}<p class="join-note${joinError?' error':''}" id="join-note" role="status">${escape(joinNote)}</p><button class="primary" id="join-submit" type="submit">${joining?'Send my sign-in link':'Email me a sign-in link'} ${icon('arrow')}</button></form><div class="guest-entry"><button class="secondary guest-continue" id="continue-as-guest" type="button">${icon('guest')}Continue as guest ${icon('arrow')}</button><p class="join-small">Progress stays on this device.</p></div><p class="join-small">We email you a link to sign in. No password needed. Open the link on the device you want to play on.</p>${supportLine('join-support')}</section>`);
 $('#continue-as-guest').onclick=()=>{window.phRankedRun=null;account.continueAsGuest();};
 bindSupport(main,toast);
 const note=(text,error=false)=>{joinNote=text;joinError=error;const el=$('#join-note');el.textContent=text;el.classList.toggle('error',error);};
 main.querySelectorAll('[data-join-tab]').forEach(b=>b.onclick=()=>{joinTab=b.dataset.joinTab;joinNote='';joinError=false;renderJoin();});
 $('#join-form').onsubmit=async e=>{e.preventDefault();const email=$('#join-email').value.trim(),code=$('#join-code')?.value.trim(),name=$('#join-name')?.value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return note('Enter a valid email address.',true);
  if(joining&&!code)return note('Enter your invite code.',true);
  if(joining&&(!name||name.length<2))return note('Choose a player name of at least 2 characters.',true);
  const button=$('#join-submit');button.disabled=true;note('Sending…');
  const r=joining?await account.join(email,code,name):await account.signIn(email);
  if(!button.isConnected)return;button.disabled=false;
  if(!r.ok)return note(withSupport(r.error),true);
  if(account.signedIn())return;
  note(r.existing?'You already have an account, so we sent a sign-in link instead. Check your email.':'Check your email for your sign-in link.');};
}
function updateFooter(){const footer=$('.page-footer');if(!footer)return;if(account.isGuest()){footer.innerHTML='<span>Playing as a guest.</span><button class="footer-signout" id="guest-sign-in">Sign in</button>';$('#guest-sign-in').onclick=()=>account.leaveGuest();return;}if(!account.enabled){footer.innerHTML='<span>Progress saved on this device.</span>';return;}footer.innerHTML=account.signedIn()?`<span>Signed in${account.email()?` as ${escape(account.email())}`:''}</span><button class="footer-signout" id="sign-out">Sign out</button>`:'<span>PH Arcade is invite only.</span><span>Daily plays refresh at midnight, Melbourne time.</span>';$('#sign-out')?.addEventListener('click',async()=>{await account.signOut();});}
const unlockText=b=>`Unlock at ${fmt(b.points)} lifetime points${b.podium?' or a top-three monthly finish':''}`;
function unlockBar(b){const have=progress().points,pct=b.points?Math.min(100,Math.round(have/b.points*100)):100;return `<div class="unlock-progress"><span class="unlock-bar" role="progressbar" aria-label="${b.name} unlock progress" aria-valuemin="0" aria-valuemax="${b.points}" aria-valuenow="${Math.min(have,b.points)}"><i style="width:${pct}%"></i></span><small>${fmt(Math.min(have,b.points))} / ${fmt(b.points)} pts</small></div>`;}
function renderBottle(){const current=bottles.find(b=>b.id===preview),unlocked=isUnlocked(current.id)||state.bottle===current.id;const capFilter=cap==='gold'?'sepia(1) saturate(2.5) hue-rotate(355deg)':cap==='violet'?'sepia(.8) saturate(2) hue-rotate(215deg)':'none';const options=customTab==='colour'?`<p>Choose your bottle look.</p><div class="swatches" aria-label="Bottle colour">${bottles.map(b=>`<button class="swatch" style="background:${b.color}" aria-label="Preview ${b.name}${isUnlocked(b.id)?'':', locked'}" aria-pressed="${preview===b.id}" data-colour="${b.id}">${preview===b.id?icon('check'):''}</button>`).join('')}</div>`:customTab==='cap'?`<p>Choose a cap finish.</p><div class="option-list">${[['silver','Silver'],['gold','Gold'],['violet','Violet']].map(([id,name])=>`<button aria-pressed="${cap===id}" data-cap="${id}">${name}</button>`).join('')}</div>`:`<p>Add a finishing touch.</p><div class="option-list">${[['none','None'],['aura','Glow'],['snow','Snow']].map(([id,name])=>`<button aria-pressed="${accessory===id}" data-accessory="${id}">${name}</button>`).join('')}</div>`;
shell('My Bottle','Make it yours.',`<div class="bottle-layout"><section class="bottle-stage" aria-label="${current.name} bottle preview">${accessory==='aura'?'<div class="stage-aura"></div>':''}${img('prop-ice-pedestal','','pedestal')}${img(`bottle-${preview}`,current.name,'preview-bottle')}${cap!=='silver'?img(`bottle-${preview}`,'','cap-overlay').replace('class="cap-overlay"',`class="cap-overlay" style="filter:${capFilter}"`):''}${accessory==='snow'?'<div class="stage-snow" aria-hidden="true">✧<span>✧</span>✧</div>':''}${!unlocked?'<span class="preview-note">Collection preview</span>':''}</section><section class="panel bottle-settings"><h2 class="bottle-title">${current.name}</h2>${preview===state.bottle?equipped():`<span class="micro">${unlocked?'Ready to equip':`${current.tier} · ${unlockText(current)}`}</span>`}<div class="name-field"><label for="player-name">Player name</label><div class="name-input"><input id="player-name" maxlength="24" value="${escape(state.name)}" autocomplete="nickname" aria-label="Player name">${icon('edit')}</div></div>${walletBlock()}<div class="customize-panel"><div class="tabs" role="tablist" aria-label="Bottle customization">${[['colour','Colour'],['cap','Cap'],['accessories','Accessories']].map(([id,name])=>`<button role="tab" aria-selected="${customTab===id}" data-custom-tab="${id}" aria-controls="customization-options">${name}</button>`).join('')}</div><div id="customization-options" role="tabpanel">${options}</div><button class="primary" id="save-look">${unlocked?'Save look':'How to unlock'} ${icon('arrow')}</button></div></section><section class="panel collection-panel"><h2>Your collection</h2><div class="collection-grid">${bottles.map(b=>{const open=isUnlocked(b.id)||state.bottle===b.id;return `<article class="collection-card ${state.bottle===b.id?'selected':''} ${open?'':'locked'}"><div class="collection-art">${img(`bottle-${b.id}`,b.name)}${open?'':`<button class="lock-button" data-lock="${b.id}" aria-label="How to unlock ${b.name}">${icon('lock')}</button>`}</div><div><h3>${b.name}</h3><span class="tier">${b.tier}</span>${state.bottle===b.id?equipped():open?`<button class="secondary" data-preview="${b.id}">Preview</button>`:`${unlockBar(b)}<button class="secondary" data-preview="${b.id}">Preview</button>`}</div></article>`;}).join('')}</div><p class="collection-note">Earn points to unlock new bottles.</p></section></div>`);
const rememberName=()=>{const name=$('#player-name').value.trim();if(name)state.name=name.slice(0,24);};const redraw=callback=>{rememberName();callback();renderBottle();};main.querySelectorAll('[data-custom-tab]').forEach(b=>b.onclick=()=>{redraw(()=>customTab=b.dataset.customTab);main.querySelector(`[data-custom-tab="${customTab}"]`).focus({preventScroll:true});});main.querySelectorAll('[data-colour]').forEach(b=>b.onclick=()=>redraw(()=>preview=b.dataset.colour));main.querySelectorAll('[data-cap]').forEach(b=>b.onclick=()=>redraw(()=>cap=b.dataset.cap));main.querySelectorAll('[data-accessory]').forEach(b=>b.onclick=()=>redraw(()=>accessory=b.dataset.accessory));main.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>redraw(()=>preview=b.dataset.preview));main.querySelectorAll('[data-lock]').forEach(b=>b.onclick=()=>openUnlock(b.dataset.lock));const walletButton=$('#wallet-shop');if(walletButton)walletButton.onclick=openExtraPlays;$('#save-look').onclick=()=>{if(!unlocked)return openUnlock(preview);rememberName();if(!$('#player-name').value.trim()){toast('Add a player name to save your look.');$('#player-name').focus();return;}state.bottle=preview;state.cap=cap;state.accessory=accessory;save();renderBottle();toast('Look saved. Your bottle is ready to play.');if(account.enabled)account.api('profile',{body:{name:state.name,bottle:state.bottle}}).then(r=>{if(!r.ok)toast(r.error);boards={};});};}
function showModal(content){modal.innerHTML=`<button class="icon-button modal-close" aria-label="Close dialog">${icon('close')}</button>${content}`;modal.querySelector('.modal-close').onclick=()=>{if(!modal.querySelector('#start-game:disabled'))modal.close();};if(!modal.open)modal.showModal();}
function openUnlock(id){const b=bottles.find(b=>b.id===id);showModal(`${img(`bottle-${id}`,'','modal-image locked-bottle')}<h2 id="modal-title">${b.name}</h2><p>${b.tier} bottle. ${unlockText(b)}. Every game you finish earns points.</p>${unlockBar(b)}<div class="modal-actions"><button class="primary" id="unlock-play">Go to Play ${icon('arrow')}</button><button class="secondary" id="unlock-preview">Preview bottle</button></div>`);$('#unlock-play').onclick=()=>{modal.close();location.hash='play';};$('#unlock-preview').onclick=()=>{preview=id;modal.close();renderBottle();};}
function openRules(){showModal(`<h2 id="modal-title">Rules &amp; scoring</h2><ol class="rules-list"><li>You get 3 free plays of each game every day. Plays refresh at midnight, Melbourne time.</li><li>Everyone plays the same course in each game on a given day, so it comes down to skill.</li><li>Each game has its own monthly and yearly leaderboard, ranked by your best score in that game.</li><li>For prizes, each game's monthly board earns rank points: 1st place 100, 2nd 90, 3rd 80, down to 5 points for 15th, and 1 point for any other score. Your points from Peak Blocks, Sequence and Ridge Run add up to your monthly total. The yearly total adds up your monthly points.</li><li>Every month, 1st place on each game&rsquo;s monthly leaderboard wins a prize, so there are three winners a month: Peak Blocks, Sequence and Ridge Run. 2nd and 3rd are runners-up and win nothing. The yearly winner chooses 12 free products.</li><li>In Sequence, a run carries on while you clear levels, and every level you clear adds to the run's score.</li><li>Every score is checked by replaying your game on our server. Scores that can't be verified don't count.</li><li>Bottle looks are cosmetic and give no score advantage.</li></ol><button class="primary" id="rules-done">Got it ${icon('check')}</button>`);$('#rules-done').onclick=()=>modal.close();}
function pendingNotice(){
 const pending=account.enabled&&pendingResults.get(server.email);
 return pending?`<aside class="pending-result" role="status"><p>Your ${gameName(pending.game)} score is waiting to be saved.</p><div><button class="secondary" type="button" data-retry-score ${recoveringResult?'disabled':''}>${recoveringResult?'Saving…':'Retry saving score'}</button><button class="text-link" type="button" data-dismiss-score>Dismiss</button></div></aside>`:'';
}
async function recoverPendingResult(){
 const pending=pendingResults.get(server.email);if(!pending||recoveringResult)return;
 recoveringResult=true;route();
 try{
  const r=await account.api('finish',{body:pending.body});
  if(r.ok||!r.retryable)pendingResults.clear(pending.owner);
  if(r.ok){boards={};await refreshMe();toast(`Score saved: ${fmt(r.score)} points.`);}else toast(r.error);
 }finally{recoveringResult=false;if(!gameModal.open)route();}
}
function openGame(id){if(account.enabled&&!server.plays){refreshMe().then(route);return;}if(account.enabled&&pendingResults.get(server.email)){toast('Save or dismiss your pending score before starting another run.');return;}const g=games.find(g=>g[0]===id);if(!g)return;if(!availableNow(id))return openExtraPlays();const left=playsLeft(id),coins=left?0:coinsNow();showModal(`<img class="modal-image" src="game/assets/game-icons/${g[4]}" alt=""><h2 id="modal-title">${g[1]}</h2><p class="game-modal-tagline">${g[2]}</p><span class="modal-plays">${icon('gamepad')}${coins?`No free plays left · uses 1 of your ${coins} coins`:`${left} play${left===1?'':'s'} left today`}</span><div class="game-controls-note"><strong>Goal</strong><p>${howTo[id].goal}</p><strong>How to play</strong><p>${howTo[id].how}</p></div><label class="sound-option">Sound effects<input type="checkbox" id="game-sound" ${state.sound?'checked':''}></label><button class="primary" id="start-game">Let’s play ${icon('arrow')}</button><p class="modal-footnote">Your best score counts toward the leaderboard.</p>`);let starting=false;const button=$('#start-game'),soundInput=$('#game-sound');button.onclick=async()=>{if(starting||!modal.open||!button.isConnected)return;starting=true;button.disabled=true;const sound=soundInput.checked;if(!availableNow(id)){modal.close();renderPlay();return openExtraPlays();}if(account.enabled){const r=await startRankedRun(id);starting=false;button.disabled=false;if(!r.ok){modal.close();route();return toast(r.error);}}else{const launch=consumePlay(id);if(!launch.ok){modal.close();renderPlay();if(launch.reason==='storage'){toast('Your browser could not save plays. Please allow site storage and try again.');return;}return openExtraPlays();}}if(!modal.open||!button.isConnected)return;state.sound=sound;save();let gameData={};try{gameData=JSON.parse(localStorage.getItem('ph-arcade-v1')||'{}');}catch{}gameData={...gameData,version:1,sound:state.sound,soundPreference:true,tutorials:[...new Set([...(Array.isArray(gameData?.tutorials)?gameData.tutorials:[]),id,id==='orbit'?'orbit-pull-v2':id])]};try{localStorage.setItem('ph-arcade-v1',JSON.stringify(gameData));}catch{}modal.close();activeGame=id;loadGameFrame(id);gameModal.showModal();frame.focus();};}
// Starts a competition run on the server (it spends one of today's plays) and leaves its seed for the game frame.
async function startRankedRun(id){const revision=accountRevision,requestId=startRequests.id(server.email,id);const r=await account.api('start',{body:{game:id,requestId}});if(revision!==accountRevision)return {ok:false,status:401,error:'Please sign in again before playing.'};if(r.ok||!r.retryable)startRequests.clear();if(r.plays)server.plays=r.plays;if(Number.isFinite(Number(r.coins)))server.coins=Math.max(0,Math.floor(Number(r.coins)));if(!r.ok)return r;window.phRankedRun={runId:r.runId,game:id,seed:r.seed,level:r.level,rulesVersion:r.rulesVersion??1,score:0,pending:false,done:false,error:null};return r;}
// "Play again" on the result screen: a fresh server run, then reload the game frame straight into the game.
let replayStarting=false;
async function playAgainRanked(id){if(replayStarting||!gameModal.open||activeGame!==id)return;replayStarting=true;const r=await startRankedRun(id);replayStarting=false;if(!gameModal.open||activeGame!==id)return;if(!r.ok){closeGame();return toast(r.error);}activeGame=id;loadGameFrame(id);}
function closeGame(){clearTimeout(frameTimer);gameModal.querySelector('.game-load-state')?.remove();activeGame=null;window.phRankedRun=null;gameModal.close();frame.removeAttribute('src');if(view==='play'){if(account.enabled&&!account.signedIn())route();else renderPlay();}if(account.enabled){boards={};refreshMe().then(()=>{if(view==='play'&&!gameModal.open)route();});}}
// Sends each finished game (each Sequence level) to the server, which replays it before it counts. The game frame
// reads window.phRankedRun for its seed, and waits on it before starting the next Sequence level.
async function submitRanked(msg){
 const run=window.phRankedRun;if(!run||run.done||run.pending||run.game!==msg.game||msg.runId!==run.runId||msg.level!==run.level)return;
 const tell=state=>{if(window.phRankedRun===run&&gameModal.open)frame.contentWindow?.postMessage({type:'ph-ranked-result',runId:run.runId,state},location.origin);};
 if(!msg.replay){run.done=true;return tell({phase:'error',error:'This game does not count toward the leaderboard.',plays:playsLeft(run.game)});}
 run.message=msg;run.pending=true;run.error=null;tell({phase:'checking'});
 const owner=server.email,body={runId:run.runId,replay:msg.replay,claimed:msg.score};
 pendingResults.set(owner,run.game,body);
 const r=await account.api('finish',{body});run.pending=false;boards={};
 if(r.ok||!r.retryable)pendingResults.clear(owner);
 if(owner!==server.email)return;
 if(!r.ok){run.error=r.error;run.done=!r.retryable;return tell({phase:'error',error:r.error,retryable:r.retryable,plays:playsLeft(run.game)});}
 run.score=r.score;if(r.plays)server.plays=r.plays;if(Number.isFinite(Number(r.coins)))server.coins=Math.max(0,Math.floor(Number(r.coins)));
 if(r.done){run.done=true;tell({phase:'done',score:r.score,board:r.board,plays:playsLeft(run.game),coins:coinsNow()});}
 else{run.seed=r.nextSeed;run.level=r.nextLevel;tell({phase:'next',score:r.score,level:r.nextLevel});}
}
let frameTimer;
function loadGameFrame(id){
 clearTimeout(frameTimer);gameModal.querySelector('.game-load-state')?.remove();
 const panel=document.createElement('div');panel.className='game-load-state';panel.innerHTML='<p role="status">Loading your game…</p><button class="secondary" type="button" hidden>Retry loading</button><button class="text-link" type="button">Back to arcade</button>';gameModal.append(panel);
 const retry=panel.querySelector('.secondary');retry.onclick=()=>loadGameFrame(id);panel.querySelector('.text-link').onclick=closeGame;
 frameTimer=setTimeout(()=>{if(!panel.isConnected)return;panel.querySelector('p').textContent='The game could not load. Check your connection and try again.';retry.hidden=false;},12000);
 frame.src=`game/index.html?load=${Date.now()}#play/${id}`;
}
modal.addEventListener('cancel',e=>{if(modal.querySelector('#start-game:disabled'))e.preventDefault();});
gameModal.addEventListener('cancel',e=>{e.preventDefault();try{frame.contentWindow.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));}catch{closeGame();}});
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||e.source!==frame.contentWindow||!activeGame||e.data?.game!==activeGame)return;
 const msg=e.data;
 if(msg.type==='ph-game-ready'){clearTimeout(frameTimer);gameModal.querySelector('.game-load-state')?.remove();}
 if(msg.type==='ph-game-exit')closeGame();
 if(msg.type==='ph-play-again'&&account.enabled)playAgainRanked(msg.game);
 if(msg.type==='ph-retry-result'&&account.enabled){const run=window.phRankedRun;if(run?.message&&!run.pending)submitRanked(run.message);}
 if(msg.type==='ph-game-ranks'){boardGame=msg.game;closeGame();location.hash='ranks';}
 if(msg.type==='ph-game-finished'){
  if(account.enabled)submitRanked(msg);
  else{state.runs++;state.points+=pointsForGame(msg.score);save();}
 }
});
function route(){updateFooter();if(account.enabled&&(!account.signedIn()||server.status===403)){if(modal.open)modal.close();if(gameModal.open)closeGame();view='join';if(server.status===403&&!joinNote){joinNote=server.error;joinError=true;}return renderJoin();}const next=location.hash.slice(1)||'play';if(next.startsWith('play/')){view='play';renderPlay();openGame(next.split('/')[1]);return;}view=navItems.some(x=>x[0]===next)?next:'play';if(modal.open)modal.close();if(gameModal.open)closeGame();({play:renderPlay,ranks:renderRanks,prizes:renderPrizes,bottle:renderBottle}[view])();window.scrollTo({top:0,behavior:'instant'});announceWin();announceCoins();}
main.addEventListener('click',e=>{if(e.target.closest('[data-rules]'))openRules();if(e.target.closest('[data-retry-account]'))refreshMe().then(route);if(e.target.closest('[data-retry-score]'))recoverPendingResult();if(e.target.closest('[data-dismiss-score]')){pendingResults.clear(server.email);route();}if(e.target.closest('[data-retry-board]')){delete boards[boardKey(boardGame,period)];route();}});
$('.skip-link').onclick=e=>{e.preventDefault();main.focus();main.scrollIntoView();};
$('#menu-button').onclick=()=>{showModal(`<h2 id="modal-title">Peak Haven Arcade</h2><nav class="modal-links" aria-label="Menu">${navItems.map(([id,name])=>`<a href="#${id}">${name} ${icon('arrow')}</a>`).join('')}</nav><p style="margin-top:18px">Play. Earn. Win. Your progress stays on this device.</p>`);$('#menu-button').setAttribute('aria-expanded','true');modal.querySelectorAll('a').forEach(a=>a.onclick=()=>modal.close());};modal.addEventListener('close',()=>$('#menu-button').setAttribute('aria-expanded','false'));$('#bag-button').onclick=()=>{location.hash='prizes';};window.addEventListener('hashchange',route);
if(account.enabled&&account.signedIn())await refreshMe();
if(account.linkError){joinNote=linkErrorMessage(account.linkError);joinError=true;joinTab='signin';}
account.onChange(async()=>{accountRevision++;server=emptyServer();boards={};joinNote='';joinError=false;await refreshMe();route();});
route();

// Refresh daily allowances when a tab returns after midnight, without interrupting a running game.
let refreshing=false;
async function refreshAfterReturn(){if(document.hidden||refreshing||gameModal.open||modal.open||!account.enabled||!account.signedIn())return;refreshing=true;try{await refreshMe();if(!gameModal.open&&!modal.open)route();}finally{refreshing=false;}}
document.addEventListener('visibilitychange',refreshAfterReturn);
