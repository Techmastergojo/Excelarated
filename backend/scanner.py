"""
File Scanner: discovers Excel/CSV files in watched folders and indexes them
into the SQLite memory. Designed to be fast, safe, and antivirus-friendly —
it only READS files using standard Python file I/O.
"""
import os
import re
import json
from datetime import datetime
from typing import List, Dict, Any, Callable

import pandas as pd
import numpy as np

import memory

SUPPORTED_EXT = {".xlsx", ".xls", ".csv"}
SKIP_DIRS = {
    "node_modules", "__pycache__", ".git", "venv", ".venv",
    "AppData", "ProgramData", "Windows", "Program Files",
    "Program Files (x86)", "$Recycle.Bin", "System Volume Information",
    ".Trash", "build_tmp", "dist_exe", "build",
}
MAX_DEPTH = 6


def _should_skip(dirname: str) -> bool:
    return dirname in SKIP_DIRS or dirname.startswith(".")


def discover_files(root: str, depth: int = 0) -> List[str]:
    """Walk directory tree and collect all Excel/CSV file paths."""
    found = []
    if depth > MAX_DEPTH:
        return found
    try:
        entries = os.scandir(root)
    except PermissionError:
        return found

    for entry in entries:
        try:
            if entry.is_dir(follow_symlinks=False):
                if not _should_skip(entry.name):
                    found.extend(discover_files(entry.path, depth + 1))
            elif entry.is_file():
                ext = os.path.splitext(entry.name)[1].lower()
                if ext in SUPPORTED_EXT:
                    found.append(entry.path)
        except (PermissionError, OSError):
            continue
    return found


def _load_preview(filepath: str, max_rows: int = 500) -> pd.DataFrame:
    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext in (".xlsx", ".xls"):
            return pd.read_excel(filepath, nrows=max_rows)
        elif ext == ".csv":
            # Try common encodings
            for enc in ("utf-8", "latin-1", "cp1252"):
                try:
                    return pd.read_csv(filepath, nrows=max_rows, encoding=enc, on_bad_lines="skip")
                except (UnicodeDecodeError, Exception):
                    continue
    except Exception:
        pass
    return pd.DataFrame()


def _extract_info(filepath: str) -> Dict[str, Any]:
    filename = os.path.basename(filepath)
    folder   = os.path.dirname(filepath)
    size_kb  = round(os.path.getsize(filepath) / 1024, 2)
    mtime    = datetime.fromtimestamp(os.path.getmtime(filepath)).isoformat()

    df = _load_preview(filepath)
    if df.empty:
        return {
            "path": filepath, "filename": filename, "folder": folder,
            "size_kb": size_kb, "row_count": 0, "col_count": 0,
            "columns": [], "keywords": filename.lower().replace("_", " ").replace("-", " "),
            "last_modified": mtime,
        }

    columns_info = []
    keywords_set = set()

    # Add filename words as keywords
    for word in re.split(r"[\W_]+", filename.lower()):
        if len(word) > 2:
            keywords_set.add(word)

    # Add folder name keywords (last 2 levels)
    folder_parts = folder.replace("\\", "/").split("/")
    for part in folder_parts[-2:]:
        for word in re.split(r"[\W_]+", part.lower()):
            if len(word) > 2:
                keywords_set.add(word)

    for col in df.columns:
        non_null = df[col].dropna()
        sample_vals = non_null.head(3).tolist()
        sample_strs = [str(v)[:50] for v in sample_vals]

        if pd.api.types.is_datetime64_any_dtype(df[col]):
            col_type = "datetime"
        elif pd.api.types.is_numeric_dtype(df[col]):
            col_type = "numeric"
        else:
            col_type = "text"

        columns_info.append({
            "name": str(col),
            "type": col_type,
            "null_count": int(df[col].isna().sum()),
            "unique": int(df[col].nunique()),
            "sample": sample_strs,
        })

        # Add column name words as keywords
        for word in re.split(r"[\W_]+", str(col).lower()):
            if len(word) > 2:
                keywords_set.add(word)

        # Add unique text values as keywords (only small cardinality)
        if col_type == "text" and df[col].nunique() < 50:
            for val in non_null.unique():
                for word in re.split(r"[\W_]+", str(val).lower()):
                    if len(word) > 2:
                        keywords_set.add(word)

    return {
        "path": filepath,
        "filename": filename,
        "folder": folder,
        "size_kb": size_kb,
        "row_count": len(df),
        "col_count": len(df.columns),
        "columns": columns_info,
        "keywords": " ".join(sorted(keywords_set)),
        "last_modified": mtime,
    }


def scan_folders(
    folders: List[str] = None,
    progress_cb: Callable[[str, int, int], None] = None,
) -> Dict[str, Any]:
    """
    Scan all watched folders for Excel/CSV files and update the memory index.
    progress_cb(current_file, index, total) is called for each file processed.
    Returns summary dict.
    """
    if folders is None:
        folders = memory.get_watched_folders()

    # Collect all files
    all_paths = []
    for folder in folders:
        if os.path.exists(folder):
            all_paths.extend(discover_files(folder))

    # Deduplicate
    all_paths = list(set(all_paths))
    total = len(all_paths)
    indexed = 0
    errors  = 0

    for i, path in enumerate(all_paths):
        if progress_cb:
            progress_cb(os.path.basename(path), i + 1, total)
        try:
            info = _extract_info(path)
            memory.upsert_file(info)
            indexed += 1
        except Exception as e:
            errors += 1

    # Remove stale entries
    removed = memory.remove_missing_files()

    return {
        "total_found": total,
        "indexed": indexed,
        "errors": errors,
        "removed_stale": removed,
        "folders_scanned": folders,
    }


def load_file(filepath: str) -> pd.DataFrame:
    """Load a full file from disk."""
    return _load_preview(filepath, max_rows=100_000)
