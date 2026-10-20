// Which browsers may have the standalone manifest.
//
// The arcade ships `manifest.webmanifest` with `display:"browser"` and only swaps in the standalone
// one for browsers that are safe to install. That order matters: if this script never runs, everybody
// keeps the harmless manifest rather than everybody getting the broken one.
//
// Why iOS is excluded. Sign-in is a Supabase magic link. A link opened from Mail on iOS goes to
// Safari, and a standalone Home Screen web app does not share Safari's storage, so an installed
// player would be signed in in Safari and still signed out in the app, with no way across. Until
// sign-in can be completed inside the app - an emailed code rather than a link - iOS must not be
// offered a standalone install.
//
// `apple-mobile-web-app-capable` is NOT the switch. It has been optional since iOS 11.3: from that
// version Safari honours the manifest's own `display` field for Home Screen installs, so shipping
// `display:"standalone"` to an iPhone is enough to create the broken state on its own.

// iPadOS reports itself as a Mac, so the touch count is what separates an iPad from a desktop Safari.
export function isApple({userAgent='',maxTouchPoints=0,platform=''}={}){
  const ua=String(userAgent);
  if(/iPhone|iPad|iPod/i.test(ua))return true;
  if(/iPhone|iPad|iPod/i.test(String(platform)))return true;
  // iPadOS 13+ in desktop mode: "Macintosh ... Mac OS X" with a touch screen.
  return /Macintosh|Mac OS X/i.test(ua)&&Number(maxTouchPoints)>1;
}

// Android Chrome, desktop Chrome and anything else that is not Apple may have the standalone
// manifest. Anything we cannot identify keeps the browser manifest: unknown is not a licence.
export function wantsStandaloneManifest(env={}){
  return !isApple(env);
}

export const STANDALONE_MANIFEST='manifest-app.webmanifest';

// Swap the link, if and only if this browser may have it.
export function applyStandaloneManifest(doc=globalThis.document,nav=globalThis.navigator){
  if(!doc||!nav)return false;
  if(!wantsStandaloneManifest({userAgent:nav.userAgent,maxTouchPoints:nav.maxTouchPoints,platform:nav.platform}))return false;
  const link=doc.querySelector('link[rel="manifest"]');
  if(!link)return false;
  link.href=STANDALONE_MANIFEST;
  return true;
}
