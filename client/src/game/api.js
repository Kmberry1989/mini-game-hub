const API_BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const STORAGE_KEYS = {
  accessToken: "miniGame.auth.accessToken",
  refreshToken: "miniGame.auth.refreshToken"
};

export function loadStoredSession() {
  return {
    accessToken: window.localStorage.getItem(STORAGE_KEYS.accessToken) || "",
    refreshToken: window.localStorage.getItem(STORAGE_KEYS.refreshToken) || ""
  };
}

export function saveStoredSession({ accessToken, refreshToken }) {
  if (typeof accessToken === "string") {
    window.localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
  }
  if (typeof refreshToken === "string") {
    window.localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  }
}

export function clearStoredSession() {
  window.localStorage.removeItem(STORAGE_KEYS.accessToken);
  window.localStorage.removeItem(STORAGE_KEYS.refreshToken);
}

async function request(path, { method = "GET", body, accessToken } = {}) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function signup({ email, password, displayName }) {
  return request("/api/auth/signup", {
    method: "POST",
    body: { email, password, displayName }
  });
}

export function login({ email, password }) {
  return request("/api/auth/login", {
    method: "POST",
    body: { email, password }
  });
}

export function refreshAuth({ refreshToken }) {
  return request("/api/auth/refresh", {
    method: "POST",
    body: { refreshToken }
  });
}

export function logout({ refreshToken }) {
  return request("/api/auth/logout", {
    method: "POST",
    body: { refreshToken }
  });
}

export function fetchProfile(accessToken) {
  return request("/api/profile/me", {
    method: "GET",
    accessToken
  });
}

export function updateAvatar(accessToken, avatar) {
  return request("/api/profile/avatar", {
    method: "POST",
    accessToken,
    body: { avatar }
  });
}

export function fetchActiveQuests(accessToken) {
  return request("/api/quests/active", {
    method: "GET",
    accessToken
  });
}

export function fetchVoiceToken(accessToken, roomId) {
  return request("/api/voice/token", {
    method: "POST",
    accessToken,
    body: { roomId }
  });
}
