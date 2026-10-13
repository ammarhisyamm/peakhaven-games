// Seeded randomness and a fixed simulation step, so a run can be replayed exactly from its seed and inputs.
export const SIM_STEP=1/120, MAX_STEPS_PER_FRAME=12;
export function makeSeed(){try{return crypto.getRandomValues(new Uint32Array(1))[0];}catch{return Math.floor(Math.random()*4294967296)>>>0;}}
// mulberry32. The whole generator state is one 32-bit number, so it can live inside saved or undoable game state.
export function nextRandom(holder,key='rng'){let a=(holder[key]+0x6D2B79F5)>>>0;holder[key]=a;let t=Math.imul(a^(a>>>15),a|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}
export function createRandom(seed){const holder={rng:seed>>>0};const rand=()=>nextRandom(holder);rand.state=()=>holder.rng;return rand;}
