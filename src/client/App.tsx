import { useState, type FormEvent } from "react";

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
    <main className="wrap">
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
      <h1>Put your Life Time classes on your calendar</h1>
      <p className="lede">
        Sign in once and you&rsquo;ll get a calendar that keeps itself up to
        date.
      </p>

      <form onSubmit={submit} noValidate={false}>
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
        Your password is encrypted with a key that exists only inside your
        calendar link. It is kept so classes you book later appear without you
        signing in again.
      </p>
    </>
  );
}

function Ready({ links }: { links: Links }) {
  // `webcal://` is handed to the OS, which fetches over TLS. A local http dev
  // server can't serve that, so point the button at the plain URL instead.
  const local = links.direct.startsWith("http://");
  const subscribeHref = local ? links.direct : links.webcal;

  return (
    <>
      <h1>Your calendar is ready</h1>
      <p className="lede">
        Subscribe once. New bookings show up on their own.
      </p>

      <a className="btn primary" href={subscribeHref}>
        Add to Calendar
      </a>

      <CopyLink url={links.direct} />

      {local && (
        <p className="fine note">
          You&rsquo;re on a local dev server, so the button opens the plain
          address rather than handing it to Calendar. Deployed over https it
          subscribes directly.
        </p>
      )}

      <details>
        <summary>Add it by hand instead</summary>
        <div className="details-body">
          <p className="fine">
            <strong>iPhone or iPad:</strong> Settings &rsaquo; Apps &rsaquo;
            Calendar &rsaquo; Accounts &rsaquo; Add Account &rsaquo; Other
            &rsaquo; Add Subscribed Calendar.
          </p>
          <p className="fine">
            <strong>Mac:</strong> Calendar &rsaquo; File &rsaquo; New Calendar
            Subscription.
          </p>
          <p className="fine">
            <strong>Google Calendar:</strong> Other calendars &rsaquo; From URL.
          </p>
          <code>{links.direct}</code>
        </div>
      </details>

      <p className="fine">
        Save this link somewhere. It is the only copy of the key that unlocks
        your stored password, so it cannot be shown again, and anyone holding it
        can see your class schedule.
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
      {state === "ok"
        ? "Link copied"
        : state === "fail"
          ? "Press and hold the link below to copy"
          : "Copy link"}
    </button>
  );
}
