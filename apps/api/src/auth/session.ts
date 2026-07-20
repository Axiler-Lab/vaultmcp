import { and, eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { db } from "../db/client.js";
import { users, webSessions } from "../db/schema.js";
import { env } from "../config.js";
import { randomToken, sha256 } from "../util/crypto.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  githubId: string;
  githubLogin: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  defaultWorkspaceId: string | null;
  totpEnabled: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      accessTokenScope?: string | null;
      /** Present for personal access tokens (`vmcp_…`); OAuth leaves this undefined. */
      patScopes?: string[];
      /** Web session passed MFA (or user has MFA off). */
      mfaSatisfied?: boolean;
      sessionToken?: string;
    }
  }
}

export async function createWebSession(
  userId: string,
  opts: { mfaSatisfied: boolean },
): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(webSessions).values({
    sessionTokenHash: sha256(token),
    userId,
    mfaSatisfied: opts.mfaSatisfied,
    expiresAt,
  });
  return token;
}

export async function destroyWebSession(token: string): Promise<void> {
  await db.delete(webSessions).where(eq(webSessions.sessionTokenHash, sha256(token)));
}

export async function markSessionMfaSatisfied(token: string): Promise<void> {
  await db
    .update(webSessions)
    .set({ mfaSatisfied: true })
    .where(eq(webSessions.sessionTokenHash, sha256(token)));
}

export function setSessionCookie(res: Response, token: string): void {
  const crossSite = isCrossSiteWebOrigin();
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // Cross-site (e.g. Vercel UI → API host) requires Secure + SameSite=None
    secure: crossSite ? true : env.COOKIE_SECURE,
    sameSite: crossSite ? "none" : "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  const crossSite = isCrossSiteWebOrigin();
  res.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: crossSite ? true : env.COOKIE_SECURE,
    sameSite: crossSite ? "none" : "lax",
    path: "/",
  });
}

/** True when the browser UI origin differs from the API public origin. */
function isCrossSiteWebOrigin(): boolean {
  try {
    return new URL(env.WEB_ORIGIN).origin !== new URL(env.PUBLIC_URL).origin;
  } catch {
    return false;
  }
}

function toAuthUser(u: typeof users.$inferSelect): AuthUser {
  return {
    id: u.id,
    githubId: u.githubId,
    githubLogin: u.githubLogin,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    defaultWorkspaceId: u.defaultWorkspaceId,
    totpEnabled: u.totpEnabled,
  };
}

async function loadSession(
  token: string,
): Promise<{ user: AuthUser; mfaSatisfied: boolean } | null> {
  const hash = sha256(token);
  const rows = await db
    .select({
      sessionExpires: webSessions.expiresAt,
      mfaSatisfied: webSessions.mfaSatisfied,
      user: users,
    })
    .from(webSessions)
    .innerJoin(users, eq(users.id, webSessions.userId))
    .where(eq(webSessions.sessionTokenHash, hash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.sessionExpires.getTime() < Date.now()) {
    await db.delete(webSessions).where(eq(webSessions.sessionTokenHash, hash));
    return null;
  }
  return { user: toAuthUser(row.user), mfaSatisfied: row.mfaSatisfied };
}

/** Attach user if cookie present; does not enforce MFA. */
export async function optionalWebAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    const session = await loadSession(token);
    if (session) {
      req.user = session.user;
      req.mfaSatisfied = session.mfaSatisfied;
      req.sessionToken = token;
    }
  }
  next();
}

/**
 * Dashboard / API auth. Cookie required.
 * If MFA is enabled and not yet satisfied → 401 { error: "mfa_required" }.
 */
export async function requireWebAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const session = await loadSession(token);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = session.user;
  req.mfaSatisfied = session.mfaSatisfied;
  req.sessionToken = token;
  if (session.user.totpEnabled && !session.mfaSatisfied) {
    res.status(401).json({ error: "mfa_required" });
    return;
  }
  next();
}

/**
 * Like requireWebAuth but allows MFA-pending sessions (for /me and MFA verify/setup).
 */
export async function requireWebSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const session = await loadSession(token);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = session.user;
  req.mfaSatisfied = session.mfaSatisfied;
  req.sessionToken = token;
  next();
}

export async function upsertGithubUser(profile: {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}): Promise<AuthUser> {
  const githubId = String(profile.id);
  const existing = await db.select().from(users).where(eq(users.githubId, githubId)).limit(1);
  if (existing[0]) {
    const [updated] = await db
      .update(users)
      .set({
        githubLogin: profile.login.toLowerCase(),
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatar_url,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id))
      .returning();
    return toAuthUser(updated!);
  }

  const [created] = await db
    .insert(users)
    .values({
      githubId,
      githubLogin: profile.login.toLowerCase(),
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatar_url,
    })
    .returning();

  return toAuthUser(created!);
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const u = rows[0];
  if (!u) return null;
  return toAuthUser(u);
}

export async function setDefaultWorkspace(userId: string, workspaceId: string | null) {
  await db
    .update(users)
    .set({ defaultWorkspaceId: workspaceId, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export { and, eq };
