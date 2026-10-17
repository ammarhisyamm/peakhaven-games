// Where a player goes when something has gone wrong.
//
// The address lives here and nowhere else: the arcade's help panel, the bottom of the join and sign-in
// screens and every sign-in error all read it from this one constant, so changing it changes all of them.
//
// Nothing here touches the DOM or imports anything, so the copy can be tested on its own.

export const SUPPORT_EMAIL = 'support@peakhaven.com.au';
export const SUPPORT_PROMPT = `Need help? ${SUPPORT_EMAIL}`;
export const SUPPORT_STUCK = `Still stuck? Email ${SUPPORT_EMAIL}`;

// An error with the line that says where to go next. Added once and only once: a message that already
// carries the address is left exactly as it is, so a wrapper and a caller cannot both append it. An empty
// message becomes the line on its own rather than a stray full stop.
export function withSupport(message) {
  const text = String(message ?? '').trim();
  if (!text) return SUPPORT_STUCK;
  if (text.includes(SUPPORT_EMAIL)) return text;
  return `${/[.!?]$/.test(text) ? text : `${text}.`} ${SUPPORT_STUCK}`;
}

// What a sign-in failure is shown as. Supabase's own wording is turned into something a player can act on,
// and every one of them ends by saying where to go if it did not help.
export function signInError(raw) {
  const message = String(raw ?? '');
  if (/signups not allowed|not found|otp_disabled/i.test(message)) {
    return withSupport('No account uses that email yet. Join with your invite code.');
  }
  if (/rate|seconds/i.test(message)) {
    return withSupport('Please wait a minute before asking for another link.');
  }
  return withSupport(message || 'Sign-in did not work.');
}

// A sign-in link that did not work, as the redirect hands it back.
export function linkErrorMessage(raw) {
  const message = String(raw ?? '');
  return withSupport(/expired|invalid/i.test(message)
    ? 'That sign-in link has expired. Ask for a new one below.'
    : message || 'That sign-in link did not work.');
}

// The address as selectable text, a mailto: link and a Copy button, for dropping into a panel.
export function supportLine(className = '') {
  return `<p class="support-line${className ? ` ${className}` : ''}">Need help? ` +
    `<a class="support-mail" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>` +
    `<button type="button" class="support-copy" data-support-copy aria-label="Copy the support email address">Copy</button></p>`;
}

// Wires every Copy button the markup above drew inside `root`. In a window that does not have focus the
// clipboard promise can hang, so it is raced against a short timer and falls back to a hidden textarea
// rather than leaving the button looking dead — the same thing the admin page does with winner emails.
export function bindSupport(root, say = () => {}) {
  root.querySelectorAll('[data-support-copy]').forEach(button => {
    button.onclick = async () => {
      const wrote = await Promise.race([
        Promise.resolve(navigator.clipboard?.writeText(SUPPORT_EMAIL)).then(() => true, () => false),
        new Promise(resolve => setTimeout(() => resolve(false), 1200)),
      ]);
      if (!wrote) {
        const box = document.createElement('textarea');
        box.value = SUPPORT_EMAIL;
        box.setAttribute('readonly', '');
        box.style.position = 'fixed';
        box.style.opacity = '0';
        document.body.append(box);
        box.select();
        try { document.execCommand('copy'); } catch {}
        box.remove();
      }
      const was = button.textContent;
      button.textContent = 'Copied';
      say(`${SUPPORT_EMAIL} copied.`);
      setTimeout(() => { if (button.isConnected) button.textContent = was; }, 1500);
    };
  });
}
