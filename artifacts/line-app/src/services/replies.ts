import { getOrCreateLocalUser } from '@/services/identity';
import { loadLetters } from '@/services/letters';

export type ReplyStatus = 'sent';

export type LetterReply = {
  id: string;
  letterId: string;
  text: string;
  createdAt: string;
  senderId: string;
  senderUserId: string;
  letterWriterId: string;
  identityRevealed: boolean;
  status: ReplyStatus;
};

const REPLIES_STORAGE_KEY = 'line:replies';

type StoredReply = Omit<LetterReply, 'senderUserId' | 'letterWriterId' | 'identityRevealed'> &
  Partial<Pick<LetterReply, 'senderUserId' | 'letterWriterId' | 'identityRevealed'>>;

function isReply(value: unknown): value is StoredReply {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<LetterReply>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.letterId === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.senderId === 'string' &&
    (candidate.senderUserId === undefined || typeof candidate.senderUserId === 'string') &&
    (candidate.letterWriterId === undefined || typeof candidate.letterWriterId === 'string') &&
    (candidate.identityRevealed === undefined || typeof candidate.identityRevealed === 'boolean') &&
    candidate.status === 'sent'
  );
}

export function loadReplies(): LetterReply[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = window.localStorage.getItem(REPLIES_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    const writerByLetterId = new Map(
      loadLetters().map((letter) => [letter.id, letter.writerId]),
    );
    const migratedReplies = parsed.filter(isReply).map((reply) => ({
      ...reply,
      senderUserId: reply.senderUserId ?? reply.senderId,
      letterWriterId: reply.letterWriterId ?? writerByLetterId.get(reply.letterId) ?? '',
      identityRevealed: reply.identityRevealed ?? false,
    }));
    window.localStorage.setItem(REPLIES_STORAGE_KEY, JSON.stringify(migratedReplies));
    return migratedReplies;
  } catch {
    return [];
  }
}

export function saveReply(reply: LetterReply): void {
  if (typeof window === 'undefined') {
    throw new Error('Reply storage is not available.');
  }

  const localUser = getOrCreateLocalUser();
  const nextReply = {
    ...reply,
    senderId: reply.senderId || localUser.id,
    senderUserId: localUser.id,
    identityRevealed: reply.identityRevealed ?? false,
  };
  window.localStorage.setItem(REPLIES_STORAGE_KEY, JSON.stringify([nextReply, ...loadReplies()]));
}

export function createReplyId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getLocalSenderId(): string {
  return getOrCreateLocalUser().id;
}