// Gate checkpoints are live course state, never a time-based difficulty change.
// Version 6 has one optional rescue and a round player with a matching circular hitbox.
export const RIDGE_LATEST=6;
export const RIDGE_REGIONS=Object.freeze([
 {name:'Blue Ridge',hue:211,top:'#082647',bottom:'#125a87'},
 {name:'Violet Ridge',hue:263,top:'#251343',bottom:'#65418a'},
 {name:'Emerald Ridge',hue:172,top:'#073b3b',bottom:'#167c78'},
 {name:'Amber Ridge',hue:36,top:'#43301c',bottom:'#9b713b'},
 {name:'Rose Ridge',hue:330,top:'#411a3b',bottom:'#924c75'},
 {name:'Indigo Ridge',hue:240,top:'#191c48',bottom:'#495b9b'}
]);
export function ridgeCheckpoint(gates){
 const stage=Math.floor(Math.max(0,Number(gates)||0)/50),region=RIDGE_REGIONS[stage%RIDGE_REGIONS.length];
 return {...region,stage,from:stage*50,next:(stage+1)*50,speedFactor:1+Math.min(stage,6)*.12,gapReduction:Math.min(stage,6)*8};
}
