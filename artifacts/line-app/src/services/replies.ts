export type ReplyStatus = 'sent';

export type LetterReply = {
  id: string;
  letterId: string;
  text: string;
  createdAt: string;
  senderId: string;
  status: ReplyStatus;
};

const REPLIES_STORAGE_KEY = 'line:replies';
const LOCAL_SENDER_ID_KEY = 'line:sender-id';

function isReply(value: unknown): value is LetterReply {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<LetterReply>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.letterId === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.senderId === 'string' &&
    candidate.status === 'sent'
  );
}

export function loadReplies(): LetterReply[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = window.localStorage.getItem(REPLIES_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isReply) : [];
  } catch {
    return [];
  }
}

export function saveReply(reply: LetterReply): void {
  if (typeof window === 'undefined') {
    throw new Error('Reply storage is not available.');
  }

  window.localStorage.setItem(REPLIES_STORAGE_KEY, JSON.stringify([reply, ...loadReplies()]));
}

export function createReplyId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getLocalSenderId(): string {
  if (typeof window === 'undefined') {
    return 'LINE-LOCAL';
  }

  const stored = window.localStorage.getItem(LOCAL_SENDER_ID_KEY);
  if (stored) return stored;

  const source =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const senderId = `LINE-${source.slice(0, 6).toUpperCase()}`;
  window.localStorage.setItem(LOCAL_SENDER_ID_KEY, senderId);
  return senderId;
}