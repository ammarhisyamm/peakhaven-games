// When to ask for the phone back. A board that fits an 8-column grid into the short side of a phone
// held sideways gives cells around 18px, which is not a game, it is a dexterity test. Rather than a
// second layout for a position nobody chooses on purpose, the game pauses and asks.
//
// Only phone-sized screens qualify: a landscape tablet or a desktop window has the height to play in
// and must never be interrupted.
export const ROTATE_SHORT_SIDE=500;
export function rotateWanted({width,height,inGame,maxShortSide=ROTATE_SHORT_SIDE}={}){
  if(!inGame)return false;
  const w=Number(width)||0,h=Number(height)||0;
  return w>h&&Math.min(w,h)<maxShortSide;
}
