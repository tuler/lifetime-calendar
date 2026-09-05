import { useState, type FormEvent } from "react";
import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  LifeTimeLogo,
  LockIcon,
} from "./icons";

interface Links {
  /** `webcal://…` — what the Subscribe button opens. */
  webcal: string;
  /** Same feed over http(s), for apps that want a plain URL. */
  direct: string;
}

interface RegisterResponse extends Partial<Links> {
  error?: string;
}

export function App() {
  const [links, setLinks] = useState<Links | null>(null);

  return (
    <main className="card">
      <LifeTimeLogo />
      {links ? <Ready links={links} /> : <SignUp onDone={setLinks} />}
    </main>
  );
}

function SignUp({ onDone }: { onDone: (links: Links) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }),
      });

      const data = (await res.json()) as RegisterResponse;
      if (!res.ok || !data.webcal || !data.direct) {
        throw new Error(data.error ?? "Something went wrong. Try again.");
      }
      onDone({ webcal: data.webcal, direct: data.direct });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Your classes, on your calendar</h1>
      <p className="lede">Sign in once. New bookings appear on their own.</p>

      <form onSubmit={submit}>
        <label>
          <span>Life Time username or email</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
          />
        </label>

        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            required
          />
        </label>

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Signing in…" : "Create my calendar"}
        </button>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      <p className="fine">
        <LockIcon />
        <span>
          Your password is encrypted before it&rsquo;s saved, and only your link
          can unlock it.
        </span>
      </p>
    </>
  );
}

function Ready({ links }: { links: Links }) {
  // `webcal://` is handed to the OS, which fetches over TLS. A local http dev
  // server can't serve that, so point the button at the plain URL instead.
  const local = links.direct.startsWith("http://");

  return (
    <>
      <span className="mark done" aria-hidden="true">
        <CheckIcon />
      </span>

      <h1>Calendar ready</h1>

      <a className="btn primary" href={local ? links.direct : links.webcal}>
        <CalendarIcon />
        <span>Add to Calendar</span>
      </a>

      <CopyLink url={links.direct} />

      {local && (
        <p className="hint">
          Local dev server, so this opens the address rather than Calendar.
        </p>
      )}

      <details>
        <summary>Add it manually</summary>
        <dl className="steps">
          <dt>iPhone</dt>
          <dd>Settings › Apps › Calendar › Accounts › Add › Other</dd>
          <dt>Mac</dt>
          <dd>Calendar › File › New Calendar Subscription</dd>
          <dt>Google</dt>
          <dd>Other calendars › From URL</dd>
        </dl>
        <code>{links.direct}</code>
      </details>

      <p className="fine">
        <LockIcon />
        <span>Save this link. It can&rsquo;t be shown again.</span>
      </p>
    </>
  );
}

function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2400);
  }

  return (
    <button type="button" className="btn secondary" onClick={copy}>
      {state === "ok" ? <CheckIcon /> : <CopyIcon />}
      <span>
        {state === "ok"
          ? "Copied"
          : state === "fail"
            ? "Copy failed — use the link below"
            : "Copy link"}
      </span>
    </button>
  );
}
