export type DiscoveryLetter = {
  id: string;
  distance: number;
  label: string;
  top: string;
  left: string;
  tone: 'coral' | 'paper' | 'quiet';
};

export const discoveryLetters: DiscoveryLetter[] = [
  { id: 'letter-12', distance: 12, label: '12m', top: '30%', left: '22%', tone: 'coral' },
  { id: 'letter-24', distance: 24, label: '24m', top: '54%', left: '69%', tone: 'paper' },
  { id: 'letter-38', distance: 38, label: '38m', top: '73%', left: '35%', tone: 'quiet' },
];