import {sequenceTarget} from './sequence-rules.js';
import {COIN_PACKS,playWallet,freePlaysLeft,availablePlays,consumePlay,simulateCoinPurchase} from './play-credits.js';

const names={blocks:'Peak Blocks',ridge:'Ridge Run',sequence:'Sequence'};
const paths={back:'<path d="M20 12H4m6-6-6 6 6 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',play:'<path d="m8 5 11 7-11 7z"/>',restart:'<path d="M4 9a9 9 0 1 1-1 7m1-13v6h6"/>',ranks:'<path d="M5 20V11m7 9V4m7 16V8"/>',arrow:'<path d="m9 5 7 7-7 7"/>',spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>'};
const svg=name=>`<svg class="rr-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');
const coinArt=(index,cls='')=>`<span class="blue-coin-art coin-art-${index} ${cls}" aria-hidden="true"></span>`;

export function showReferenceResults({game='blocks',result=null,best=0,level=1,onReplay,onExit,onRanks,shopOnly=false,assetBase='assets/',motion=true}){
 document.querySelector('.reference-dialog')?.remove();
 const dialog=document.createElement('dialog');dialog.className=`reference-dialog reference-${game}`;dialog.setAttribute('aria-labelledby','rr-title');
 dialog.style.setProperty('--coin-atlas',`url("${assetBase}ui/blue-coins-atlas.png")`);
 dialog.style.setProperty('--mountains',`url("${assetBase}ui/result-mountains.webp")`);
 dialog.dataset.outcome=result?.won?'won':'lost';
 const won=Boolean(result?.won),name=names[game],title=game==='sequence'?(won?'LEVEL CLEARED':'LEVEL NOT CLEARED'):'RUN OVER';
 const metrics=game==='sequence'?[[result?.score,'Score'],[sequenceTarget(level),'Goal'],[Math.max(0,25-(result?.moves||0)),'Moves']]:[[result?.score,'Score'],[game==='ridge'?result?.gates:best,game==='ridge'?'Gates':'Best'],[game==='ridge'?best:result?.moves,game==='ridge'?'Best':'Moves']];
 dialog.innerHTML=`<div class="reference-panel"><button class="rr-close" aria-label="Close coin shop">${svg('close')}</button><section class="run-summary"><div class="run-art"><img src="${assetBase}ui/run-over-mascot.png" alt="Peak Haven bottle mascot taking a rest" width="1456" height="1056">${game==='sequence'?`<div class="sequence-wallet"><strong class="wallet-count">0</strong><span>SHARED COINS</span></div>${coinArt(2,'sequence-coin-cluster')}<small class="sequence-coin-rule">1 coin = 1 play<br>in any game</small>`:''}<span class="run-spark run-spark-one" aria-hidden="true">${svg('spark')}</span><span class="run-spark run-spark-two" aria-hidden="true">${svg('spark')}</span></div><div class="run-heading"><h2 class="run-game-name">${game==='sequence'?`Sequence · Level ${level}`:`<img src="${assetBase}ui/logo-${game==='blocks'?'peak-blocks':'ridge-run'}.png" alt="${name}" width="900" height="270">`}</h2><h1 id="rr-title">${title}</h1></div><p class="run-intro">${game==='sequence'?(won?'Lovely work. The next level is ready.':'Try this level again with a fresh board.'):game==='ridge'?'Start a fresh run. Chase your best.':''}</p><dl class="run-metrics">${metrics.map(([value,label])=>`<div><dt>${label}</dt><dd>${fmt(value)}</dd></div>`).join('')}</dl><div class="run-wallet">${coinArt(2)}<div><p><strong class="wallet-count">0</strong> <span>shared coins</span></p><small>1 coin = 1 play in any game</small></div></div><button class="rr-primary" id="rr-replay">${svg(game==='blocks'?'play':'restart')}<span>${won?'NEXT LEVEL':'KEEP GOING'}</span></button><p class="run-availability"></p><button class="rr-secondary" id="rr-ranks">${svg('ranks')}View ${name} ranks</button><button class="rr-secondary" id="rr-exit">${svg('back')}Back to arcade</button><button class="rr-coins-link" id="rr-get-coins">Get blue coins ${svg('arrow')}</button></section><section class="shop-content" aria-labelledby="shop-title"><header class="shop-heading"><img class="shop-mascot" src="${assetBase}ui/run-over-mascot.png" alt="" width="1456" height="1056"><div><h2 id="shop-title">KEEP GOING?</h2><p>One balance. Play any of the three games.</p></div></header><div class="shop-run-note">${name}${game==='sequence'?` · Level ${level}`:''} · ${title.toLowerCase()} · ${fmt(result?.score)} pts</div><div class="shop-wallet">${coinArt(0)}<span>Shared coins: <strong class="wallet-count">0</strong></span></div><fieldset class="coin-packs"><legend class="rr-sr-only">Choose a blue coin pack</legend>${COIN_PACKS.map((pack,index)=>`<label class="coin-pack ${pack.popular?'popular':''}"><input type="radio" name="coin-pack" value="${pack.coins}" ${pack.popular?'checked':''}><span class="pack-body">${pack.popular?'<span class="pack-popular">MOST POPULAR</span>':''}<span class="pack-count">${pack.coins}</span><span class="pack-unit">${pack.coins===1?'COIN':'COINS'}</span>${coinArt(index)}<span class="pack-price">${pack.price}</span><small class="pack-prototype">Prototype</small></span></label>`).join('')}</fieldset><p class="coin-rule">1 coin = 1 play • Works in all 3 games.</p><button class="rr-buy" id="rr-buy">BUY &amp; PLAY AGAIN</button><p class="purchase-note">Purchase confirmed first. Then ${game==='sequence'?`retry Level ${level}`:game==='ridge'?'start a new run':'start a fresh board'}.</p><button class="rr-shop-back" id="rr-shop-back">Back to arcade</button><p class="prototype-note">Prototype purchase · no payment is taken.</p><p class="rr-feedback" role="status" aria-live="polite"></p></section></div>`;
 document.body.append(dialog);
 let busy=false;
 const feedback=message=>{dialog.querySelector('.rr-feedback').textContent=message;};
 const refresh=()=>{
  const w=playWallet(),free=freePlaysLeft(game);dialog.querySelectorAll('.wallet-count').forEach(el=>el.textContent=fmt(w.coins));
  dialog.querySelector('.run-availability').textContent=free?`${won?'Next level':game==='sequence'?`Retry Level ${level}`:'Play again'} • ${free} free ${free===1?'play':'plays'} left`:w.coins?'Play again • Uses 1 shared coin':'Your free plays refresh tomorrow.';
  dialog.querySelector('#rr-replay span').textContent=availablePlays(game)?won?'NEXT LEVEL':'KEEP GOING':'GET BLUE COINS';
 };
 const setMode=mode=>{
  dialog.dataset.mode=mode;dialog.setAttribute('aria-labelledby',mode==='shop'?'shop-title':'rr-title');
  dialog.querySelector('.rr-close').hidden=mode!=='shop';refresh();dialog.scrollTop=0;
  requestAnimationFrame(()=>dialog.querySelector(mode==='shop'?'input:checked':'#rr-replay')?.focus({preventScroll:true}));
 };
 const close=()=>{dialog.close();dialog.remove();};
 const exit=()=>{close();onExit?.();};
 const replay=()=>{
  if(busy)return;
  if(!availablePlays(game)){setMode('shop');return;}
  const use=consumePlay(game);if(!use.ok){setMode('shop');feedback(use.reason==='storage'?'Your browser could not save play credits. Please allow site storage and try again.':'No plays left. Choose a blue coin pack.');return;}
  busy=true;close();onReplay?.();
 };
 dialog.querySelector('#rr-replay').onclick=replay;
 dialog.querySelector('#rr-get-coins').onclick=()=>setMode('shop');
 dialog.querySelector('#rr-exit').onclick=exit;dialog.querySelector('#rr-shop-back').onclick=exit;
 dialog.querySelector('#rr-ranks').onclick=()=>{close();onRanks?.(game);};
 dialog.querySelector('.rr-close').onclick=()=>shopOnly?exit():setMode('result');
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog.dataset.mode==='shop'&&!shopOnly)setMode('result');else if(shopOnly)exit();else exit();});
 dialog.querySelector('#rr-buy').textContent=shopOnly?'GET BLUE COINS':'BUY & PLAY AGAIN';
 dialog.querySelector('#rr-buy').onclick=()=>{
  if(busy)return;
  const coins=Number(dialog.querySelector('input:checked')?.value)||10;
  const purchase=simulateCoinPurchase(coins);if(!purchase.ok){feedback('Your browser could not save the coins. No payment was taken. Please allow site storage and try again.');return;}
  refresh();if(shopOnly){feedback(`${coins} prototype blue coins added. No payment was taken.`);return;}
  replay();
 };
 if(shopOnly){dialog.classList.add('shop-only');dialog.querySelector('.shop-run-note').hidden=true;}
 dialog.showModal();setMode(shopOnly||!availablePlays(game)?'shop':'result');
 if(motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches)dialog.animate([{opacity:.65,transform:'translateY(12px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:260,easing:'cubic-bezier(.16,1,.3,1)'});
 return {close,dialog};
}
