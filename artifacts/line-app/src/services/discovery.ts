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
  bearingDegrees: number;
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function syntheticTarget(
  origin: Pick<LocationData, 'latitude' | 'longitude'>,
  distanceMeters: number,
  bearingDegrees: number,
) {
  const angularDistance = distanceMeters / 6_371_000;
  const bearing = toRadians(bearingDegrees);
  const latitude = toRadians(origin.latitude);
  const longitude = toRadians(origin.longitude);
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
    + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );
  return {
    latitude: toDegrees(destinationLatitude),
    longitude: toDegrees(destinationLongitude),
  };
}

function bearingBetweenLocations(
  origin: Pick<LocationData, 'latitude' | 'longitude'>,
  destination: Pick<LocationData, 'latitude' | 'longitude'>,
) {
  const startLatitude = toRadians(origin.latitude);
  const endLatitude = toRadians(destination.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
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
  currentLocation: LocationData | null,
  letters: NearbyLetterRecord[],
  guidanceOrigin?: Pick<LocationData, 'latitude' | 'longitude'> | null,
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
    .map((letter) => {
      const target = currentLocation && guidanceOrigin
        ? syntheticTarget(guidanceOrigin, letter.distanceMeters, letter.bearingDegrees)
        : null;
      const displayedDistance = target && currentLocation
        ? distanceBetweenLocations(currentLocation, target)
        : letter.distanceMeters;
      const displayedBearing = target && currentLocation
        ? bearingBetweenLocations(currentLocation, target)
        : letter.bearingDegrees;
      return {
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
      distanceMeters: displayedDistance,
      isUnlocked: letter.isUnlocked,
      bearingDegrees: displayedBearing,
      };
    })
    .sort((first, second) => first.distanceMeters - second.distanceMeters)
    .map(({ letter, distanceMeters, bearingDegrees }, index) => {
      const marker = markerPositions[index % markerPositions.length];

      return {
        id: letter.id,
        letter,
        distanceMeters,
        distanceLabel: formatDistance(distanceMeters),
        isUnlocked: letter.isUnlocked,
        bearingDegrees,
        ...marker,
      };
    });
}