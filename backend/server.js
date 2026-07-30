import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import cors from 'cors'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, 'data', 'buildings.db')
const PORT = Number(process.env.PORT) || 3001

const app = express()
app.use(cors())

let db
try {
  db = new DatabaseSync(dbPath, { readOnly: true })
} catch (err) {
  console.error(`Could not open ${dbPath}`)
  console.error('Run: npm run import-buildings')
  console.error(err.message)
  process.exit(1)
}

const countRow = db.prepare('SELECT COUNT(*) AS n FROM buildings').get()
console.log(`Buildings DB ready: ${Number(countRow.n).toLocaleString()} features`)

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

const aggregateStmt = db.prepare(`
  SELECT
    ROUND(lng, ?) AS lng,
    ROUND(lat, ?) AS lat,
    COUNT(*) AS point_count
  FROM buildings
  WHERE lng BETWEEN ? AND ?
    AND lat BETWEEN ? AND ?
  GROUP BY 1, 2
  LIMIT ?
`)

const pointsStmt = db.prepare(`
  SELECT id, lng, lat, area, confidence, plus_code, batch
  FROM buildings
  WHERE lng BETWEEN ? AND ?
    AND lat BETWEEN ? AND ?
  LIMIT ?
`)

const polygonsStmt = db.prepare(`
  SELECT id, lng, lat, area, confidence, plus_code, batch, geometry
  FROM buildings
  WHERE lng BETWEEN ? AND ?
    AND lat BETWEEN ? AND ?
  LIMIT ?
`)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, buildings: countRow.n })
})

app.get('/api/buildings', (req, res) => {
  const west = Number(req.query.west)
  const south = Number(req.query.south)
  const east = Number(req.query.east)
  const north = Number(req.query.north)
  const zoom = Number(req.query.z ?? 7)

  if (![west, south, east, north].every(Number.isFinite)) {
    res.status(400).json({ error: 'west,south,east,north required' })
    return
  }

  if (zoom < 11) {
    const precision = zoom < 8 ? 1 : zoom < 10 ? 2 : 3
    const rows = aggregateStmt.all(precision, precision, west, east, south, north, 8000)
    res.json({
      type: 'FeatureCollection',
      mode: 'aggregate',
      features: rows.map((row) => ({
        type: 'Feature',
        properties: { point_count: row.point_count },
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
      })),
    })
    return
  }

  if (zoom < 14) {
    const rows = pointsStmt.all(west, east, south, north, 12000)
    res.json({
      type: 'FeatureCollection',
      mode: 'points',
      features: rows.map((row) => ({
        type: 'Feature',
        properties: {
          id: row.id,
          area_in_meters: row.area,
          confidence: row.confidence,
          full_plus_code: row.plus_code,
          batch: row.batch,
        },
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
      })),
    })
    return
  }

  const rows = polygonsStmt.all(west, east, south, north, 6000)
  res.json({
    type: 'FeatureCollection',
    mode: 'polygons',
    features: rows.flatMap((row) => {
      const coordinates = parseWktPolygon(row.geometry)
      if (!coordinates) return []
      return [
        {
          type: 'Feature',
          properties: {
            id: row.id,
            area_in_meters: row.area,
            confidence: row.confidence,
            full_plus_code: row.plus_code,
            batch: row.batch,
          },
          geometry: { type: 'Polygon', coordinates },
        },
      ]
    }),
  })
})

app.listen(PORT, () => {
  console.log(`MapsNepal API http://localhost:${PORT}`)
})
