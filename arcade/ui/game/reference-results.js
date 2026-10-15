import {sequenceTarget} from './sequence-rules.js';
import {COIN_PACKS,playWallet,freePlaysLeft,availablePlays,consumePlay,simulateCoinPurchase} from './play-credits.js';

// One Keep Going component for Peak Blocks, Ridge Run and Sequence. Layout, sizes and behaviour are shared;
// each game only supplies the copy and the three statistics below.
const GAMES={
 blocks:{
  name:'Peak Blocks',
  title:()=>'RUN OVER',
  intro:()=>'Clear more lines to beat your best.',
  stats:({result,best})=>[[result?.score,'Score'],[best,'Best'],[result?.moves,'Moves']],
  retry:()=>'Play again',
  after:()=>'start a fresh board',
 },
 ridge:{
  name:'Ridge Run',
  title:()=>'RUN OVER',
  intro:()=>'Start a fresh run. Chase your best.',
  stats:({result,best})=>[[result?.score,'Score'],[result?.gates,'Gates'],[best,'Best']],
  retry:()=>'Play again',
  after:()=>'start a new run',
 },
 sequence:{
  name:'Sequence',
  eyebrow:({level})=>`Sequence · Level ${level}`,
  title:({won})=>won?'LEVEL CLEARED':'LEVEL NOT CLEARED',
  intro:({won})=>won?'Lovely work. The next level is ready.':'Try this level again with a fresh board.',
  stats:({result,level})=>[[result?.score,'Score'],[sequenceTarget(level),'Goal'],[Math.max(0,25-(result?.moves||0)),'Moves']],
  retry:({won,level})=>won?`Play Level ${level+1}`:`Retry Level ${level}`,
  after:({won,level})=>won?`play Level ${level+1}`:`retry Level ${level}`,
 },
};
const paths={back:'<path d="M20 12H4m6-6-6 6 6 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',restart:'<path d="M4 9a9 9 0 1 1-1 7m1-13v6h6"/>',next:'<path d="M5 12h14m-6-6 6 6-6 6"/>',ranks:'<path d="M5 20V11m7 9V4m7 16V8"/>',arrow:'<path d="m9 5 7 7-7 7"/>',spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>'};
const svg=name=>`<svg class="kg-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');
const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
const coinArt=(index,cls='')=>`<span class="kg-coin kg-coin-${index} ${cls}" aria-hidden="true"></span>`;

// What the result panel offers once a run ends. The coin shop only opens by itself after the
// day's free plays for this game and every shared coin are spent.
export function keepGoingOffer(free,coins){
 if(free>0)return 'free';
 if(coins>0)return 'coin';
 return 'shop';
}

export function showReferenceResults({game='blocks',result=null,best=0,level=1,onReplay,onExit,onRanks,shopOnly=false,assetBase='assets/',motion=true}){
 document.querySelector('.kg-dialog')?.remove();
 const cfg=GAMES[game]||GAMES.blocks,won=Boolean(result?.won),ctx={won,level,result,best};
 const dialog=document.createElement('dialog');
 dialog.className=`kg-dialog kg-${game}`;
 const assetUrl=file=>new URL(file,new URL(assetBase,document.baseURI)).href;
 dialog.style.setProperty('--kg-coin-atlas',`url("${assetUrl('ui/blue-coins-atlas.png')}")`);
 dialog.style.setProperty('--kg-mountains',`url("${assetUrl('ui/result-mountains.webp')}")`);
 const mascot=cls=>`<img class="${cls}" src="${assetBase}ui/run-over-mascot.png" alt="" width="1456" height="1056" decoding="async">`;
 const title=cfg.title(ctx),eyebrow=cfg.eyebrow?.(ctx)||cfg.name;
 dialog.innerHTML=`
<section class="kg-result" aria-labelledby="kg-result-title">
 <div class="kg-art">${mascot('kg-mascot')}<span class="kg-spark kg-spark-a">${svg('spark')}</span><span class="kg-spark kg-spark-b">${svg('spark')}</span></div>
 <header class="kg-head"><p class="kg-eyebrow">${eyebrow}</p><h1 id="kg-result-title" class="kg-title">${title}</h1><p class="kg-intro">${cfg.intro(ctx)}</p></header>
 <dl class="kg-stats">${cfg.stats(ctx).map(([value,label])=>`<div><dt>${label}</dt><dd>${fmt(value)}</dd></div>`).join('')}</dl>
 <button class="kg-primary" id="kg-replay" type="button">${svg(won?'next':'restart')}<span class="kg-primary-copy"><strong class="kg-primary-label"></strong><small class="kg-primary-note"></small></span></button>
 <div class="kg-actions"><button class="kg-secondary" id="kg-ranks" type="button">${svg('ranks')}<span>View ${cfg.name} ranks</span></button><button class="kg-secondary" id="kg-exit" type="button">${svg('back')}<span>Back to arcade</span></button></div>
 <div class="kg-wallet" hidden>${coinArt(0)}<p><strong class="kg-wallet-count">0</strong> shared coins<small>1 coin = 1 play</small></p><button class="kg-link" id="kg-get-coins" type="button">Get more ${svg('arrow')}</button></div>
</section>
<section class="kg-shop" aria-labelledby="kg-shop-title">
 <button class="kg-close" type="button" aria-label="Close coin shop">${svg('close')}</button>
 <header class="kg-shop-head">${mascot('kg-shop-mascot')}<div><h2 id="kg-shop-title" class="kg-shop-title">KEEP GOING?</h2><p>One balance. Play any of the three games.</p><span class="kg-pill">1 blue coin = 1 play</span></div></header>
 <p class="kg-run-note">${eyebrow} · ${title.toLowerCase()} · ${fmt(result?.score)} pts</p>
 <p class="kg-out-note">Your free plays are used up for today.</p>
 <p class="kg-balance">${coinArt(0)}<span>Shared coins</span><strong class="kg-wallet-count">0</strong></p>
 <fieldset class="kg-packs"><legend class="kg-sr-only">Choose a blue coin pack</legend>${COIN_PACKS.map((pack,index)=>`<label class="kg-pack${pack.popular?' is-popular':''}"><input type="radio" name="kg-pack" value="${pack.coins}"${pack.popular?' checked':''}><span class="kg-pack-body"><span class="kg-pack-badge">${pack.popular?'MOST POPULAR':''}</span><span class="kg-pack-count">${pack.coins}</span><span class="kg-pack-unit">${pack.coins===1?'PLAY COIN':'PLAY COINS'}</span>${coinArt(index,'kg-pack-coin')}<span class="kg-pack-price">${pack.price}</span></span></label>`).join('')}</fieldset>
 <p class="kg-rule">Coins work across all three games.</p>
 <button class="kg-buy" id="kg-buy" type="button">${shopOnly?'GET BLUE COINS':'BUY &amp; PLAY AGAIN'}</button>
 <p class="kg-buy-note">Purchase confirmed first. Then ${cfg.after(ctx)}.</p>
 <button class="kg-ghost" id="kg-shop-exit" type="button">Back to arcade</button>
 <p class="kg-proto-note">No payment is taken.</p>
 <p class="kg-feedback" role="status" aria-live="polite"></p>
</section>`;
 document.body.append(dialog);
 let busy=false;
 const $=s=>dialog.querySelector(s);
 const feedback=message=>{$('.kg-feedback').textContent=message;};
 const refresh=()=>{
  const coins=playWallet().coins,free=freePlaysLeft(game),offer=keepGoingOffer(free,coins);
  dialog.querySelectorAll('.kg-wallet-count').forEach(el=>el.textContent=fmt(coins));
  dialog.dataset.offer=offer;
  $('.kg-primary-label').textContent=offer==='shop'?'GET BLUE COINS':won?'NEXT LEVEL':'KEEP GOING';
  $('.kg-primary-note').textContent=offer==='free'?`${cfg.retry(ctx)} • ${plural(free,'free play','free plays')} left`:offer==='coin'?`${cfg.retry(ctx)} • uses 1 coin`:'Free plays are used up for today';
  // Coins only come into play once today's free plays are gone.
  $('.kg-wallet').hidden=offer==='free';
 };
 const setMode=mode=>{
  dialog.dataset.mode=mode;
  dialog.setAttribute('aria-labelledby',mode==='shop'?'kg-shop-title':'kg-result-title');
  refresh();dialog.scrollTop=0;
  requestAnimationFrame(()=>$(mode==='shop'?'input:checked':'#kg-replay')?.focus({preventScroll:true}));
 };
 const close=()=>{dialog.close();dialog.remove();};
 const exit=()=>{close();onExit?.();};
 const replay=()=>{
  if(busy)return;
  if(!availablePlays(game)){setMode('shop');return;}
  const use=consumePlay(game);
  if(!use.ok){setMode('shop');feedback(use.reason==='storage'?'Your browser could not save play credits. Please allow site storage and try again.':'No plays left. Choose a blue coin pack.');return;}
  busy=true;close();onReplay?.();
 };
 $('#kg-replay').onclick=replay;
 $('#kg-get-coins').onclick=()=>setMode('shop');
 $('#kg-exit').onclick=exit;$('#kg-shop-exit').onclick=exit;
 $('#kg-ranks').onclick=()=>{close();onRanks?.(game);};
 $('.kg-close').onclick=()=>shopOnly?exit():setMode('result');
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog.dataset.mode==='shop'&&!shopOnly)setMode('result');else exit();});
 $('#kg-buy').onclick=()=>{
  if(busy)return;
  const coins=Number($('input:checked')?.value)||10;
  const purchase=simulateCoinPurchase(coins);
  if(!purchase.ok){feedback('Your browser could not save the coins. No payment was taken. Please allow site storage and try again.');return;}
  refresh();
  if(shopOnly){feedback(`${coins} blue coins added. No payment was taken.`);return;}
  replay();
 };
 if(shopOnly)dialog.classList.add('kg-shop-only');
 dialog.showModal();
 setMode(shopOnly||keepGoingOffer(freePlaysLeft(game),playWallet().coins)==='shop'?'shop':'result');
 if(motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches)dialog.animate([{opacity:.65,transform:'translateY(12px) scale(.98)'},{opacity:1,transform:'none'}],{duration:260,easing:'cubic-bezier(.16,1,.3,1)'});
 return {close,dialog};
}
