export const ORBIT_GRAVITY=820;
export function orbitVelocity(pull,distance){
  const y=Math.max(0,Math.min(160,pull.y)),x=Math.max(-140,Math.min(140,pull.x));
  return {vx:x===0?0:-x*3.8,vy:-Math.sqrt(2*ORBIT_GRAVITY*Math.max(100,distance))*1.08*(.72+y/280)};
}
// A hoop counts only once the ball has risen above it and crosses downward.
export function crossesHoop(previous,ball,hoop,radius=18){
  if(ball.vy<=0||previous.y>=hoop.y||ball.y<hoop.y)return false;
  const fraction=(hoop.y-previous.y)/(ball.y-previous.y),x=previous.x+(ball.x-previous.x)*fraction;
  return Math.abs(x-hoop.x)<hoop.radius-radius*.45;
}
