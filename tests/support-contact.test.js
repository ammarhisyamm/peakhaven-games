// The support address and the copy around it. One constant feeds the help panel, the join and sign-in
// screens and every sign-in error, so these check the constant and the exact words a player is shown.
import test from 'node:test';
import assert from 'node:assert/strict';
const {SUPPORT_EMAIL,SUPPORT_PROMPT,SUPPORT_STUCK,withSupport,signInError,linkErrorMessage,supportLine}
  =await import('../arcade/ui/support.js');

test('The address lives in one constant, and the two lines are built from it',()=>{
  assert.equal(SUPPORT_EMAIL,'support@peakhaven.com.au');
  assert.equal(SUPPORT_PROMPT,'Need help? support@peakhaven.com.au');
  assert.equal(SUPPORT_STUCK,'Still stuck? Email support@peakhaven.com.au');
  // Nothing may hard-code it: both lines have to come from the constant.
  assert.ok(SUPPORT_PROMPT.endsWith(SUPPORT_EMAIL));
  assert.ok(SUPPORT_STUCK.endsWith(SUPPORT_EMAIL));
});

test('An error ends by saying where to go next, exactly once',()=>{
  assert.equal(withSupport('That did not work.'),
    'That did not work. Still stuck? Email support@peakhaven.com.au');
  // A message without its own full stop gets one, so the two sentences do not run together.
  assert.equal(withSupport('That did not work'),
    'That did not work. Still stuck? Email support@peakhaven.com.au');
  assert.equal(withSupport('Really?'),'Really? Still stuck? Email support@peakhaven.com.au');
  // Added once: a wrapper and a caller cannot both append it.
  assert.equal(withSupport(withSupport('Twice over.')),withSupport('Twice over.'));
  assert.equal((withSupport(withSupport('Twice over.')).match(/support@/g)||[]).length,1);
  // Nothing at all becomes the line on its own, not a stray full stop.
  assert.equal(withSupport(''),SUPPORT_STUCK);
  assert.equal(withSupport(null),SUPPORT_STUCK);
  assert.equal(withSupport('   '),SUPPORT_STUCK);
});

test('Every sign-in failure a player can hit ends with the support line',()=>{
  // The three Supabase cases account.js maps, by the messages Supabase actually sends.
  assert.equal(signInError('Signups not allowed for otp'),
    'No account uses that email yet. Join with your invite code. Still stuck? Email support@peakhaven.com.au');
  assert.equal(signInError('User not found'),
    'No account uses that email yet. Join with your invite code. Still stuck? Email support@peakhaven.com.au');
  assert.equal(signInError('otp_disabled'),
    'No account uses that email yet. Join with your invite code. Still stuck? Email support@peakhaven.com.au');
  assert.equal(signInError('For security purposes, you can only request this after 48 seconds.'),
    'Please wait a minute before asking for another link. Still stuck? Email support@peakhaven.com.au');
  assert.equal(signInError('email rate limit exceeded'),
    'Please wait a minute before asking for another link. Still stuck? Email support@peakhaven.com.au');
  // Anything unrecognised is still passed through, and still says where to go.
  assert.equal(signInError('Something nobody has seen before'),
    'Something nobody has seen before. Still stuck? Email support@peakhaven.com.au');
  assert.equal(signInError(''),'Sign-in did not work. Still stuck? Email support@peakhaven.com.au');
  assert.equal(signInError(undefined),'Sign-in did not work. Still stuck? Email support@peakhaven.com.au');
});

test('A sign-in link that did not work says so, and where to go',()=>{
  assert.equal(linkErrorMessage('Email link is invalid or has expired'),
    'That sign-in link has expired. Ask for a new one below. Still stuck? Email support@peakhaven.com.au');
  assert.equal(linkErrorMessage('Token has expired or is invalid'),
    'That sign-in link has expired. Ask for a new one below. Still stuck? Email support@peakhaven.com.au');
  assert.equal(linkErrorMessage('access_denied'),
    'access_denied. Still stuck? Email support@peakhaven.com.au');
  assert.equal(linkErrorMessage(''),
    'That sign-in link did not work. Still stuck? Email support@peakhaven.com.au');
});

test('The line shown on screen is selectable text, a mailto link and a Copy button',()=>{
  const html=supportLine();
  assert.match(html,/Need help\?/);
  assert.match(html,/href="mailto:support@peakhaven\.com\.au"/,'a mailto: link');
  assert.match(html,/>support@peakhaven\.com\.au</,'and the address as text that can be selected');
  assert.match(html,/data-support-copy/,'and a Copy button for it');
  assert.match(html,/aria-label="Copy the support email address"/,'which says what it does');
  // An extra class is for placing it, and must not disturb the rest.
  assert.match(supportLine('join-support'),/class="support-line join-support"/);
  assert.match(supportLine(),/class="support-line"/);
});

test('The address appears nowhere in the interface except through this module',async()=>{
  const {readdir,readFile}=await import('node:fs/promises');
  const {join}=await import('node:path');
  const root=new URL('../arcade/ui/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
  const offenders=[];
  const walk=async dir=>{
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const path=join(dir,entry.name);
      if(entry.isDirectory()){await walk(path);continue;}
      if(!/\.(?:js|html|css)$/.test(entry.name)||entry.name==='support.js')continue;
      if((await readFile(path,'utf8')).includes('peakhaven.com.au'))offenders.push(entry.name);
    }
  };
  await walk(root);
  assert.deepEqual(offenders,[],'every use has to come from the constant in support.js');
});
