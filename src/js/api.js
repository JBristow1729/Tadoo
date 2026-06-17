import { getLocalClientId, setLocalClientId } from "./storage.js";

const endpoint = "/.netlify/functions/tadoo-profile";

export async function fetchRemoteProfile() {
  const body = await requestProfile(`${endpoint}?action=profile`);
  return body.profile ?? null;
}

export async function syncRemoteChores(chores) {
  const body = await requestProfile(`${endpoint}?action=chores`, {
    method: "PATCH",
    body: JSON.stringify({ chores })
  });
  return body.profile;
}

export async function restoreWholegrainProfile(restoreToken) {
  const body = await requestProfile(`${endpoint}?action=restore-wholegrain-profile`, {
    method: "POST",
    body: JSON.stringify({ restoreToken })
  });
  if (body.profile?.id) setLocalClientId(body.profile.id);
  return body.profile;
}

export async function requestProfile(url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-tadoo-client-id", getLocalClientId());
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Tadoo sync is unavailable.");
  }
  return response.json();
}

export function buildWholegrainLinkUrl() {
  const base = window.TADOO_CONFIG?.wholegrainAccountsUrl ?? "https://wholegrainstudios.co.uk/accounts/link";
  const url = new URL(base);
  url.searchParams.set("game", "tadoo");
  url.searchParams.set("gameName", "Tadoo");
  url.searchParams.set("gameAccountId", getLocalClientId());
  url.searchParams.set("returnTo", window.location.href);
  return url.toString();
}
