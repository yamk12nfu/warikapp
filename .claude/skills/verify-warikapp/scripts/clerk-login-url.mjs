#!/usr/bin/env node
// Prints a one-shot login URL for the dedicated verification user on the Clerk DEV instance.
// The user is synthetic (no email, external_id only) and idempotently created on first use.
// Usage: node .claude/skills/verify-warikapp/scripts/clerk-login-url.mjs [app-origin]   (default http://localhost:3100)
import { readFileSync } from "node:fs";

const origin = process.argv[2] ?? "http://localhost:3100";
const externalId = process.env.WARIKAPP_VERIFY_EXTERNAL_ID ?? "warikapp-verify-agent";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const key = env.CLERK_SECRET_KEY;
if (!key?.startsWith("sk_test_")) {
  console.error("CLERK_SECRET_KEY in .env.local must be a dev (sk_test_) key; refusing to touch a production instance.");
  process.exit(2);
}
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
};

// The dev instance only enables Google OAuth (no email attribute), so the synthetic user carries
// no email at all: it is addressed by external_id and can only sign in through a sign-in token.
const found = await api(`/users?external_id=${encodeURIComponent(externalId)}&limit=1`);
let user = found[0];
if (!user) {
  user = await api("/users", {
    method: "POST",
    // A sign-in token needs at least one identification on the user; username is the only kind this instance accepts.
    body: JSON.stringify({ external_id: externalId, username: externalId.replace(/-/g, "_"), first_name: "Verify", last_name: "Agent" }),
  });
  console.error(`created verification user ${user.id}`);
}
const token = await api("/sign_in_tokens", {
  method: "POST",
  body: JSON.stringify({ user_id: user.id, expires_in_seconds: 300 }),
});
console.log(`${origin}/login?__clerk_ticket=${token.token}`);
