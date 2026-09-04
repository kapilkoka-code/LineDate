import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import type { LocationData } from '@/hooks/useLocation';
import type { NearbyLetter } from '@/services/discovery';
import 'cesium/Build/Cesium/Widgets/widgets.css';

type CesiumMapProps = {
  location: LocationData | null;
  letters: NearbyLetter[];
  onSelect: (letterId: string) => void;
  onUnavailable: () => void;
};

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
const ION_ASSET_ID = import.meta.env.VITE_CESIUM_ION_ASSET_ID as string | undefined;

function stableBearing(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % 360) * (Math.PI / 180);
}

function makeSignalPosition(letter: NearbyLetter, location: LocationData) {
  // Step 12 withholds letter coordinates by design. These anonymous signal
  // positions are deliberately radial, not geographic, while distance remains
  // the server-computed value shown to the user.
  const bearing = stableBearing(letter.id);
  const north = Math.cos(bearing) * letter.distanceMeters;
  const east = Math.sin(bearing) * letter.distanceMeters;
  const latitude = location.latitude + north / 111_320;
  const longitudeScale = Math.max(0.01, Math.cos((location.latitude * Math.PI) / 180));
  const longitude = location.longitude + east / (111_320 * longitudeScale);
  return Cesium.Cartesian3.fromDegrees(longitude, latitude, 8);
}

export function CesiumMap({ location, letters, onSelect, onUnavailable }: CesiumMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const creditsRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const youEntityRef = useRef<Cesium.Entity | null>(null);
  const signalEntitiesRef = useRef<Cesium.Entity[]>([]);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!window.WebGLRenderingContext) {
      setInitializationError('3D rendering is not supported in this browser.');
      onUnavailable();
      return;
    }

    let viewer: Cesium.Viewer;
    try {
      if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN;
      viewer = new Cesium.Viewer(containerRef.current, {
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        baseLayer: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        creditContainer: creditsRef.current ?? containerRef.current,
        msaaSamples: 1,
        contextOptions: {
          requestWebgl1: true,
          webgl: {
            alpha: false,
            antialias: false,
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: false,
            powerPreference: 'low-power',
          },
        },
      });
      viewer.targetFrameRate = 30;
      viewer.scene.screenSpaceCameraController.enableTilt = true;
      viewer.scene.screenSpaceCameraController.enableRotate = true;
      viewer.scene.globe.enableLighting = false;
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#11100f');

      const imageryProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: new Cesium.Credit('© OpenStreetMap contributors'),
        maximumLevel: 19,
      });
      imageryProvider.errorEvent.addEventListener(() => onUnavailable());
      viewer.imageryLayers.addImageryProvider(imageryProvider);

      if (ION_TOKEN && ION_ASSET_ID) {
        void Cesium.Cesium3DTileset.fromIonAssetId(Number(ION_ASSET_ID))
          .then((tileset) => {
            if (!viewer.isDestroyed()) viewer.scene.primitives.add(tileset);
          })
          .catch(() => {
            // The globe remains usable when optional 3D Tiles are unavailable.
          });
      }

      viewer.screenSpaceEventHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedEntity = picked?.id;
        const pickedId = pickedEntity instanceof Cesium.Entity
          ? pickedEntity.properties?.lineLetterId?.getValue(Cesium.JulianDate.now())
          : null;
        if (typeof pickedId === 'string') onSelect(pickedId);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      viewerRef.current = viewer;
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : 'The 3D view could not start.');
      onUnavailable();
    }

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) viewerRef.current.destroy();
      viewerRef.current = null;
      youEntityRef.current = null;
      signalEntitiesRef.current = [];
    };
  }, [onSelect, onUnavailable]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !location) return;

    const youPosition = Cesium.Cartesian3.fromDegrees(location.longitude, location.latitude, 12);
    if (!youEntityRef.current) {
      youEntityRef.current = viewer.entities.add({
        position: youPosition,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString('#f35c4f'),
          outlineColor: Cesium.Color.fromCssColorString('#f3e9d8'),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: 'YOU',
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString('#f3e9d8'),
          pixelOffset: new Cesium.Cartesian2(0, -20),
          style: Cesium.LabelStyle.FILL,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#11100f').withAlpha(0.85),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    } else {
      youEntityRef.current.position = youPosition as unknown as Cesium.PositionProperty;
    }

    for (const entity of signalEntitiesRef.current) viewer.entities.remove(entity);
    signalEntitiesRef.current = letters.map((letter) => viewer.entities.add({
      position: makeSignalPosition(letter, location),
      properties: { lineLetterId: letter.id },
      point: {
        pixelSize: letter.isUnlocked ? 11 : 8,
        color: Cesium.Color.fromCssColorString(letter.isUnlocked ? '#f3e9d8' : '#8f877c'),
        outlineColor: Cesium.Color.fromCssColorString('#f35c4f'),
        outlineWidth: letter.isUnlocked ? 2 : 1,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      },
      label: {
        text: `${letter.isUnlocked ? 'LETTER FOUND' : 'ANONYMOUS LETTER'}  ${letter.distanceLabel}`,
        font: '9px monospace',
        fillColor: Cesium.Color.fromCssColorString('#f3e9d8'),
        pixelOffset: new Cesium.Cartesian2(12, 0),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#11100f').withAlpha(0.82),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
    viewer.scene.requestRender();
  }, [location, letters]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !location) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(location.longitude, location.latitude, Math.max(650, location.accuracy * 3)),
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      },
      duration: 0.8,
    });
  }, [location?.timestamp]);

  return (
    <div className="line-cesium-map" data-testid="cesium-map">
      <div ref={containerRef} className="line-cesium-map-canvas" />
      <div ref={creditsRef} className="line-cesium-credits" aria-label="Map data attribution" />
      <div className="line-cesium-map-topline line-mono">
        <span>LINE / WORLD SIGNALS</span>
        <span>{ION_TOKEN && ION_ASSET_ID ? '3D CITY' : '3D GLOBE'}</span>
      </div>
      {!location && !initializationError && (
        <div className="line-cesium-map-status line-mono">WAITING FOR LOCATION</div>
      )}
      {initializationError && (
        <div className="line-cesium-map-status line-mono" role="status">
          3D VIEW UNAVAILABLE
        </div>
      )}
    </div>
  );
}