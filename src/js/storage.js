const choresKey = "tadoo-chores";
const themeKey = "tadoo-theme";
const linkedAccountKey = "tadoo-linked-account";
const localClientIdKey = "tadoo-client-id";
const localClientCookieName = "tadoo_client_id";
const localClientIdMaxAgeSeconds = 60 * 60 * 24 * 730;

export function readChores() {
  try {
    const value = localStorage.getItem(choresKey);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeChores(chores) {
  localStorage.setItem(choresKey, JSON.stringify(chores));
}

export function readTheme() {
  return localStorage.getItem(themeKey) === "light" ? "light" : "dark";
}

export function writeTheme(theme) {
  localStorage.setItem(themeKey, theme);
}

export function readLinkedAccount() {
  try {
    const value = localStorage.getItem(linkedAccountKey);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeLinkedAccount(profile) {
  if (!profile?.identityId) {
    localStorage.removeItem(linkedAccountKey);
    return;
  }
  localStorage.setItem(linkedAccountKey, JSON.stringify({
    identityId: profile.identityId,
    email: profile.identityEmail || profile.email || ""
  }));
}

export function getLocalClientId() {
  const current = localStorage.getItem(localClientIdKey);
  if (current) {
    writeLocalClientCookie(current);
    return current;
  }
  const cookieId = readLocalClientCookie();
  if (cookieId) {
    localStorage.setItem(localClientIdKey, cookieId);
    return cookieId;
  }
  const next = `local-${crypto.randomUUID()}`;
  setLocalClientId(next);
  return next;
}

export function setLocalClientId(id) {
  localStorage.setItem(localClientIdKey, id);
  writeLocalClientCookie(id);
}

function readLocalClientCookie() {
  const prefix = `${localClientCookieName}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function writeLocalClientCookie(id) {
  document.cookie = `${localClientCookieName}=${encodeURIComponent(id)}; Max-Age=${localClientIdMaxAgeSeconds}; Path=/; SameSite=Lax`;
}
