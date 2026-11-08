import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { lightenColor } from 'common/accent-color';
import { useStore } from '../../contexts/StoreContext';
import { ClientFile } from '../../entities/File';

mapboxgl.accessToken = process.env.MAPBOX_ACCESS_TOKEN;

const DEFAULT_CENTER: [number, number] = [2.5, 48.35];
const DEFAULT_ZOOM = 3;
const RECENT_PHOTO_ZOOM = 8;
const FALLBACK_ACCENT = '#d97757';
const POINT_TINT = 0.45;

/** The resolved accent colour of the current theme, and a lighter tint of it for single photos */
function getMapColors(element: HTMLElement | null): { cluster: string; point: string } {
  const accent = element ? getComputedStyle(element).getPropertyValue('--accent-color').trim() : '';
  const point = lightenColor(accent, POINT_TINT);
  return point ? { cluster: accent, point } : { cluster: FALLBACK_ACCENT, point: '#f0b48a' };
}

/** Centers on the most recently-dated photo, so the map opens over "your" region instead of the whole globe. */
function getInitialView(files: (ClientFile & { lat: number; lng: number })[]): {
  center: [number, number];
  zoom: number;
} {
  if (files.length === 0) {
    return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  }

  const mostRecent = files.reduce((latest, file) =>
    file.dateCreated > latest.dateCreated ? file : latest,
  );

  return { center: [mostRecent.lng, mostRecent.lat], zoom: RECENT_PHOTO_ZOOM };
}

function toGeoJson(
  files: (ClientFile & { lat: number; lng: number })[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: files.map((file) => ({
      type: 'Feature',
      properties: { fileId: file.id },
      geometry: { type: 'Point', coordinates: [file.lng, file.lat] },
    })),
  };
}

const MapView = observer(() => {
  const { fileStore, uiStore } = useStore();
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [popupFileId, setPopupFileId] = useState<string | null>(null);

  const geoFiles = fileStore.geoTaggedFiles as (ClientFile & { lat: number; lng: number })[];
  const popupFile = popupFileId ? fileStore.fileList.find((f) => f.id === popupFileId) : undefined;

  // Init map once
  useEffect(() => {
    if (map.current || !mapContainer.current) {
      return;
    }

    const { center, zoom } = getInitialView(geoFiles);

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style:
        uiStore.theme === 'dark'
          ? 'mapbox://styles/mapbox/dark-v11'
          : 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom,
    });

    m.on('load', () => {
      m.addSource('photos', {
        type: 'geojson',
        data: toGeoJson(geoFiles),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      m.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'photos',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': getMapColors(mapContainer.current).cluster,
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 16, 25, 22, 100, 28],
        },
      });

      m.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'photos',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
        },
        paint: { 'text-color': '#16171a' },
      });

      m.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'photos',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': getMapColors(mapContainer.current).point,
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#16171a',
        },
      });

      m.on('click', 'clusters', (e) => {
        const features = m.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (clusterId === undefined) {
          return;
        }
        const source = m.getSource('photos') as mapboxgl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) {
            return;
          }
          const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
          m.easeTo({ center: coords, zoom });
        });
      });

      m.on('click', 'unclustered-point', (e) => {
        const feature = e.features?.[0];
        const fileId = feature?.properties?.fileId as string | undefined;
        if (fileId) {
          setPopupFileId(fileId);
        }
      });

      m.on('mouseenter', 'clusters', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'clusters', () => (m.getCanvas().style.cursor = ''));
      m.on('mouseenter', 'unclustered-point', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'unclustered-point', () => (m.getCanvas().style.cursor = ''));
    });

    map.current = m;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the accent colour: it changes with the system accent (an inline style on the root element) and with the theme
  useEffect(() => {
    const apply = () => {
      const m = map.current;
      if (!m || !m.getLayer('clusters') || !m.getLayer('unclustered-point')) {
        return;
      }
      const colors = getMapColors(mapContainer.current);
      m.setPaintProperty('clusters', 'circle-color', colors.cluster);
      m.setPaintProperty('unclustered-point', 'circle-color', colors.point);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [uiStore.theme]);

  // Keep the GeoJSON source in sync as files/GPS data change
  useEffect(() => {
    const m = map.current;
    if (!m) {
      return;
    }
    const source = m.getSource('photos') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(toGeoJson(geoFiles));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoFiles.length]);

  return (
    <div className="mapbox-container">
      <div ref={mapContainer} className="map" />
      {popupFile && (
        <div className="map-marker-popup">
          <div className="map-marker-popup__thumbnail-wrap">
            <img src={popupFile.thumbnailPath} alt={popupFile.name} />
            <button
              className="map-marker-popup__close"
              onClick={() => setPopupFileId(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="map-marker-popup__body">
            <div className="map-marker-popup__name">{popupFile.name}</div>
            {popupFile.lat != null && popupFile.lng != null && (
              <div className="map-marker-popup__coords">
                {popupFile.lat.toFixed(4)}, {popupFile.lng.toFixed(4)}
              </div>
            )}
            <a
              href="#"
              className="map-marker-popup__open"
              onClick={(e) => {
                e.preventDefault();
                uiStore.selectFile(popupFile, true);
                uiStore.enableSlideMode();
              }}
            >
              Open in viewer →
            </a>
          </div>
        </div>
      )}
    </div>
  );
});

export default MapView;
