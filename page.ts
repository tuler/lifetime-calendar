export const signupPage: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Life Time calendar subscription</title>
<style>
  :root {
    --ink: #1c2023;
    --muted: #6b7378;
    --rule: #d9dcde;
    --field: #ffffff;
    --bg: #eceeef;
    --go: #17594a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.55 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  }
  main { width: 100%; max-width: 26rem; }
  h1 { font-size: 1.6rem; font-weight: 600; margin: 0 0 .4rem; letter-spacing: -.01em; }
  p.lede { margin: 0 0 1.6rem; color: var(--muted); }
  form { display: grid; gap: 1rem; }
  label { display: grid; gap: .35rem; font-size: .9rem; }
  input {
    font: inherit;
    padding: .6rem .7rem;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: var(--field);
    color: inherit;
  }
  input:focus-visible { outline: 2px solid var(--go); outline-offset: 1px; }
  button {
    font: inherit;
    padding: .65rem 1rem;
    border: 0;
    border-radius: 3px;
    background: var(--go);
    color: #fff;
    cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: progress; }
  .note { font-size: .82rem; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 1rem; }
  #out { display: none; }
  #out.on { display: block; }
  code {
    display: block;
    font: .8rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--field);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: .7rem;
    word-break: break-all;
    margin: .6rem 0 1rem;
  }
  .err { color: #8c2f22; }
</style>
</head>
<body>
<main>
  <h1>Put your Life Time classes on your calendar</h1>
  <p class="lede">Sign in once and you'll get a link your calendar app keeps up to date on its own.</p>

  <form id="f">
    <label>Life Time username or email
      <input name="username" autocomplete="username" required>
    </label>
    <label>Password
      <input name="password" type="password" autocomplete="current-password" required>
    </label>
    <button type="submit">Create my calendar link</button>
    <p id="msg" class="note err" hidden></p>
  </form>

  <section id="out">
    <h1>Your link is ready</h1>
    <p class="lede">On a Mac, open Calendar, choose File &rsaquo; New Calendar Subscription, and paste this in. On iPhone it's Settings &rsaquo; Apps &rsaquo; Calendar &rsaquo; Accounts &rsaquo; Add Account &rsaquo; Other.</p>
    <code id="url"></code>
    <p class="note">Save it somewhere. The link is the only copy of the key that unlocks your stored password, so it can't be shown again — and anyone who has it can see your class schedule.</p>
  </section>

  <p class="note">Your password is encrypted with a key that lives only in your subscription link. It's held here so classes you book later show up without you signing in again.</p>
</main>

<script>
const f = document.getElementById('f');
const msg = document.getElementById('msg');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = f.querySelector('button');
  btn.disabled = true;
  msg.hidden = true;
  try {
    const body = Object.fromEntries(new FormData(f));
    const res = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    f.style.display = 'none';
    document.getElementById('url').textContent = data.webcal;
    document.getElementById('out').classList.add('on');
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
    btn.disabled = false;
  }
});
</script>
</body>
</html>`;
