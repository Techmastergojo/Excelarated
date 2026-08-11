/**
 * db.js — IndexedDB wrapper using `idb` for persistent storage.
 * Stores: file handles, file metadata index, chat history, watched folders.
 */
import { openDB } from 'idb'

const DB_NAME    = 'ExceleratedDB'
const DB_VERSION = 1

let _db = null

async function getDB() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // File System Access handles (so we can re-open folders)
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles', { keyPath: 'id' })
      }
      // File metadata index
      if (!db.objectStoreNames.contains('files')) {
        const store = db.createObjectStore('files', { keyPath: 'path' })
        store.createIndex('keywords', 'keywords')
        store.createIndex('folder',   'folder')
      }
      // Chat sessions
      if (!db.objectStoreNames.contains('chats')) {
        const store = db.createObjectStore('chats', { keyPath: 'id', autoIncrement: true })
        store.createIndex('session', 'session')
      }
      // Settings
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings')
      }
    },
  })
  return _db
}

// ── Handles ──────────────────────────────────────────────────
export async function saveHandle(key, handle) {
  const db = await getDB()
  await db.put('handles', { id: key, handle })
}

export async function getAllHandles() {
  const db = await getDB()
  return db.getAll('handles')
}

export async function deleteHandle(key) {
  const db = await getDB()
  await db.delete('handles', key)
}

// ── File index ────────────────────────────────────────────────
export async function upsertFile(info) {
  const db = await getDB()
  await db.put('files', info)
}

export async function getAllFiles() {
  const db = await getDB()
  return db.getAll('files')
}

export async function deleteFile(path) {
  const db = await getDB()
  await db.delete('files', path)
}

export async function clearFiles() {
  const db = await getDB()
  await db.clear('files')
}

export async function searchFiles(queryTerms, topK = 8) {
  const all = await getAllFiles()
  if (!queryTerms || queryTerms.length === 0) return all.slice(0, topK)

  const scored = all.map(f => {
    const haystack = `${f.filename} ${f.folder} ${f.keywords} ${f.columnNames}`.toLowerCase()
    let score = 0
    for (const t of queryTerms) {
      if (haystack.includes(t.toLowerCase())) score++
    }
    return { ...f, _score: score }
  }).filter(f => f._score > 0)

  scored.sort((a, b) => b._score - a._score || a.filename.localeCompare(b.filename))
  return scored.slice(0, topK)
}

// ── Chat ──────────────────────────────────────────────────────
export async function saveMessage(msg) {
  const db = await getDB()
  await db.add('chats', { ...msg, timestamp: Date.now() })
}

export async function getMessages(session = 'default', limit = 200) {
  const db = await getDB()
  const all = await db.getAllFromIndex('chats', 'session', session)
  return all.sort((a, b) => a.id - b.id).slice(-limit)
}

export async function clearMessages(session = 'default') {
  const db = await getDB()
  const msgs = await db.getAllFromIndex('chats', 'session', session)
  for (const m of msgs) await db.delete('chats', m.id)
}

// ── Settings ──────────────────────────────────────────────────
export async function getSetting(key, def = null) {
  const db = await getDB()
  const val = await db.get('settings', key)
  return val ?? def
}

export async function setSetting(key, value) {
  const db = await getDB()
  await db.put('settings', value, key)
}
