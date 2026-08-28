import type { LocationData } from '@/hooks/useLocation';
import type { Letter } from '@/services/letters';
import type { NearbyLetterRecord } from '@/services/api';

export const DISCOVERY_RANGE_METERS = 100;
export const UNLOCK_DISTANCE_METERS = 10;

export type NearbyLetter = {
  id: string;
  letter: Pick<Letter, 'id' | 'text' | 'createdAt' | 'visibility' | 'anonymous' | 'status' | 'isOwn' | 'isUnlocked'>;
  distanceMeters: number;
  distanceLabel: string;
  isUnlocked: boolean;
  top: string;
  left: string;
  tone: 'coral' | 'paper' | 'quiet';
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceBetweenLocations(
  origin: Pick<LocationData, 'latitude' | 'longitude'>,
  destination: Pick<LocationData, 'latitude' | 'longitude'>,
) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isLetterWithinUnlockRange(
  currentLocation: Pick<LocationData, 'latitude' | 'longitude'> | null,
  letter: Pick<Letter, 'latitude' | 'longitude'>,
) {
  return currentLocation !== null
    && distanceBetweenLocations(currentLocation, letter) <= UNLOCK_DISTANCE_METERS;
}

function formatDistance(distanceMeters: number) {
  return `${Math.max(1, Math.round(distanceMeters))}m`;
}

export function getNearbyLetters(
  _currentLocation: LocationData | null,
  letters: NearbyLetterRecord[],
): NearbyLetter[] {
  const markerPositions = [
    { top: '30%', left: '22%', tone: 'coral' as const },
    { top: '54%', left: '69%', tone: 'paper' as const },
    { top: '73%', left: '35%', tone: 'quiet' as const },
    { top: '23%', left: '76%', tone: 'paper' as const },
    { top: '77%', left: '71%', tone: 'coral' as const },
  ];

  return letters
    .filter((letter) => letter.distanceMeters <= DISCOVERY_RANGE_METERS)
    .map((letter) => ({
      letter: {
        id: letter.id,
        text: letter.text ?? '',
        createdAt: letter.createdAt,
        visibility: letter.visibility,
        anonymous: letter.anonymous,
        status: letter.status,
        isOwn: letter.isOwn,
        isUnlocked: letter.isUnlocked,
      },
      distanceMeters: letter.distanceMeters,
      isUnlocked: letter.isUnlocked,
    }))
    .sort((first, second) => first.distanceMeters - second.distanceMeters)
    .map(({ letter, distanceMeters }, index) => {
      const marker = markerPositions[index % markerPositions.length];

      return {
        id: letter.id,
        letter,
        distanceMeters,
        distanceLabel: formatDistance(distanceMeters),
        isUnlocked: letter.isUnlocked,
        ...marker,
      };
    });
}