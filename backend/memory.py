"""
Memory module: SQLite-based index of all discovered Excel/CSV files.
Stores file paths, column schemas, and sample data so the AI can
answer questions without loading every file every time.
"""
import sqlite3
import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional


DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS files (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT UNIQUE NOT NULL,
            filename    TEXT NOT NULL,
            folder      TEXT NOT NULL,
            size_kb     REAL,
            row_count   INTEGER,
            col_count   INTEGER,
            columns     TEXT,   -- JSON list of {name, type, sample}
            keywords    TEXT,   -- space-separated searchable keywords
            last_scanned TEXT,
            last_modified TEXT
        );

        CREATE TABLE IF NOT EXISTS watched_folders (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            path    TEXT UNIQUE NOT NULL,
            added   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_history (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            role      TEXT NOT NULL,
            content   TEXT NOT NULL,
            metadata  TEXT,   -- JSON: {files_used, output_file, type}
            timestamp TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    conn.commit()

    # Default watched folders
    defaults = [
        os.path.expanduser("~/Desktop"),
        os.path.expanduser("~/Documents"),
        os.path.expanduser("~/Downloads"),
        os.path.expanduser("~/OneDrive"),
        os.path.expanduser("~/OneDrive/Desktop"),
        os.path.expanduser("~/OneDrive/Documents"),
    ]
    for folder in defaults:
        if os.path.exists(folder):
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO watched_folders (path, added) VALUES (?, ?)",
                    (folder, datetime.now().isoformat())
                )
            except Exception:
                pass
    conn.commit()
    conn.close()


# ── Watched folders ──────────────────────────────────────────
def get_watched_folders() -> List[str]:
    conn = get_conn()
    rows = conn.execute("SELECT path FROM watched_folders").fetchall()
    conn.close()
    return [r["path"] for r in rows]


def add_watched_folder(path: str):
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO watched_folders (path, added) VALUES (?, ?)",
        (path, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def remove_watched_folder(path: str):
    conn = get_conn()
    conn.execute("DELETE FROM watched_folders WHERE path = ?", (path,))
    conn.commit()
    conn.close()


# ── File index ───────────────────────────────────────────────
def upsert_file(info: Dict[str, Any]):
    conn = get_conn()
    conn.execute("""
        INSERT INTO files
            (path, filename, folder, size_kb, row_count, col_count, columns, keywords, last_scanned, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            filename     = excluded.filename,
            folder       = excluded.folder,
            size_kb      = excluded.size_kb,
            row_count    = excluded.row_count,
            col_count    = excluded.col_count,
            columns      = excluded.columns,
            keywords     = excluded.keywords,
            last_scanned = excluded.last_scanned,
            last_modified= excluded.last_modified
    """, (
        info["path"],
        info["filename"],
        info["folder"],
        info.get("size_kb", 0),
        info.get("row_count", 0),
        info.get("col_count", 0),
        json.dumps(info.get("columns", [])),
        info.get("keywords", ""),
        datetime.now().isoformat(),
        info.get("last_modified", ""),
    ))
    conn.commit()
    conn.close()


def remove_missing_files():
    """Remove files from index that no longer exist on disk."""
    conn = get_conn()
    rows = conn.execute("SELECT path FROM files").fetchall()
    removed = 0
    for row in rows:
        if not os.path.exists(row["path"]):
            conn.execute("DELETE FROM files WHERE path = ?", (row["path"],))
            removed += 1
    conn.commit()
    conn.close()
    return removed


def get_all_files() -> List[Dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM files ORDER BY last_scanned DESC").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["columns"] = json.loads(d["columns"] or "[]")
        result.append(d)
    return result


def search_files(query: str, top_k: int = 5) -> List[Dict]:
    """
    Find files relevant to a natural language query.
    Searches filename, folder, and column keywords.
    """
    terms = [t.lower().strip() for t in query.split() if len(t) > 2]
    conn = get_conn()
    all_files = conn.execute("SELECT * FROM files").fetchall()
    conn.close()

    scored = []
    for row in all_files:
        score = 0
        combined = (
            (row["filename"] or "").lower() + " " +
            (row["folder"] or "").lower() + " " +
            (row["keywords"] or "").lower()
        )
        for term in terms:
            if term in combined:
                score += 1
        if score > 0:
            d = dict(row)
            d["columns"] = json.loads(d["columns"] or "[]")
            d["_score"] = score
            scored.append(d)

    # Sort by relevance score then by recency
    scored.sort(key=lambda x: (-x["_score"], x["filename"]))
    return scored[:top_k]


# ── Chat history ─────────────────────────────────────────────
def save_message(role: str, content: str, metadata: Dict = None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO chat_history (role, content, metadata, timestamp) VALUES (?, ?, ?, ?)",
        (role, content, json.dumps(metadata or {}), datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def get_history(limit: int = 50) -> List[Dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM chat_history ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    result = []
    for r in reversed(rows):
        d = dict(r)
        d["metadata"] = json.loads(d["metadata"] or "{}")
        result.append(d)
    return result


def clear_history():
    conn = get_conn()
    conn.execute("DELETE FROM chat_history")
    conn.commit()
    conn.close()
