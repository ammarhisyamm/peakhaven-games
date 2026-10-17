// Paid extra tries. One coin starts one extra run of any ranked game, once that game's free tries for the day
// are gone. Packs and prices live here, on the server, so a browser can only ever choose a pack by its coin
// count and never by its price. Nothing here touches the network or the database.
import {randomFillSync} from 'node:crypto';

export const COIN_CURRENCY='AUD';
// 1 coin = 1 extra run on any ranked game. Amounts are whole cents, so money is never a float.
export const COIN_PACKS=Object.freeze([
  {coins:1,cents:299},
  {coins:5,cents:999},
  {coins:10,cents:1799,popular:true},
  {coins:25,cents:2999},
].map(pack=>Object.freeze({...pack,popular:Boolean(pack.popular)})));

export const formatAmount=cents=>`A$${(Math.max(0,Math.round(Number(cents)||0))/100).toFixed(2)}`;
// The pack a request asked for, by coin count only. An unknown count is not a pack.
export const packFor=coins=>COIN_PACKS.find(p=>p.coins===coins)??null;
// What a browser is told about the shop: the price is a label, never something it can send back.
export const packList=()=>COIN_PACKS.map(p=>({coins:p.coins,cents:p.cents,price:formatAmount(p.cents),popular:p.popular}));

export function cleanPackCoins(value){
  const coins=Number(value);
  return Number.isSafeInteger(coins)&&packFor(coins)?coins:null;
}

// A payment reference the player reads off the screen and types into their banking app: no 0/O, no 1/I/L,
// no 2/Z, no 5/S, no 8/B and no 6/G, so nothing in it can be mistyped as something else.
export const REFERENCE_ALPHABET='3479ACDEFHJKMNPQRTUVWXY';
export const REFERENCE_PREFIX='PHA';
const REFERENCE_LENGTH=4;
export const REFERENCE_PATTERN=new RegExp(`^${REFERENCE_PREFIX}-[${REFERENCE_ALPHABET}]{${REFERENCE_LENGTH}}$`);
// Collisions are caught by a unique index, so this only has to be unpredictable, not unique on its own.
export function newReference(bytes=randomBytes){
  const source=bytes(REFERENCE_LENGTH);
  let out='';
  for(let i=0;i<REFERENCE_LENGTH;i++)out+=REFERENCE_ALPHABET[source[i]%REFERENCE_ALPHABET.length];
  return `${REFERENCE_PREFIX}-${out}`;
}
const randomBytes=count=>randomFillSync(new Uint8Array(count));
// A reference as typed back in, which may arrive lower case or with the dash left out.
export const cleanReference=value=>{
  const raw=String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const body=raw.startsWith(REFERENCE_PREFIX)?raw.slice(REFERENCE_PREFIX.length):raw;
  const ref=`${REFERENCE_PREFIX}-${body}`;
  return REFERENCE_PATTERN.test(ref)?ref:null;
};

export const PURCHASE_STATES=Object.freeze(['pending','paid','cancelled','refunded']);
export const LEDGER_REASONS=Object.freeze(['purchase','run','refund','admin']);
// One pending request at a time per player keeps the admin list honest: a player who taps four packs leaves
// four references nobody can match to a bank line. They can cancel and ask again.
export const MAX_PENDING_PURCHASES=1;

// The note an admin must write when they hand out or take back coins by hand, so the ledger says why.
export function cleanNote(value){
  const note=String(value??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
  return note.length>=3?note:null;
}
// A by-hand adjustment, in coins. Zero changes nothing, so it is not an adjustment.
export function cleanDelta(value){
  const delta=Number(value);
  return Number.isSafeInteger(delta)&&delta!==0&&Math.abs(delta)<=500?delta:null;
}

// The paid-tries tables, columns and functions arrive with a migration (supabase/paid-tries.sql), so a
// deployment may not have them yet. Reading then behaves as if nobody had any coins, which leaves the
// leaderboard, /api/me and the games working and keeps the shop hidden; only buying, granting and spending
// coins need the migration, and they raise this instead of failing opaquely.
export class CoinsNotReady extends Error{
  constructor(){super('Paid extra tries are not set up yet. Run arcade/supabase/paid-tries.sql in Supabase, then try again.');this.name='CoinsNotReady';}
}
// PostgREST reports a missing table, column or function either with Postgres' own code or, once it has cached
// the schema, with a code of its own and a message about the schema cache.
const MISSING=/does not exist|could not find the (table|function|column)|schema cache/i;
const MISSING_CODES=new Set(['42P01','42703','42883','PGRST202','PGRST204','PGRST205']);
export const coinsMissing=error=>Boolean(error)&&(MISSING_CODES.has(error.code)||MISSING.test(String(error.message??'')));

// Bank transfer / PayID details, from the environment and never from the repo. The shop stays hidden until
// there is enough here to actually pay: a name to pay, and either a BSB and account number or a PayID.
export function paymentDetails(env=process.env){
  const pick=name=>String(env[name]??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
  const details={
    accountName:pick('ARCADE_PAY_ACCOUNT_NAME'),
    bsb:pick('ARCADE_PAY_BSB'),
    accountNumber:pick('ARCADE_PAY_ACCOUNT_NUMBER'),
    payId:pick('ARCADE_PAY_PAYID'),
    instruction:pick('ARCADE_PAY_NOTE'),
  };
  return {...details,ready:Boolean(details.accountName&&((details.bsb&&details.accountNumber)||details.payId))};
}

// Which of a purchase's coins are still unspent, and which runs the spent ones paid for.
//
// Coins are spent in the order they were granted, so the ledger is walked once with a queue of granted coins,
// each tagged with whether it came from this purchase. A spend takes the oldest coin off the front: if that
// coin came from this purchase and the spend started a run, that run was paid for by this purchase and a
// refund has to drop it from the leaderboard. Whatever is still in the queue was never spent and is the most
// a refund can take back. public.refund_purchase in supabase/paid-tries.sql walks the same ledger the same way.
export function refundPlan(ledger,purchase){
  const rows=[...(ledger||[])].sort(byLedgerOrder);
  const granted=rows.some(r=>r.reason==='purchase'&&r.purchase_id===purchase?.id);
  if(!granted)return {unspent:0,spent:0,runs:[]};
  const queue=[],runs=[];
  for(const row of rows){
    const delta=Number(row.delta)||0;
    if(delta>0){
      const mine=row.reason==='purchase'&&row.purchase_id===purchase.id;
      for(let i=0;i<delta;i++)queue.push(mine);
    }else{
      for(let i=0;i<-delta;i++){
        if(!queue.length)break;
        const mine=queue.shift();
        if(mine&&row.reason==='run'&&row.run_id)runs.push(row.run_id);
      }
    }
  }
  const unspent=queue.filter(Boolean).length;
  return {unspent,spent:Math.max(0,purchase.coins-unspent),runs};
}
export const byLedgerOrder=(a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id));

// Why a refunded run no longer counts. Written into runs.reject_reason, which already keeps a rejected run off
// every board and out of lifetime points.
export const refundedRunReason=reference=>`Refunded purchase ${reference}`;
