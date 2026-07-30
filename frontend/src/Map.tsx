import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const MASK_COLOR = '#dce3ea'
const BORDER_COLOR = '#1a3a52'
const BUILDING_LAYER_IDS = ['building', 'building-3d']
const STYLE_URL = '/data/liberty-style.json'
const NEPAL_CENTER: [number, number] = [84.124, 28.3949]

type NepalGeoJSON = GeoJSON.FeatureCollection

/** Build a world polygon with Nepal cut out so only Nepal shows the basemap. */
function buildMaskGeoJSON(nepal: NepalGeoJSON): GeoJSON.Feature {
  const geometry = nepal.features[0]?.geometry
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    throw new Error('Nepal boundary geometry missing')
  }

  const holes =
    geometry.type === 'Polygon'
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map((polygon) => polygon[0])

  const worldRing: GeoJSON.Position[] = [
    [-180, 90],
    [180, 90],
    [180, -90],
    [-180, -90],
    [-180, 90],
  ]

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [worldRing, ...holes],
    },
  }
}

function hideBuildings(map: maplibregl.Map) {
  for (const id of BUILDING_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'none')
    }
  }
}

function boundsFromNepal(nepal: NepalGeoJSON): [[number, number], [number, number]] {
  const geometry = nepal.features[0]?.geometry
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    return [
      [80, 26],
      [88.5, 30.5],
    ]
  }

  const rings =
    geometry.type === 'Polygon'
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map((polygon) => polygon[0])

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng)
      minLat = Math.min(minLat, lat)
      maxLng = Math.max(maxLng, lng)
      maxLat = Math.max(maxLat, lat)
    }
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false
    const container = containerRef.current

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: NEPAL_CENTER,
      zoom: 7,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    const onStyleReady = () => {
      if (cancelled) return
      hideBuildings(map)
    }

    map.on('load', onStyleReady)
    map.on('style.load', onStyleReady)

    map.on('error', (e) => {
      console.error('MapLibre error:', e.error)
    })

    fetch('/data/nepal.geojson')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load Nepal boundary')
        return res.json() as Promise<NepalGeoJSON>
      })
      .then((nepal) => {
        if (cancelled || !mapRef.current) return

        const applyOverlay = () => {
          if (cancelled || !map.getStyle()) return
          hideBuildings(map)
          if (map.getSource('nepal-mask')) return

          map.addSource('nepal-mask', {
            type: 'geojson',
            data: buildMaskGeoJSON(nepal),
          })

          map.addSource('nepal-boundary', {
            type: 'geojson',
            data: nepal,
          })

          map.addLayer({
            id: 'nepal-mask-fill',
            type: 'fill',
            source: 'nepal-mask',
            paint: {
              'fill-color': MASK_COLOR,
              'fill-opacity': 1,
            },
          })

          map.addLayer({
            id: 'nepal-boundary-line',
            type: 'line',
            source: 'nepal-boundary',
            paint: {
              'line-color': BORDER_COLOR,
              'line-width': 2,
              'line-opacity': 0.9,
            },
          })

          const bounds = boundsFromNepal(nepal)
          map.fitBounds(bounds, { padding: 24, animate: false })
          map.setMaxBounds([
            [bounds[0][0] - 0.8, bounds[0][1] - 0.8],
            [bounds[1][0] + 0.8, bounds[1][1] + 0.8],
          ])
        }

        if (map.isStyleLoaded()) applyOverlay()
        else map.once('load', applyOverlay)
      })
      .catch((err) => {
        console.error(err)
      })

    return () => {
      cancelled = true
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="map" aria-label="Nepal map" />
}
