const styles = `
:root { color-scheme: light dark; --page: #f8f8f7; --surface: #fff; --ink: #1b1c1d; --soft: #5b5d61; --line: #dedfdd; --blue: #345fba; --danger: #c9534d; }
@media (prefers-color-scheme: dark) { :root { --page: #121313; --surface: #1a1b1c; --ink: #ececea; --soft: #a2a4a7; --line: #2d2f31; --blue: #5b86e0; --danger: #e0716b; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: var(--page); color: var(--ink); font: 15px/1.5 'DM Sans', system-ui, sans-serif; }
main { width: min(380px, 100%); padding: 28px 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); text-align: center; }
h1 { margin: 0 0 4px; font-size: 20px; }
p { margin: 0 0 20px; color: var(--soft); }
button { width: 100%; min-height: 44px; border: 0; border-radius: 10px; background: var(--blue); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
button.link { width: auto; min-height: 0; margin-top: 16px; padding: 4px; background: none; color: var(--soft); font-weight: 400; text-decoration: underline; }
input { width: 100%; min-height: 44px; margin-bottom: 10px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; background: transparent; color: var(--ink); font: 600 16px ui-monospace, Menlo, monospace; letter-spacing: .12em; text-align: center; text-transform: uppercase; }
.code { margin: 8px 0 16px; font: 700 44px/1 ui-monospace, Menlo, monospace; letter-spacing: .18em; text-indent: .18em; }
.error { margin-top: 12px; color: var(--danger); }
[hidden] { display: none !important; }
`;

const script = `
const $ = (id) => document.getElementById(id);
const views = ['start', 'waiting', 'token-view'];
const show = (name) => views.forEach((view) => { $(view).hidden = view !== name; });
const say = (text) => { $('error').textContent = text || ''; };
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const enter = () => location.replace('/');
let timer;
const stop = () => clearTimeout(timer);
const reset = (message) => { stop(); sessionStorage.removeItem('webr-pairing'); show('start'); say(message); };

async function poll(request) {
  const response = await post('/api/pair/request/' + request.id + '/poll', { secret: request.secret });
  const { status } = await response.json().catch(() => ({ status: 'expired' }));
  if (status === 'approved') return enter();
  if (status === 'denied') return reset('The request was declined.');
  if (status === 'expired') return reset('The request expired. Try again.');
  timer = setTimeout(() => poll(request).catch(() => { timer = setTimeout(() => poll(request), 3000); }), 1500);
}
function wait(request) { $('code').textContent = request.code; show('waiting'); say(''); stop(); poll(request).catch(() => reset('Could not reach the server.')); }

async function requestAccess() {
  say('');
  const response = await post('/api/pair/request');
  if (response.status === 429) return say('Too many requests. Wait a minute and try again.');
  if (!response.ok) return say('Could not send the request.');
  const request = await response.json();
  sessionStorage.setItem('webr-pairing', JSON.stringify(request));
  wait(request);
}

async function redeem(token) {
  const response = await post('/api/pair/redeem', { token });
  if (response.ok) return enter();
  history.replaceState(null, '', location.pathname);
  show('token-view'); say(response.status === 429 ? 'Too many attempts. Wait a minute.' : 'That code is not valid or has expired.');
}

$('request').onclick = () => requestAccess().catch(() => say('Could not reach the server.'));
$('cancel').onclick = () => reset('');
$('use-token').onclick = () => { say(''); show('token-view'); $('token').focus(); };
$('back').onclick = () => { say(''); show('start'); };
$('token-form').onsubmit = (event) => { event.preventDefault(); redeem($('token').value).catch(() => say('Could not reach the server.')); };

const hashToken = new URLSearchParams(location.hash.slice(1)).get('token');
const saved = (() => { try { return JSON.parse(sessionStorage.getItem('webr-pairing') || 'null'); } catch { return null; } })();
if (hashToken) redeem(hashToken).catch(() => say('Could not reach the server.'));
else if (saved) wait(saved);
`;

const installableAppHead = `<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Webr"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#f8f8f7"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121313">`;

export const pairPage = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex">${installableAppHead}<title>Connect · Webr</title><style>${styles}</style></head>
<body><main>
<h1>Webr</h1>
<div id="start"><p>This device isn’t connected yet.</p><button id="request" type="button">Request access</button><button id="use-token" class="link" type="button">I have a code</button></div>
<div id="waiting" hidden><p>Approve this request in Webr on your computer. Make sure the code matches.</p><div class="code" id="code" aria-live="polite"></div><button id="cancel" class="link" type="button">Cancel</button></div>
<div id="token-view" hidden><p>Enter the code shown in Webr’s settings.</p><form id="token-form"><input id="token" name="token" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required><button type="submit">Connect</button></form><button id="back" class="link" type="button">Back</button></div>
<p class="error" id="error" role="alert"></p>
</main><script>${script}</script></body></html>`;
