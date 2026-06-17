const { createHmac, timingSafeEqual } = require("node:crypto");
const { Pool } = require("pg");

let pool = null;

const restoreTokenMaxAgeSeconds = 60 * 5;
const linkConflictTokenMaxAgeSeconds = 60 * 5;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json({});

  try {
    const clientId = event.headers["x-tadoo-client-id"] || event.headers["X-Tadoo-Client-Id"];
    const action = event.queryStringParameters?.action || "profile";

    if (event.httpMethod === "POST" && action === "link-wholegrain-account") {
      requireWholegrainLinkSecret(event);
      const body = parseBody(event);
      if (!body.identityId || !body.gameAccountId) return json({ error: "Wholegrain identity id and Tadoo account id are required." }, 400);
      const profile = await linkWholegrainAccount(body.identityId, body.gameAccountId, body.identityEmail, body.linkChoice, body.conflictToken);
      return json({ profile, restoreToken: createRestoreToken(profile.id) });
    }

    if (event.httpMethod === "POST" && action === "restore-wholegrain-profile") {
      const body = parseBody(event);
      if (!body.restoreToken) return json({ error: "Restore token is required." }, 400);
      const profileId = verifyRestoreToken(body.restoreToken);
      const profile = await getAccountByActor([profileId], null);
      if (!profile?.identityId) return json({ error: "That restore token does not match a linked Tadoo account." }, 401);
      return json({ profile });
    }

    if (!clientId) return json({ error: "A local client id is required." }, 401);

    if (event.httpMethod === "GET" && action === "profile") {
      const profile = await getAccountByActor([clientId], null);
      return json({ profile });
    }

    if (event.httpMethod === "PATCH" && action === "chores") {
      const body = parseBody(event);
      const chores = normalizeChores(body.chores);
      const profile = await upsertChores(clientId, chores);
      return json({ profile });
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    const handled = error;
    if (handled.statusCode && handled.responseBody) return json(handled.responseBody, handled.statusCode);
    return json({ error: error instanceof Error ? error.message : "Unexpected Tadoo profile service error." }, 500);
  }
};

function getPool() {
  if (!pool) {
    const connectionString = process.env.NETLIFY_DB_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("NETLIFY_DB_URL is not configured.");
    pool = new Pool({ connectionString });
  }
  return pool;
}

async function getAccountByActor(actorIds, identityId) {
  const db = getPool();
  const ids = padActorIds(actorIds);
  const { rows } = await db.query(
    "SELECT * FROM tadoo_accounts WHERE id = $1 OR id = $2 OR id = $3 OR identity_id = $4 LIMIT 1",
    [ids[0], ids[1], ids[2], identityId]
  );
  return rows[0] ? toProfile(rows[0]) : null;
}

async function upsertChores(accountId, chores) {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO tadoo_accounts (id, chores)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE
       SET chores = EXCLUDED.chores,
           updated_at = NOW()
     RETURNING *`,
    [accountId, JSON.stringify(chores)]
  );
  return toProfile(rows[0]);
}

async function linkWholegrainAccount(identityId, gameAccountId, identityEmail, linkChoice, conflictToken) {
  if (linkChoice && !isLinkChoice(linkChoice)) throw new Error("Invalid Wholegrain account link choice.");
  const email = cleanString(identityEmail).slice(0, 320);

  const existingAccount = await getAccountByActor([], identityId);
  if (existingAccount) {
    if (email) await setIdentityEmail(existingAccount.id, email);
    if (existingAccount.id === gameAccountId) return email ? { ...existingAccount, identityEmail: email } : existingAccount;

    const localAccount = await getAccountByActor([gameAccountId], null);
    if (!localAccount) return email ? { ...existingAccount, identityEmail: email } : existingAccount;
    if (localAccount.identityId && localAccount.identityId !== identityId) throw new Error("That Tadoo account is already linked to another Wholegrain account.");

    if (!linkChoice) throw createLinkChoiceRequired(existingAccount, localAccount);
    verifyLinkConflictToken(conflictToken || "", identityId, existingAccount.id, localAccount.id);

    if (linkChoice === "useLinked") {
      await deleteAccount(localAccount.id);
      return email ? { ...existingAccount, identityEmail: email } : existingAccount;
    }

    await replaceLinkedAccount(identityId, email, existingAccount.id, localAccount.id);
    const linkedLocal = await getAccountByActor([localAccount.id], identityId);
    if (!linkedLocal) throw new Error("Unable to link the selected Tadoo chores.");
    return linkedLocal;
  }

  const db = getPool();
  const { rows } = await db.query(
    "UPDATE tadoo_accounts SET identity_id = $1, identity_email = COALESCE($2, identity_email), updated_at = NOW() WHERE id = $3 AND (identity_id IS NULL OR identity_id = $1) RETURNING *",
    [identityId, email || null, gameAccountId]
  );
  if (rows[0]) return toProfile(rows[0]);

  const created = await db.query(
    "INSERT INTO tadoo_accounts (id, identity_id, identity_email, chores) VALUES ($1, $2, $3, '[]'::jsonb) RETURNING *",
    [gameAccountId, identityId, email || null]
  );
  return toProfile(created.rows[0]);
}

async function setIdentityEmail(accountId, email) {
  await getPool().query("UPDATE tadoo_accounts SET identity_email = $1, updated_at = NOW() WHERE id = $2", [email, accountId]);
}

async function replaceLinkedAccount(identityId, identityEmail, existingAccountId, localAccountId) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE tadoo_accounts SET identity_id = NULL, updated_at = NOW() WHERE id = $1 AND identity_id = $2", [existingAccountId, identityId]);
    await client.query("UPDATE tadoo_accounts SET identity_id = $1, identity_email = COALESCE($2, identity_email), updated_at = NOW() WHERE id = $3 AND identity_id IS NULL", [identityId, identityEmail || null, localAccountId]);
    await client.query("DELETE FROM tadoo_accounts WHERE id = $1 AND identity_id IS NULL", [existingAccountId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteAccount(accountId) {
  await getPool().query("DELETE FROM tadoo_accounts WHERE id = $1", [accountId]);
}

function normalizeChores(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1000).map((chore) => ({
    id: cleanString(chore.id).slice(0, 128) || `remote-${crypto.randomUUID()}`,
    symbol: cleanString(chore.symbol).slice(0, 64) || "ti-home",
    title: cleanString(chore.title).slice(0, 60) || "Untitled chore",
    description: cleanString(chore.description).slice(0, 1000),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(cleanString(chore.dueDate)) ? cleanString(chore.dueDate) : new Date().toISOString().slice(0, 10),
    schedule: normalizeSchedule(chore.schedule)
  }));
}

function normalizeSchedule(value) {
  const schedule = value && typeof value === "object" ? value : {};
  if (schedule.type === "weekly") return { type: "weekly", days: Array.isArray(schedule.days) ? schedule.days.map(Number).filter((day) => day >= 0 && day <= 6) : [] };
  if (schedule.type === "monthly") return { type: "monthly", monthPos: schedule.monthPos === "last" ? "last" : "first", monthDay: Math.min(6, Math.max(0, Number(schedule.monthDay) || 0)) };
  if (schedule.type === "every") return { type: "every", num: Math.max(1, Math.min(365, Number(schedule.num) || 1)), unit: ["days", "weeks", "months"].includes(schedule.unit) ? schedule.unit : "days" };
  return { type: "daily" };
}

function createLinkChoiceRequired(existingAccount, localAccount) {
  const error = new Error("Choose which Tadoo chores to keep.");
  error.statusCode = 409;
  error.responseBody = {
    code: "LINK_CHOICE_REQUIRED",
    requiresChoice: true,
    existingUsername: `Linked chores (${existingAccount.chores.length})`,
    localUsername: `This device (${localAccount.chores.length})`,
    conflictToken: createLinkConflictToken(existingAccount.identityId || "", existingAccount.id, localAccount.id)
  };
  return error;
}

function createRestoreToken(profileId) {
  const exp = Math.floor(Date.now() / 1000) + restoreTokenMaxAgeSeconds;
  const payload = encodeBase64Url(JSON.stringify({ profileId, exp }));
  return `${payload}.${signRestorePayload(payload)}`;
}

function verifyRestoreToken(token) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Invalid restore token.");
  if (!safeEqual(signature, signRestorePayload(payload))) throw new Error("Invalid restore token.");
  const parsed = JSON.parse(decodeBase64Url(payload));
  if (typeof parsed.profileId !== "string" || typeof parsed.exp !== "number") throw new Error("Invalid restore token.");
  if (parsed.exp < Math.floor(Date.now() / 1000)) throw new Error("Restore token expired.");
  return parsed.profileId;
}

function createLinkConflictToken(identityId, existingProfileId, localProfileId) {
  const exp = Math.floor(Date.now() / 1000) + linkConflictTokenMaxAgeSeconds;
  const payload = encodeBase64Url(JSON.stringify({ identityId, existingProfileId, localProfileId, exp }));
  return `${payload}.${signRestorePayload(payload)}`;
}

function verifyLinkConflictToken(token, identityId, existingProfileId, localProfileId) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Invalid account link choice token.");
  if (!safeEqual(signature, signRestorePayload(payload))) throw new Error("Invalid account link choice token.");
  const parsed = JSON.parse(decodeBase64Url(payload));
  if (parsed.identityId !== identityId || parsed.existingProfileId !== existingProfileId || parsed.localProfileId !== localProfileId || typeof parsed.exp !== "number") {
    throw new Error("Invalid account link choice token.");
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) throw new Error("Account link choice token expired.");
}

function requireWholegrainLinkSecret(event) {
  const expected = process.env.WHOLEGRAIN_LINK_SECRET;
  if (!expected) throw new Error("WHOLEGRAIN_LINK_SECRET is not configured.");
  const provided = event.headers["x-wholegrain-link-secret"] || event.headers["X-Wholegrain-Link-Secret"];
  if (provided !== expected) throw new Error("Not authorized to link this Tadoo account.");
}

function isLinkChoice(value) {
  return value === "useLinked" || value === "useLocal";
}

function padActorIds(ids) {
  if (!ids.length) return ["", "", ""];
  return [ids[0], ids[1] || ids[0], ids[2] || ids[0]];
}

function signRestorePayload(payload) {
  const secret = process.env.WHOLEGRAIN_LINK_SECRET;
  if (!secret) throw new Error("WHOLEGRAIN_LINK_SECRET is not configured.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function toProfile(row) {
  return {
    id: String(row.id),
    identityId: row.identity_id ? String(row.identity_id) : null,
    identityEmail: row.identity_email ? String(row.identity_email) : "",
    chores: Array.isArray(row.chores) ? row.chores : []
  };
}

function parseBody(event) {
  return event.body ? JSON.parse(event.body) : {};
}

function cleanString(value) {
  return String(value || "").trim();
}

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
