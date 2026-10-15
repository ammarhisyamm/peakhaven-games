// Bottle skins and the lifetime points that unlock them. Shared by the arcade page and the competition API.
export const BOTTLE_SKINS=Object.freeze([
  {id:'ph-original',name:'PH Original',tier:'Starter',color:'#007cff',points:0},
  {id:'sky-molecule',name:'Sky Molecule',tier:'Common',color:'#00d8e9',points:500},
  {id:'ice-flow',name:'Ice Flow',tier:'Uncommon',color:'#e4f4ff',points:2500},
  {id:'deep-hex',name:'Deep Hex',tier:'Rare',color:'#123766',points:7500},
  {id:'violet-bloom',name:'Violet Bloom',tier:'Epic',color:'#a631e8',points:15000},
  // Golden Peak also unlocks for anyone who finishes a month in the top three.
  {id:'golden-peak',name:'Golden Peak',tier:'Legendary',color:'#efb62c',points:30000,podium:true},
]);

// Lifetime points earned by one finished game: a tenth of the score, at least 10 and at most 250.
export const pointsForGame=score=>Math.min(250,Math.max(10,Math.floor((Number(score)||0)/10)));

export function bottleUnlocked(id,{points=0,podium=false}={}){
  const skin=BOTTLE_SKINS.find(b=>b.id===id);
  return Boolean(skin&&(points>=skin.points||(skin.podium&&podium)));
}
