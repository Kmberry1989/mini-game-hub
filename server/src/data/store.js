import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

function nowIso() {
  return new Date().toISOString();
}

function clampMin(value, min) {
  return value < min ? min : value;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDisplayName(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    return "Guest";
  }
  return cleaned.slice(0, 32);
}

export function hashToken(rawToken) {
  return createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function defaultData() {
  return {
    users: [],
    profiles: [],
    refreshTokens: [],
    userQuests: [],
    userUnlocks: [],
    currencyLedger: [],
    grantHistory: [],
    abuseReports: []
  };
}

export class FileBackedStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = defaultData();
    this.flushTimer = null;
    this.pendingFlush = Promise.resolve();
  }

  async init() {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      this.data = {
        ...defaultData(),
        ...parsed,
        users: Array.isArray(parsed?.users) ? parsed.users : [],
        profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : [],
        refreshTokens: Array.isArray(parsed?.refreshTokens) ? parsed.refreshTokens : [],
        userQuests: Array.isArray(parsed?.userQuests) ? parsed.userQuests : [],
        userUnlocks: Array.isArray(parsed?.userUnlocks) ? parsed.userUnlocks : [],
        currencyLedger: Array.isArray(parsed?.currencyLedger) ? parsed.currencyLedger : [],
        grantHistory: Array.isArray(parsed?.grantHistory) ? parsed.grantHistory : [],
        abuseReports: Array.isArray(parsed?.abuseReports) ? parsed.abuseReports : []
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      await this.flushNow();
    }
  }

  scheduleFlush() {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.pendingFlush = this.pendingFlush.then(() => this.flushNow()).catch(() => {});
    }, 80);
  }

  async flushNow() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const serialized = JSON.stringify(this.data, null, 2);
    await fs.writeFile(this.filePath, serialized, "utf-8");
  }

  async close() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.pendingFlush;
    await this.flushNow();
  }

  findUserByEmail(email) {
    const normalized = normalizeEmail(email);
    return this.data.users.find((user) => user.email === normalized) || null;
  }

  findUserById(userId) {
    return this.data.users.find((user) => user.id === userId) || null;
  }

  createUser({ email, passwordHash, displayName, defaultAvatar }) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      throw new Error("email_required");
    }
    if (this.findUserByEmail(normalizedEmail)) {
      throw new Error("email_exists");
    }

    const id = uuidv4();
    const timestamp = nowIso();

    const user = {
      id,
      email: normalizedEmail,
      passwordHash,
      displayName: normalizeDisplayName(displayName),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const profile = {
      userId: id,
      selectedAvatar: defaultAvatar,
      starsBalance: 0,
      level: 1,
      xpTotal: 0,
      equipped: {
        ringStyle: null,
        emoteBadge: null
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.data.users.push(user);
    this.data.profiles.push(profile);
    this.scheduleFlush();

    return { user, profile };
  }

  updateUserDisplayName(userId, displayName) {
    const user = this.findUserById(userId);
    if (!user) {
      return null;
    }
    user.displayName = normalizeDisplayName(displayName);
    user.updatedAt = nowIso();
    this.scheduleFlush();
    return user;
  }

  getProfileByUserId(userId) {
    return this.data.profiles.find((profile) => profile.userId === userId) || null;
  }

  ensureProfile(userId, defaultAvatar) {
    let profile = this.getProfileByUserId(userId);
    if (profile) {
      return profile;
    }

    profile = {
      userId,
      selectedAvatar: defaultAvatar,
      starsBalance: 0,
      level: 1,
      xpTotal: 0,
      equipped: {
        ringStyle: null,
        emoteBadge: null
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.data.profiles.push(profile);
    this.scheduleFlush();
    return profile;
  }

  updateProfileAvatar(userId, avatarId) {
    const profile = this.getProfileByUserId(userId);
    if (!profile) {
      return null;
    }
    profile.selectedAvatar = avatarId;
    profile.updatedAt = nowIso();
    this.scheduleFlush();
    return profile;
  }

  createRefreshToken({ userId, tokenHash, expiresAt, rotatedFrom = null }) {
    const record = {
      id: uuidv4(),
      userId,
      tokenHash,
      expiresAt,
      rotatedFrom,
      revokedAt: null,
      createdAt: nowIso()
    };
    this.data.refreshTokens.push(record);
    this.scheduleFlush();
    return record;
  }

  findRefreshTokenByHash(tokenHash) {
    return this.data.refreshTokens.find((record) => record.tokenHash === tokenHash) || null;
  }

  revokeRefreshToken(tokenHash) {
    const record = this.findRefreshTokenByHash(tokenHash);
    if (!record || record.revokedAt) {
      return null;
    }
    record.revokedAt = nowIso();
    this.scheduleFlush();
    return record;
  }

  revokeAllRefreshTokensForUser(userId) {
    const timestamp = nowIso();
    let changed = false;
    for (const record of this.data.refreshTokens) {
      if (record.userId === userId && !record.revokedAt) {
        record.revokedAt = timestamp;
        changed = true;
      }
    }
    if (changed) {
      this.scheduleFlush();
    }
  }

  listQuestStatesForUser(userId) {
    return this.data.userQuests.filter((row) => row.userId === userId);
  }

  findQuestState(userId, questId) {
    return this.data.userQuests.find((row) => row.userId === userId && row.questId === questId) || null;
  }

  upsertQuestState(nextState) {
    const existing = this.findQuestState(nextState.userId, nextState.questId);
    if (!existing) {
      this.data.userQuests.push(nextState);
      this.scheduleFlush();
      return nextState;
    }

    Object.assign(existing, nextState);
    this.scheduleFlush();
    return existing;
  }

  hasGrantKey(userId, grantKey) {
    return this.data.grantHistory.some((entry) => entry.userId === userId && entry.grantKey === grantKey);
  }

  rememberGrantKey(userId, grantKey) {
    if (this.hasGrantKey(userId, grantKey)) {
      return false;
    }

    this.data.grantHistory.push({
      id: uuidv4(),
      userId,
      grantKey,
      createdAt: nowIso()
    });
    this.scheduleFlush();
    return true;
  }

  appendCurrencyLedger({ userId, delta, source, sourceRef }) {
    const profile = this.getProfileByUserId(userId);
    if (!profile) {
      return null;
    }

    profile.starsBalance = clampMin(profile.starsBalance + delta, 0);
    profile.updatedAt = nowIso();

    const entry = {
      id: uuidv4(),
      userId,
      delta,
      source,
      sourceRef,
      balanceAfter: profile.starsBalance,
      createdAt: nowIso()
    };

    this.data.currencyLedger.push(entry);
    this.scheduleFlush();
    return { entry, balance: profile.starsBalance };
  }

  addXp(userId, xpDelta) {
    const profile = this.getProfileByUserId(userId);
    if (!profile) {
      return null;
    }

    profile.xpTotal = clampMin(profile.xpTotal + xpDelta, 0);
    profile.level = Math.max(1, 1 + Math.floor(profile.xpTotal / 220));
    profile.updatedAt = nowIso();
    this.scheduleFlush();

    return {
      level: profile.level,
      xpTotal: profile.xpTotal
    };
  }

  listUnlocksByUser(userId) {
    return this.data.userUnlocks.filter((row) => row.userId === userId);
  }

  hasUnlock(userId, unlockId) {
    return this.data.userUnlocks.some((row) => row.userId === userId && row.unlockId === unlockId);
  }

  grantUnlock(userId, unlockId, source = "system") {
    if (this.hasUnlock(userId, unlockId)) {
      return null;
    }

    const unlocked = {
      id: uuidv4(),
      userId,
      unlockId,
      source,
      acquiredAt: nowIso(),
      equipState: {
        equipped: false
      }
    };

    this.data.userUnlocks.push(unlocked);
    this.scheduleFlush();
    return unlocked;
  }

  equipUnlock(userId, unlockId, category) {
    const profile = this.getProfileByUserId(userId);
    if (!profile) {
      return null;
    }

    if (!this.hasUnlock(userId, unlockId)) {
      return null;
    }

    if (category === "ring_style") {
      profile.equipped.ringStyle = unlockId;
    }

    if (category === "emote_badge") {
      profile.equipped.emoteBadge = unlockId;
    }

    profile.updatedAt = nowIso();
    this.scheduleFlush();
    return profile;
  }

  addAbuseReport({ reporterUserId, targetPlayerId, roomId, reason }) {
    const report = {
      id: uuidv4(),
      reporterUserId,
      targetPlayerId,
      roomId,
      reason,
      createdAt: nowIso()
    };
    this.data.abuseReports.push(report);
    this.scheduleFlush();
    return report;
  }
}
