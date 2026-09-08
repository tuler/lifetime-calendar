import { useState, type FormEvent } from "react";
import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  LifeTimeLogo,
  LockIcon,
} from "./icons";

interface Feed {
  /** Whose calendar this is — a first name, or "Everyone". */
  name: string;
  /** The member id, or null for the whole-household feed. */
  member: string | null;
  /** `webcal://…` — what the Subscribe button opens. */
  webcal: string;
  /** Same feed over http(s), for apps that want a plain URL. */
  direct: string;
}

interface RegisterResponse {
  feeds?: Feed[];
  error?: string;
}

export function App() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);

  return (
    <main className="card">
      <LifeTimeLogo />
      {feeds ? <Ready feeds={feeds} /> : <SignUp onDone={setFeeds} />}
    </main>
  );
}

function SignUp({ onDone }: { onDone: (feeds: Feed[]) => void }) {
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
      if (!res.ok || !data.feeds?.length) {
        throw new Error(data.error ?? "Something went wrong. Try again.");
      }
      onDone(data.feeds);
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

function Ready({ feeds }: { feeds: Feed[] }) {
  // `webcal://` is handed to the OS, which fetches over TLS. A local http dev
  // server can't serve that, so point the button at the plain URL instead.
  const local = feeds[0].direct.startsWith("http://");
  const href = (f: Feed) => (local ? f.direct : f.webcal);
  const many = feeds.length > 1;

  return (
    <>
      <span className="mark done" aria-hidden="true">
        <CheckIcon />
      </span>

      <h1>{many ? "Calendars ready" : "Calendar ready"}</h1>

      {many && (
        <p className="lede">One for each person on your membership.</p>
      )}

      {feeds.map((feed) => (
        <a
          key={feed.direct}
          // The people are the point; the everyone-feed is the afterthought.
          className={`btn ${feed.member || !many ? "primary" : "secondary"}`}
          href={href(feed)}
        >
          <CalendarIcon />
          <span>{many ? feed.name : "Add to Calendar"}</span>
        </a>
      ))}

      {!many && <CopyLink url={feeds[0].direct} />}

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
        {feeds.map((feed) => (
          <div className="feed" key={feed.direct}>
            {many && <span className="who">{feed.name}</span>}
            <code>{feed.direct}</code>
            <CopyLink url={feed.direct} />
          </div>
        ))}
      </details>

      <p className="fine">
        <LockIcon />
        <span>
          {many
            ? "Save these links. They can’t be shown again."
            : "Save this link. It can’t be shown again."}
        </span>
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
