import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import {
  beginTotpSetup,
  checkTotpForUser,
  confirmTotpSetup,
  disableTotp,
  getUserMfaState,
} from "../services/mfa.js";
import { HttpError } from "../services/workspaces.js";
import {
  clearSessionCookie,
  createWebSession,
  destroyWebSession,
  markSessionMfaSatisfied,
  requireWebAuth,
  requireWebSession,
  setSessionCookie,
  upsertGithubUser,
} from "./session.js";

export const authRouter = Router();

function signOauthState(returnTo: string): string {
  const payload = Buffer.from(
    JSON.stringify({ r: returnTo, e: Date.now() + 10 * 60 * 1000 }),
  ).toString("base64url");
  const sig = createHmac("sha256", env.VAULT_MASTER_KEY).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function readOauthState(state: string): string | null {
  const i = state.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expected = createHmac("sha256", env.VAULT_MASTER_KEY).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      r?: string;
      e?: number;
    };
    if (typeof data.r !== "string" || typeof data.e !== "number" || data.e < Date.now()) {
      return null;
    }
    return data.r;
  } catch {
    return null;
  }
}

authRouter.get("/github", async (req, res) => {
  const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
  const state = signOauthState(returnTo);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${env.PUBLIC_URL}/auth/github/callback`,
    scope: "read:user user:email",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRouter.get("/github/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (!code || !state) {
    res.status(400).send("Missing code or state");
    return;
  }
  const returnTo = readOauthState(state);
  if (!returnTo) {
    res.status(400).send("Invalid or expired state");
    return;
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.PUBLIC_URL}/auth/github/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    res.status(400).send(`GitHub token error: ${tokenJson.error ?? "unknown"}`);
    return;
  }

  const profileRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "vaultmcp",
    },
  });
  if (!profileRes.ok) {
    res.status(502).send("Failed to fetch GitHub profile");
    return;
  }
  const profile = (await profileRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };

  if (!profile.email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "vaultmcp",
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (primary) profile.email = primary.email;
    }
  }

  const user = await upsertGithubUser(profile);
  const sessionToken = await createWebSession(user.id, {
    mfaSatisfied: !user.totpEnabled,
  });
  setSessionCookie(res, sessionToken);

  const destBase = returnTo.startsWith("http") ? returnTo : `${env.WEB_ORIGIN}${returnTo}`;
  const dest =
    user.totpEnabled && !destBase.includes("mfa=1")
      ? `${env.WEB_ORIGIN}/?mfa=1`
      : destBase;
  res.redirect(dest);
});

authRouter.post("/logout", requireWebSession, async (req, res) => {
  if (req.sessionToken) {
    await destroyWebSession(req.sessionToken);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireWebSession, (req, res) => {
  const mfaRequired = Boolean(req.user!.totpEnabled && !req.mfaSatisfied);
  res.json({
    user: req.user,
    mfaRequired,
    mfaSatisfied: Boolean(req.mfaSatisfied),
  });
});

const CodeBody = z.object({
  code: z.string().min(6).max(12),
});

authRouter.get("/mfa", requireWebSession, async (req, res) => {
  const state = await getUserMfaState(req.user!.id);
  res.json({
    enabled: Boolean(state?.totpEnabled),
    mfaSatisfied: Boolean(req.mfaSatisfied),
  });
});

authRouter.post("/mfa/setup", requireWebAuth, async (req, res) => {
  try {
    const setup = await beginTotpSetup(req.user!.id, req.user!.githubLogin);
    res.json(setup);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

authRouter.post("/mfa/confirm", requireWebAuth, async (req, res) => {
  const parsed = CodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid code" });
    return;
  }
  try {
    await confirmTotpSetup(req.user!.id, parsed.data.code);
    if (req.sessionToken) await markSessionMfaSatisfied(req.sessionToken);
    res.json({ ok: true, enabled: true });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

authRouter.post("/mfa/verify", requireWebSession, async (req, res) => {
  const parsed = CodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid code" });
    return;
  }
  if (!req.user!.totpEnabled) {
    res.status(400).json({ error: "mfa not enabled" });
    return;
  }
  if (req.mfaSatisfied) {
    res.json({ ok: true });
    return;
  }
  const ok = await checkTotpForUser(req.user!.id, parsed.data.code);
  if (!ok) {
    res.status(401).json({ error: "invalid code" });
    return;
  }
  if (req.sessionToken) await markSessionMfaSatisfied(req.sessionToken);
  res.json({ ok: true });
});

authRouter.post("/mfa/disable", requireWebAuth, async (req, res) => {
  const parsed = CodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid code" });
    return;
  }
  try {
    await disableTotp(req.user!.id, parsed.data.code);
    res.json({ ok: true, enabled: false });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});
