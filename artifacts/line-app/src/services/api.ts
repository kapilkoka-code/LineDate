export type LineProfile = { id: string; displayName: string; createdAt: string };
export type Letter = {
  id: string; text: string | null; createdAt: string; latitude: number; longitude: number;
  accuracy: number; visibility: 'nearby'; anonymous: true; status: 'dropped'; isOwn: boolean;
  isUnlocked?: boolean; replyCount?: number;
};
export type NearbyLetterRecord = {
  id: string; text: string | null; createdAt: string; visibility: 'nearby';
  anonymous: true; status: 'dropped'; isOwn: false; isUnlocked: boolean;
  distanceMeters: number; bearingDegrees: number;
};
export type WriterReply = {
  id: string; letterId: string; text: string; createdAt: string; status: 'sent';
  senderUserId: string; senderLineId: string; senderDisplayName: string; identityRevealed: boolean;
};
export type SentReply = {
  id: string; letterId: string; text: string; createdAt: string; status: 'sent';
  identityRevealed: boolean; withinRange: boolean; writerLineId: string | null; writerDisplayName: string | null;
};
export type LocationPayload = { latitude: number; longitude: number; accuracy: number };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers }, ...init });
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) throw new ApiError(response.status, (body as { error?: string } | null)?.error ?? `Request failed (${response.status}).`);
  return body as T;
}
const query = (location: Pick<LocationPayload, 'latitude' | 'longitude'>) => `?latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}`;
export const api = {
  profile: () => request<LineProfile>('/profile'),
  updateProfile: (displayName: string) => request<LineProfile>('/profile', { method: 'PATCH', body: JSON.stringify({ displayName }) }),
  nearby: (location: Pick<LocationPayload, 'latitude' | 'longitude'>) => request<NearbyLetterRecord[]>(`/letters/nearby${query(location)}&radius=100`),
  letter: (id: string, location: Pick<LocationPayload, 'latitude' | 'longitude'>) => request<Letter>(`/letters/${encodeURIComponent(id)}${query(location)}`),
  createLetter: (data: LocationPayload & { id: string; text: string; visibility: 'nearby'; anonymous: true; status: 'dropped' }) => request<Letter>('/letters', { method: 'POST', body: JSON.stringify(data) }),
  myLetters: () => request<Letter[]>('/letters/mine'),
  repliesForLetter: (id: string, location: Pick<LocationPayload, 'latitude' | 'longitude'>) => request<WriterReply[]>(`/letters/${encodeURIComponent(id)}/replies${query(location)}`),
  createReply: (id: string, data: LocationPayload & { id: string; text: string; status: 'sent' }) => request<SentReply>(`/letters/${encodeURIComponent(id)}/replies`, { method: 'POST', body: JSON.stringify(data) }),
  myReplies: (location?: Pick<LocationPayload, 'latitude' | 'longitude'>) => request<SentReply[]>(`/replies/mine${location ? query(location) : ''}`),
  reveal: (letterId: string, senderUserId: string, location: LocationPayload) => request<{ letterId: string; senderUserId: string; identityRevealed: boolean }>(`/letters/${encodeURIComponent(letterId)}/relationships/${encodeURIComponent(senderUserId)}/reveal`, { method: 'POST', body: JSON.stringify(location) }),
  migrate: (data: unknown) => request<{ migratedLetters: number; skippedLetters: number; migratedReplies: number; skippedReplies: number; linkedLocalUserId: string }>('/migration/local', { method: 'POST', body: JSON.stringify(data) }),
};