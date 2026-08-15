import { lookup } from "node:dns/promises";
import {
  isBlockedUpstreamHost,
  isMetadataOrLinkLocalIp,
  isPrivateOrLoopbackIp,
} from "@vaultmcp/shared";
import { HttpError } from "../services/workspaces.js";

/** Hosted (Vercel) forbids RFC1918/loopback; self-host still blocks link-local/metadata. */
export async function assertSafeUpstreamUrl(urlStr: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new HttpError(400, "invalid upstream url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new HttpError(400, "upstream url must be http or https");
  }
  if (isBlockedUpstreamHost(u.hostname)) {
    throw new HttpError(400, "upstream url host is not allowed");
  }
  let address: string;
  try {
    const res = await lookup(u.hostname);
    address = res.address;
  } catch {
    throw new HttpError(400, "upstream url host could not be resolved");
  }
  if (isMetadataOrLinkLocalIp(address)) {
    throw new HttpError(400, "upstream url resolves to a link-local address");
  }
  if (process.env.VERCEL && isPrivateOrLoopbackIp(address)) {
    throw new HttpError(400, "upstream url resolves to a private address");
  }
}
