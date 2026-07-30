import fs from 'node:fs'
import path from 'node:path'

const inputs = process.argv.slice(2)
const files =
  inputs.length > 0
    ? inputs
    : [
        'backend/json_plot/open_buildings_batch_1.json',
        'backend/json_plot/open_buildings_batch_10.json',
        'backend/json_plot/open_buildings_batch_100.json',
      ]

const outPoly = 'frontend/public/data/open_buildings.geojson'
const outPts = 'frontend/public/data/open_buildings_points.geojson'

function parseWktPolygon(wkt) {
  const match = String(wkt).match(/POLYGON\s*\(\((.+)\)\)/i)
  if (!match) return null

  const ring = match[1].split(',').map((pair) => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number)
    return [lng, lat]
  })

  if (ring.length < 4) return null
  return [ring]
}

const polyFeatures = []
const pointFeatures = []
let skipped = 0

for (const input of files) {
  console.time(`load ${path.basename(input)}`)
  const rows = JSON.parse(fs.readFileSync(input, 'utf8'))
  console.timeEnd(`load ${path.basename(input)}`)

  const batch = path.basename(input, '.json')

  for (const row of rows) {
    const coordinates = parseWktPolygon(row.geometry)
    if (!coordinates) {
      skipped++
      continue
    }

    const properties = {
      area_in_meters: row.area_in_meters,
      confidence: row.confidence,
      full_plus_code: row.full_plus_code,
      batch,
    }

    polyFeatures.push({
      type: 'Feature',
      properties,
      geometry: { type: 'Polygon', coordinates },
    })

    pointFeatures.push({
      type: 'Feature',
      properties,
      geometry: {
        type: 'Point',
        coordinates: [row.longitude, row.latitude],
      },
    })
  }
}

console.time('write')
fs.writeFileSync(
  outPoly,
  JSON.stringify({ type: 'FeatureCollection', features: polyFeatures }),
)
fs.writeFileSync(
  outPts,
  JSON.stringify({ type: 'FeatureCollection', features: pointFeatures }),
)
console.timeEnd('write')

console.log('features', polyFeatures.length, 'skipped', skipped)
console.log('polyMB', (fs.statSync(outPoly).size / 1024 / 1024).toFixed(2))
console.log('ptsMB', (fs.statSync(outPts).size / 1024 / 1024).toFixed(2))
