import { describe, it, expect } from "vitest";
import { seal, unseal, newSecret, newFeedId } from "../src/crypto";
import type { Credentials } from "../src/types";

const creds: Credentials = { username: "someone", password: "hunter2" };

describe("seal/unseal", () => {
  it("round-trips credentials", async () => {
    const secret = newSecret();
    const out = await unseal<Credentials>(secret, await seal(secret, creds));
    expect(out).toEqual(creds);
  });

  it("fails with the wrong secret", async () => {
    const box = await seal(newSecret(), creds);
    await expect(unseal(newSecret(), box)).rejects.toThrow();
  });

  it("uses a fresh IV each time", async () => {
    const secret = newSecret();
    const a = await seal(secret, creds);
    const b = await seal(secret, creds);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("generates ids and secrets of the expected size", () => {
    expect(newSecret()).toHaveLength(43);
    expect(newFeedId()).toHaveLength(16);
  });
});
