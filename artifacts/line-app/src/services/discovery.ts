import type { LocationData } from '@/hooks/useLocation';
import type { Letter } from '@/services/letters';

export const DISCOVERY_RANGE_METERS = 100;

export type NearbyLetter = {
  id: string;
  distanceMeters: number;
  distanceLabel: string;
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

function formatDistance(distanceMeters: number) {
  return `${Math.max(1, Math.round(distanceMeters))}m`;
}

export function getNearbyLetters(
  currentLocation: LocationData | null,
  letters: Letter[],
): NearbyLetter[] {
  if (!currentLocation) return [];

  const markerPositions = [
    { top: '30%', left: '22%', tone: 'coral' as const },
    { top: '54%', left: '69%', tone: 'paper' as const },
    { top: '73%', left: '35%', tone: 'quiet' as const },
    { top: '23%', left: '76%', tone: 'paper' as const },
    { top: '77%', left: '71%', tone: 'coral' as const },
  ];

  return letters
    .filter((letter) => letter.isOwn !== true)
    .map((letter) => ({
      letter,
      distanceMeters: distanceBetweenLocations(currentLocation, letter),
    }))
    .filter(({ distanceMeters }) => distanceMeters <= DISCOVERY_RANGE_METERS)
    .sort((first, second) => first.distanceMeters - second.distanceMeters)
    .map(({ letter, distanceMeters }, index) => {
      const marker = markerPositions[index % markerPositions.length];

      return {
        id: letter.id,
        distanceMeters,
        distanceLabel: formatDistance(distanceMeters),
        ...marker,
      };
    });
}