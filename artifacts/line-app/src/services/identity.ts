export type LocalUser = {
  id: string;
  displayName: string;
  createdAt: string;
};

const LOCAL_USER_STORAGE_KEY = 'line:local-user';
const LEGACY_SENDER_ID_KEY = 'line:sender-id';
const DEFAULT_DISPLAY_NAME = 'Anonymous User';

function isLocalUser(value: unknown): value is LocalUser {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<LocalUser>;
  return (
    typeof candidate.id === 'string' &&
    /^LINE-[A-Z0-9]{6}$/.test(candidate.id) &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}

function createLocalUserId() {
  const source =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `LINE-${source.slice(0, 6).toUpperCase()}`;
}

export function getOrCreateLocalUser(): LocalUser {
  if (typeof window === 'undefined') {
    return { id: 'LINE-LOCAL', displayName: DEFAULT_DISPLAY_NAME, createdAt: '' };
  }

  try {
    const stored = window.localStorage.getItem(LOCAL_USER_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isLocalUser(parsed)) return parsed;
    }
  } catch {
    // Recreate a recoverable local identity below if storage is malformed.
  }

  const legacySenderId = window.localStorage.getItem(LEGACY_SENDER_ID_KEY);
  const user: LocalUser = {
    id: legacySenderId && /^LINE-[A-Z0-9]{6}$/.test(legacySenderId) ? legacySenderId : createLocalUserId(),
    displayName: DEFAULT_DISPLAY_NAME,
    createdAt: new Date().toISOString(),
  };
  window.localStorage.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify(user));
  window.localStorage.setItem(LEGACY_SENDER_ID_KEY, user.id);
  return user;
}

export function saveLocalUser(user: LocalUser): void {
  if (typeof window === 'undefined') {
    throw new Error('Local identity storage is not available.');
  }

  const normalizedUser = {
    ...user,
    displayName: user.displayName.trim() || DEFAULT_DISPLAY_NAME,
  };
  window.localStorage.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify(normalizedUser));
  window.localStorage.setItem(LEGACY_SENDER_ID_KEY, normalizedUser.id);
}

export function updateLocalDisplayName(displayName: string): LocalUser {
  const currentUser = getOrCreateLocalUser();
  const updatedUser = {
    ...currentUser,
    displayName: displayName.trim() || DEFAULT_DISPLAY_NAME,
  };
  saveLocalUser(updatedUser);
  return updatedUser;
}