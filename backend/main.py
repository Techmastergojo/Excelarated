import io
import os
import sys
import shutil
import tempfile
import uuid
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from data_engine import DataEngine
from ml_trainer import MLTrainer

# ─────────────────────────────────────────────────
# Path setup — works both as .py and as .exe
# ─────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    # Running as PyInstaller .exe
    BASE_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = BASE_DIR

DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_DIST = os.path.join(BUNDLE_DIR, "frontend_dist")

os.makedirs(DATA_DIR, exist_ok=True)

engine = DataEngine(DATA_DIR)
trainer = MLTrainer()

app = FastAPI(title="Excelarated API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────
# Request/Response Models
# ─────────────────────────────────────────────────
class MergeRequest(BaseModel):
    files: List[str]
    column_maps: Optional[Dict[str, Dict[str, str]]] = {}
    merge_type: str = "concat"  # 'concat' | 'join'
    output_filename: str = "merged_output.xlsx"


class CleanRequest(BaseModel):
    filename: str
    options: Dict[str, Any]
    save_as: Optional[str] = None


class QueryRequest(BaseModel):
    filenames: List[str]
    query: str


class TrainRequest(BaseModel):
    filename: str
    target_col: str
    feature_cols: Optional[List[str]] = None
    algorithm: str = "random_forest"  # 'random_forest' | 'gradient_boosting'
    save_predictions_as: Optional[str] = None


class SaveRequest(BaseModel):
    filename: str
    rows: List[Dict[str, Any]]
    columns: List[str]
    output_filename: str


# ─────────────────────────────────────────────────
# File Management
# ─────────────────────────────────────────────────
@app.get("/api/files")
def list_files():
    return engine.list_files()


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".xlsx", ".xls", ".csv"]:
        raise HTTPException(400, "Only .xlsx, .xls or .csv files are supported.")

    safe_name = file.filename.replace(" ", "_")
    dest = os.path.join(DATA_DIR, safe_name)

    contents = await file.read()
    with open(dest, "wb") as f:
        f.write(contents)

    meta = engine.get_metadata(safe_name)
    return {"message": "Uploaded successfully", "metadata": meta}


@app.get("/api/file/{filename}/metadata")
def get_metadata(filename: str):
    try:
        return engine.get_metadata(filename)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/file/{filename}")
def delete_file(filename: str):
    path = engine.get_file_path(filename)
    if not os.path.exists(path):
        raise HTTPException(404, "File not found.")
    os.remove(path)
    return {"message": f"'{filename}' deleted."}


@app.get("/api/file/{filename}/download")
def download_file(filename: str):
    path = engine.get_file_path(filename)
    if not os.path.exists(path):
        raise HTTPException(404, "File not found.")
    return FileResponse(path, filename=filename)


# ─────────────────────────────────────────────────
# Data Operations
# ─────────────────────────────────────────────────
@app.post("/api/merge")
def merge_files(req: MergeRequest):
    try:
        result_df = engine.merge_files(req.files, req.column_maps or {}, req.merge_type)
        saved_name = engine.save_file(result_df, req.output_filename)
        meta = engine.get_metadata(saved_name)
        return {"message": f"Merged {len(req.files)} files into '{saved_name}'.", "metadata": meta}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/clean")
def clean_data(req: CleanRequest):
    try:
        df = engine.load_file(req.filename)
        cleaned_df, report = engine.clean_data(df, req.options)
        save_name = req.save_as or req.filename
        engine.save_file(cleaned_df, save_name)
        meta = engine.get_metadata(save_name)
        return {
            "message": "Cleaning complete.",
            "report": report,
            "metadata": meta,
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/query")
def query_data(req: QueryRequest):
    try:
        result = engine.query_data(req.filenames, req.query)
        return result
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/save")
def save_edited_data(req: SaveRequest):
    """Save manually edited rows back to a file."""
    try:
        df = pd.DataFrame(req.rows, columns=req.columns)
        saved = engine.save_file(df, req.output_filename)
        return {"message": f"Saved to '{saved}'.", "filename": saved}
    except Exception as e:
        raise HTTPException(400, str(e))


# ─────────────────────────────────────────────────
# Machine Learning
# ─────────────────────────────────────────────────
@app.post("/api/train")
def train_model(req: TrainRequest):
    try:
        df = engine.load_file(req.filename)
        result = trainer.train(df, req.target_col, req.feature_cols, req.algorithm)

        if req.save_predictions_as:
            pred_df = pd.DataFrame(result["predictions"])
            engine.save_file(pred_df, req.save_predictions_as)
            result["saved_as"] = req.save_predictions_as

        return result
    except Exception as e:
        raise HTTPException(400, str(e))


# ─────────────────────────────────────────────────
# Serve React Frontend (production / .exe mode)
# ─────────────────────────────────────────────────
if os.path.exists(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


# ─────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────
if __name__ == "__main__":
    import webbrowser
    import threading

    def open_browser():
        import time
        time.sleep(1.5)
        webbrowser.open("http://localhost:8765")

    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
