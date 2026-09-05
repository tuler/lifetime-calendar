// End-to-end diagnostic for the Life Time login + reservations calls.
// Credentials are read from the environment and never printed.
//
//   LT_USER='you@example.com' LT_PASS='...' node scripts/probe-login.mjs
//
// Token values are redacted, so the output is safe to paste.
// Delete this file once the feed is confirmed working.

const ROOT = "https://api.lifetimefitness.com/";
const KEY = "924c03ce573d473793e184219a6a19bd";

const username = process.env.LT_USER;
const password = process.env.LT_PASS;
if (!username || !password) {
  console.error("Set LT_USER and LT_PASS in the environment.");
  process.exit(1);
}

const redact = (v) =>
  typeof v === "string" && v.length > 12 ? `<${v.length} chars>` : v;

// --- 1. login -------------------------------------------------------------
console.log("\n### POST auth/v2/login");
const loginRes = await fetch(`${ROOT}auth/v2/login`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=UTF-8",
    Accept: "application/json",
    "Ocp-Apim-Subscription-Key": KEY,
  },
  body: JSON.stringify({ username, password }),
});
const loginText = await loginRes.text();
console.log(`  HTTP ${loginRes.status}`);

let login;
try {
  login = JSON.parse(loginText);
} catch {
  console.log("  non-JSON:", loginText.slice(0, 300));
  process.exit(1);
}

for (const [k, v] of Object.entries(login)) {
  console.log(`  ${k}: ${k === "token" || k === "ssoId" ? redact(v) : v}`);
}

const token = login.token;
const sso = login.ssoId ?? login.ssoid;
if (!token || !sso) {
  console.log("\n  No token/ssoId — login did not succeed. Stopping.");
  process.exit(1);
}
console.log("  ✓ login OK");

// --- 2. profile (for memberId) -------------------------------------------
console.log("\n### GET user-profile/api");
const profRes = await fetch(`${ROOT}user-profile/api`, {
  headers: {
    Accept: "application/json",
    "Ocp-Apim-Subscription-Key": KEY,
    "X-LTF-CT": token,
  },
});
console.log(`  HTTP ${profRes.status}`);
let memberId = null;
if (profRes.ok) {
  const prof = await profRes.json().catch(() => null);
  if (prof) {
    memberId = prof.memberId ?? null;
    console.log("  top-level keys:", Object.keys(prof).join(", "));
    console.log("  memberId:", memberId, " partyId:", prof.partyId ?? "(none)");
  }
} else {
  console.log("  (non-fatal — the feed just won't scope by member)");
}

// --- 3. reservations ------------------------------------------------------
const us = (d) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(
    d.getUTCDate()
  ).padStart(2, "0")}/${d.getUTCFullYear()}`;
const now = new Date();
const params = new URLSearchParams({
  start: us(now),
  end: us(new Date(now.getTime() + 270 * 86400000)),
  pageSize: "0",
});
if (memberId != null) params.set("memberIds", String(memberId));

console.log(`\n### GET ux/web-schedules/v3/reservations?${params}`);
const resvRes = await fetch(
  `${ROOT}ux/web-schedules/v3/reservations?${params}`,
  {
    headers: {
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": KEY,
      "X-LTF-SSOID": sso,
      "X-LTF-CT": token,
    },
  }
);
const resvText = await resvRes.text();
console.log(`  HTTP ${resvRes.status}`);
if (!resvRes.ok) {
  console.log("  body:", resvText.slice(0, 400));
  process.exit(1);
}

const data = JSON.parse(resvText);
console.log("  top-level keys:", Object.keys(data).join(", "));
const results = data.results ?? [];
console.log(`  results: ${results.length}`);
if (results.length) {
  console.log("\n  --- FIELD NAMES on the first reservation ---");
  console.log("  " + Object.keys(results[0]).join(", "));
  console.log(
    "\n  --- first reservation, verbatim (check for anything personal " +
      "before pasting) ---"
  );
  console.log(JSON.stringify(results[0], null, 2));
} else {
  console.log("  (no upcoming reservations — book one to see the shape)");
}
