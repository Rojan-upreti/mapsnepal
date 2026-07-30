import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const batchesDir = path.join(root, 'backend/json/open_buildings_batches')
const dbPath = path.join(root, 'backend/data/buildings.db')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`)
if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`)

const files = fs
  .readdirSync(batchesDir)
  .filter((name) => name.endsWith('.json'))
  .sort((a, b) => {
    const na = Number(a.match(/batch_(\d+)/)?.[1] ?? 0)
    const nb = Number(b.match(/batch_(\d+)/)?.[1] ?? 0)
    return na - nb
  })

if (files.length === 0) {
  console.error('No batch JSON files found in', batchesDir)
  process.exit(1)
}

console.log(`Importing ${files.length} batch files into ${dbPath}`)

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA synchronous = OFF;')
db.exec(`
  CREATE TABLE buildings (
    id INTEGER PRIMARY KEY,
    lng REAL NOT NULL,
    lat REAL NOT NULL,
    area REAL,
    confidence REAL,
    plus_code TEXT,
    batch TEXT,
    geometry TEXT
  );
`)

const insert = db.prepare(`
  INSERT INTO buildings (lng, lat, area, confidence, plus_code, batch, geometry)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

let total = 0

for (const file of files) {
  const full = path.join(batchesDir, file)
  const batch = path.basename(file, '.json')
  console.time(batch)
  const rows = JSON.parse(fs.readFileSync(full, 'utf8'))

  db.exec('BEGIN')
  for (const row of rows) {
    insert.run(
      row.longitude,
      row.latitude,
      row.area_in_meters,
      row.confidence,
      row.full_plus_code,
      batch,
      row.geometry,
    )
  }
  db.exec('COMMIT')

  total += rows.length
  console.timeEnd(batch)
  console.log(`  +${rows.length} (total ${total})`)
}

console.time('index')
db.exec('CREATE INDEX idx_buildings_lonlat ON buildings (lng, lat);')
console.timeEnd('index')

db.close()
console.log(`Done. Imported ${total} buildings.`)
