import type { SealedBox } from "./types";

// Credentials are encrypted with a 256-bit key that exists only inside the
// subscription URL the user holds. The Worker never stores the key, so a dump
// of the KV namespace on its own reveals nothing.

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newSecret(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export function newFeedId(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(12)));
}

async function keyFromSecret(secret: string): Promise<CryptoKey> {
  const raw = b64urlDecode(secret);
  if (raw.length !== 32) throw new Error("bad secret length");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(secret: string, obj: unknown): Promise<SealedBox> {
  const key = await keyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return { iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ct)) };
}

export async function unseal<T>(secret: string, box: SealedBox): Promise<T> {
  const key = await keyFromSecret(secret);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(box.iv) },
    key,
    b64urlDecode(box.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
