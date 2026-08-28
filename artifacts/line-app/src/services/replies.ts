import { getOrCreateLocalUser } from '@/services/identity';
import { loadLetters } from '@/services/letters';

export type ReplyStatus = 'sent';

export type LetterReply = {
  id: string;
  letterId: string;
  text: string;
  createdAt: string;
  senderId: string;
  senderDisplayName: string;
  senderUserId: string;
  letterWriterId: string;
  letterWriterDisplayName: string;
  identityRevealed: boolean;
  withinRange?: boolean;
  status: ReplyStatus;
};

const REPLIES_STORAGE_KEY = 'line:replies';

type StoredReply = Omit<
  LetterReply,
  'senderDisplayName' | 'senderUserId' | 'letterWriterId' | 'letterWriterDisplayName' | 'identityRevealed'
> &
  Partial<
    Pick<
      LetterReply,
      'senderDisplayName' | 'senderUserId' | 'letterWriterId' | 'letterWriterDisplayName' | 'identityRevealed'
    >
  >;

function isReply(value: unknown): value is StoredReply {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<LetterReply>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.letterId === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.senderId === 'string' &&
    (candidate.senderDisplayName === undefined || typeof candidate.senderDisplayName === 'string') &&
    (candidate.senderUserId === undefined || typeof candidate.senderUserId === 'string') &&
    (candidate.letterWriterId === undefined || typeof candidate.letterWriterId === 'string') &&
    (candidate.letterWriterDisplayName === undefined || typeof candidate.letterWriterDisplayName === 'string') &&
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

    const storedLetters = loadLetters();
    const writerByLetterId = new Map(
      storedLetters.map((letter) => [letter.id, letter.writerId]),
    );
    const writerNameByLetterId = new Map(
      storedLetters.map((letter) => [letter.id, letter.writerDisplayName]),
    );
    const migratedReplies = parsed.filter(isReply).map((reply) => ({
      ...reply,
      senderDisplayName: reply.senderDisplayName ?? 'Anonymous User',
      senderUserId: reply.senderUserId ?? reply.senderId,
      letterWriterId: reply.letterWriterId ?? writerByLetterId.get(reply.letterId) ?? '',
      letterWriterDisplayName: reply.letterWriterDisplayName
        ?? writerNameByLetterId.get(reply.letterId)
        ?? 'Anonymous User',
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
    senderDisplayName: reply.senderDisplayName || localUser.displayName,
    senderUserId: localUser.id,
    letterWriterDisplayName: reply.letterWriterDisplayName || 'Anonymous User',
    identityRevealed: reply.identityRevealed ?? false,
  };
  window.localStorage.setItem(REPLIES_STORAGE_KEY, JSON.stringify([nextReply, ...loadReplies()]));
}

export function setReplyIdentityRevealed(replyId: string, identityRevealed: boolean): LetterReply[] {
  if (typeof window === 'undefined') return [];

  const localUser = getOrCreateLocalUser();
  const replies = loadReplies();
  const targetReply = replies.find((reply) => reply.id === replyId);
  if (!targetReply) return [];

  const isSameRelationship = (reply: LetterReply) =>
    reply.letterId === targetReply.letterId &&
    reply.senderUserId === targetReply.senderUserId;
  const nextReplies = replies.map((reply) => {
    if (!isSameRelationship(reply)) return reply;
    return {
      ...reply,
      identityRevealed,
      letterWriterId: identityRevealed ? localUser.id : reply.letterWriterId,
      letterWriterDisplayName: identityRevealed ? localUser.displayName : reply.letterWriterDisplayName,
    };
  });

  window.localStorage.setItem(REPLIES_STORAGE_KEY, JSON.stringify(nextReplies));
  return nextReplies.filter(isSameRelationship);
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