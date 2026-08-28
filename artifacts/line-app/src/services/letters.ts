export type LetterVisibility = 'nearby';
export type LetterStatus = 'dropped';

export type Letter = {
  id: string;
  text: string;
  createdAt: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  isOwn?: boolean;
  visibility: LetterVisibility;
  anonymous: true;
  status: LetterStatus;
};

const LETTERS_STORAGE_KEY = 'line:letters';

function isLetter(value: unknown): value is Letter {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<Letter>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number' &&
    typeof candidate.accuracy === 'number' &&
    (candidate.isOwn === undefined || typeof candidate.isOwn === 'boolean') &&
    candidate.visibility === 'nearby' &&
    candidate.anonymous === true &&
    candidate.status === 'dropped'
  );
}

export function loadLetters(): Letter[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = window.localStorage.getItem(LETTERS_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter(isLetter).map((letter) => ({ ...letter, isOwn: letter.isOwn ?? true }))
      : [];
  } catch {
    return [];
  }
}

export function saveLetter(letter: Letter): void {
  if (typeof window === 'undefined') {
    throw new Error('Letter storage is not available.');
  }

  const nextLetters = [{ ...letter, isOwn: true }, ...loadLetters()];
  window.localStorage.setItem(LETTERS_STORAGE_KEY, JSON.stringify(nextLetters));
}

export function createLetterId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `letter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}