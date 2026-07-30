import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const MASK_COLOR = '#dce3ea'
const BORDER_COLOR = '#1a3a52'
const BUILDING_FILL = '#c45c26'
const BUILDING_STROKE = '#7a2e0e'
const BUILDING_LAYER_IDS = ['building', 'building-3d']
const STYLE_URL = '/data/liberty-style.json'
const NEPAL_CENTER: [number, number] = [84.124, 28.3949]
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

type NepalGeoJSON = GeoJSON.FeatureCollection

type BuildingsResponse = GeoJSON.FeatureCollection & {
  mode?: 'aggregate' | 'points' | 'polygons'
}

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

function hideBasemapBuildings(map: maplibregl.Map) {
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

function setupBuildingLayers(map: maplibregl.Map, beforeId?: string) {
  if (map.getSource('open-buildings')) return

  map.addSource('open-buildings', {
    type: 'geojson',
    data: EMPTY,
  })

  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined

  map.addLayer(
    {
      id: 'open-buildings-aggregate',
      type: 'circle',
      source: 'open-buildings',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': BUILDING_FILL,
        'circle-opacity': 0.72,
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'point_count'],
          1,
          8,
          100,
          14,
          1000,
          22,
          10000,
          34,
        ],
      },
    },
    before,
  )

  map.addLayer(
    {
      id: 'open-buildings-aggregate-count',
      type: 'symbol',
      source: 'open-buildings',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['to-string', ['get', 'point_count']],
        'text-size': 11,
      },
      paint: {
        'text-color': '#ffffff',
      },
    },
    before,
  )

  map.addLayer(
    {
      id: 'open-buildings-point',
      type: 'circle',
      source: 'open-buildings',
      filter: [
        'all',
        ['!', ['has', 'point_count']],
        ['==', ['geometry-type'], 'Point'],
      ],
      paint: {
        'circle-radius': 3,
        'circle-color': BUILDING_FILL,
        'circle-opacity': 0.85,
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#fff',
      },
    },
    before,
  )

  map.addLayer(
    {
      id: 'open-buildings-fill',
      type: 'fill',
      source: 'open-buildings',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': BUILDING_FILL,
        'fill-opacity': 0.65,
      },
    },
    before,
  )

  map.addLayer(
    {
      id: 'open-buildings-outline',
      type: 'line',
      source: 'open-buildings',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'line-color': BUILDING_STROKE,
        'line-width': 1,
        'line-opacity': 0.9,
      },
    },
    before,
  )

  const showPopup = (
    e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
  ) => {
    const feature = e.features?.[0]
    if (!feature) return
    const props = feature.properties ?? {}
    if (props.point_count != null) {
      map.easeTo({
        center: e.lngLat,
        zoom: Math.min(map.getZoom() + 2, 16),
      })
      return
    }

    const area = Number(props.area_in_meters)
    const confidence = Number(props.confidence)
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(
        [
          `<strong>Open Building</strong>`,
          props.batch ? `Batch: ${String(props.batch).replace('open_buildings_', '')}` : null,
          `Area: ${Number.isFinite(area) ? `${area.toFixed(1)} m²` : '—'}`,
          `Confidence: ${Number.isFinite(confidence) ? `${(confidence * 100).toFixed(1)}%` : '—'}`,
          `Plus code: ${props.full_plus_code ?? '—'}`,
        ]
          .filter(Boolean)
          .join('<br/>'),
      )
      .addTo(map)
  }

  map.on('click', 'open-buildings-aggregate', showPopup)
  map.on('click', 'open-buildings-point', showPopup)
  map.on('click', 'open-buildings-fill', showPopup)

  for (const layerId of [
    'open-buildings-aggregate',
    'open-buildings-point',
    'open-buildings-fill',
  ]) {
    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = ''
    })
  }
}

async function fetchBuildingsForView(map: maplibregl.Map): Promise<BuildingsResponse> {
  const bounds = map.getBounds()
  const params = new URLSearchParams({
    west: String(bounds.getWest()),
    south: String(bounds.getSouth()),
    east: String(bounds.getEast()),
    north: String(bounds.getNorth()),
    z: String(map.getZoom()),
  })
  const res = await fetch(`/api/buildings?${params}`)
  if (!res.ok) throw new Error(`Buildings API ${res.status}`)
  return res.json() as Promise<BuildingsResponse>
}

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [status, setStatus] = useState('Loading map…')

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false
    let fetchToken = 0
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
      hideBasemapBuildings(map)
    }

    map.on('load', onStyleReady)
    map.on('style.load', onStyleReady)

    map.on('error', (e) => {
      console.error('MapLibre error:', e.error)
    })

    const refreshBuildings = () => {
      if (cancelled || !map.getSource('open-buildings')) return
      const token = ++fetchToken
      setStatus('Loading buildings…')
      void fetchBuildingsForView(map)
        .then((data) => {
          if (cancelled || token !== fetchToken) return
          const source = map.getSource('open-buildings') as maplibregl.GeoJSONSource
          source.setData(data)
          setStatus('')
        })
        .catch((err) => {
          console.error(err)
          if (!cancelled && token === fetchToken) {
            setStatus('Buildings API offline — start backend')
          }
        })
    }

    fetch('/data/nepal.geojson')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load Nepal boundary')
        return res.json() as Promise<NepalGeoJSON>
      })
      .then((nepal) => {
        if (cancelled || !mapRef.current) return

        const applyOverlay = () => {
          if (cancelled || !map.getStyle()) return
          hideBasemapBuildings(map)
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

          setupBuildingLayers(map, 'nepal-mask-fill')

          const bounds = boundsFromNepal(nepal)
          map.fitBounds(bounds, { padding: 24, animate: false })
          map.setMaxBounds([
            [bounds[0][0] - 0.8, bounds[0][1] - 0.8],
            [bounds[1][0] + 0.8, bounds[1][1] + 0.8],
          ])

          map.on('moveend', refreshBuildings)
          refreshBuildings()
        }

        if (map.isStyleLoaded()) applyOverlay()
        else map.once('load', applyOverlay)
      })
      .catch((err) => {
        console.error(err)
        setStatus('Failed to load map data')
      })

    return () => {
      cancelled = true
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <>
      <div ref={containerRef} className="map" aria-label="Nepal map" />
      {status ? <div className="map-status">{status}</div> : null}
    </>
  )
}
