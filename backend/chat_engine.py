"""
Chat Engine: the brain of Excelarated.
Interprets natural language, searches memory for relevant files,
executes queries, and generates responses + Excel outputs.
"""
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import memory
import scanner
from excel_builder import build_excel, EXPORTS_DIR


# ── Date parsing helpers ──────────────────────────────────
MONTH_MAP = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6,
    "july": 7, "jul": 7, "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}

def _parse_date_range(text: str) -> Tuple[Optional[str], Optional[str]]:
    """Extract start/end date strings from natural language text."""
    text_lower = text.lower()
    now = datetime.now()

    # "last N days/weeks/months"
    m = re.search(r"last\s+(\d+)\s+(day|week|month|year)s?", text_lower)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = {"day": 1, "week": 7, "month": 30, "year": 365}[unit]
        start = (now - timedelta(days=n * delta)).strftime("%Y-%m-%d")
        end   = now.strftime("%Y-%m-%d")
        return start, end

    # "from Jan 2024 to Mar 2024" or "from 2024-01-01 to 2024-03-31"
    from_match = re.search(
        r"from\s+([a-z]+\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
        text_lower
    )
    to_match = re.search(
        r"to\s+([a-z]+\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
        text_lower
    )

    def parse_fuzzy(s: str) -> Optional[str]:
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(s.strip(), fmt).strftime("%Y-%m-%d")
            except ValueError:
                pass
        # "Jan 2024"
        pm = re.match(r"([a-z]+)\s+(\d{4})", s.strip())
        if pm:
            month_name, year = pm.group(1), int(pm.group(2))
            month = MONTH_MAP.get(month_name)
            if month:
                return f"{year}-{month:02d}-01"
        return None

    start = parse_fuzzy(from_match.group(1)) if from_match else None
    end   = parse_fuzzy(to_match.group(1))   if to_match   else None
    return start, end


# ── Column fuzzy finder ───────────────────────────────────
def _find_col(df: pd.DataFrame, term: str) -> Optional[str]:
    t = term.lower().replace(" ", "").replace("_", "")
    for c in df.columns:
        cc = str(c).lower().replace(" ", "").replace("_", "")
        if t == cc or t in cc or cc in t:
            return c
    return None


def _find_date_col(df: pd.DataFrame) -> Optional[str]:
    date_words = ["date", "time", "created", "updated", "start", "end", "from", "to", "timestamp"]
    for c in df.columns:
        cl = str(c).lower()
        if any(w in cl for w in date_words):
            return c
    # Fallback: detect by trying to parse
    for c in df.columns:
        try:
            sample = df[c].dropna().head(5)
            pd.to_datetime(sample)
            return c
        except Exception:
            pass
    return None


# ── Intent detection ─────────────────────────────────────
def _detect_intent(text: str) -> str:
    tl = text.lower()
    if any(w in tl for w in ["create", "make", "generate", "build", "export", "save", "new file", "new excel", "produce", "give me"]):
        return "create"
    if any(w in tl for w in ["chart", "graph", "plot", "visualize", "bar", "line", "pie"]):
        return "chart"
    if any(w in tl for w in ["total", "sum", "count", "how many", "average", "avg", "mean", "max", "min"]):
        return "aggregate"
    if any(w in tl for w in ["filter", "where", "find", "show", "get", "extract", "list", "which"]):
        return "filter"
    if any(w in tl for w in ["merge", "combine", "join", "consolidate", "together"]):
        return "merge"
    return "query"


# ── Main chat processing ─────────────────────────────────
def process_message(user_message: str) -> Dict[str, Any]:
    """
    Process a natural language message and return a structured response:
    {
        answer: str,
        type: str,
        rows: [...],
        columns: [...],
        row_count: int,
        output_file: str | None,   # filename (in exports/) if created
        files_used: [str],         # paths of source files used
        suggestions: [str],        # follow-up suggestions
    }
    """
    # Save user message
    memory.save_message("user", user_message)

    intent = _detect_intent(user_message)
    start_date, end_date = _parse_date_range(user_message)

    # ── Step 1: Find relevant files ───────────────────────
    relevant = memory.search_files(user_message, top_k=5)

    if not relevant:
        # No files found — maybe index is empty
        resp = _no_files_response()
        memory.save_message("assistant", resp["answer"], {"type": resp["type"]})
        return resp

    # ── Step 2: Load files ────────────────────────────────
    dfs = {}
    for f in relevant:
        try:
            df = scanner.load_file(f["path"])
            if not df.empty:
                dfs[f["path"]] = {"df": df, "meta": f}
        except Exception:
            continue

    if not dfs:
        resp = {
            "answer": "I found matching files but couldn't read them. They may be open in Excel or corrupted.",
            "type": "error", "rows": [], "columns": [], "row_count": 0,
            "output_file": None, "files_used": [], "suggestions": [],
        }
        memory.save_message("assistant", resp["answer"])
        return resp

    # ── Step 3: Apply date filter if dates were extracted ─
    for path, item in dfs.items():
        df = item["df"]
        if start_date or end_date:
            date_col = _find_date_col(df)
            if date_col:
                try:
                    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
                    if start_date:
                        df = df[df[date_col] >= pd.Timestamp(start_date)]
                    if end_date:
                        df = df[df[date_col] <= pd.Timestamp(end_date)]
                    item["df"] = df
                    item["date_col"] = date_col
                except Exception:
                    pass

    # ── Step 4: Apply content filter from message ─────────
    filter_terms = _extract_filter_terms(user_message)
    for path, item in dfs.items():
        df = item["df"]
        for col_term, op, val in filter_terms:
            col = _find_col(df, col_term)
            if col:
                try:
                    nv = float(val.replace(",", ""))
                    is_num = True
                except ValueError:
                    is_num = False

                if op in ("is", "=", "equals"):
                    if is_num:
                        df = df[pd.to_numeric(df[col], errors="coerce") == nv]
                    else:
                        df = df[df[col].astype(str).str.lower() == val.lower()]
                elif op in ("contains", "like"):
                    df = df[df[col].astype(str).str.lower().str.contains(val.lower(), na=False)]
                elif op in (">", "over", "more than"):
                    if is_num:
                        df = df[pd.to_numeric(df[col], errors="coerce") > nv]
                elif op in ("<", "under", "less than"):
                    if is_num:
                        df = df[pd.to_numeric(df[col], errors="coerce") < nv]
                item["df"] = df

    # ── Step 5: Aggregate if needed ───────────────────────
    combined_rows = []
    for path, item in dfs.items():
        df_part = item["df"].copy()
        df_part["__source__"] = item["meta"]["filename"]
        combined_rows.append(df_part)

    if combined_rows:
        combined = pd.concat(combined_rows, ignore_index=True)
    else:
        combined = pd.DataFrame()

    files_used = [item["meta"]["path"] for item in dfs.values()]
    files_used_names = [item["meta"]["filename"] for item in dfs.values()]

    # ── Step 6: Aggregate queries ─────────────────────────
    if intent == "aggregate" and not combined.empty:
        agg_result, agg_answer = _do_aggregate(combined, user_message)
        result_df = agg_result
        answer = agg_answer
    else:
        result_df = combined
        rows_found = len(combined)

        date_note = ""
        if start_date or end_date:
            date_note = f" (filtered: {start_date or '...'} → {end_date or '...'})"

        if rows_found == 0:
            answer = f"I searched {len(dfs)} file(s) but found no matching rows{date_note}. Try broadening your search."
        else:
            answer = f"Found **{rows_found:,} rows** across **{len(dfs)} file(s)**{date_note}: {', '.join(files_used_names)}."

    # ── Step 7: Create Excel output if requested ──────────
    output_file = None
    output_filename = None

    if intent == "create" or "new file" in user_message.lower() or "excel" in user_message.lower():
        if not result_df.empty:
            # Generate nice filename from the message
            name_match = re.search(r"(?:called|named|save as|file name)\s+[\"']?([a-zA-Z0-9_ \-]+)[\"']?", user_message, re.IGNORECASE)
            if name_match:
                base_name = name_match.group(1).strip().replace(" ", "_")
            else:
                ts = datetime.now().strftime("%Y%m%d_%H%M")
                base_name = f"excelarated_output_{ts}"

            # Build the Excel
            try:
                summary = f"Query: {user_message}\nGenerated: {datetime.now().strftime('%Y-%m-%d %H:%M')}\nRows: {len(result_df):,}\nSources: {', '.join(files_used_names)}"
                out_path = build_excel(
                    dfs={"Data": result_df.drop(columns=["__source__"], errors="ignore")},
                    output_name=base_name,
                    title=f"Excelarated: {user_message[:60]}",
                    summary_text=summary,
                    add_charts=True,
                )
                output_file = os.path.basename(out_path)
                output_filename = output_file
                answer += f"\n\nI've created the Excel file **{output_file}** with {len(result_df):,} rows. Click below to download it."
            except Exception as e:
                answer += f"\n\n(Could not create Excel file: {e})"

    # ── Step 8: Suggestions ───────────────────────────────
    suggestions = _generate_suggestions(result_df, user_message, intent)

    # Clean for serialization
    preview_df = result_df.head(200).replace({np.nan: None})
    if "__source__" in preview_df.columns:
        preview_df = preview_df.drop(columns=["__source__"])

    result = {
        "answer": answer,
        "type": intent,
        "rows": preview_df.to_dict(orient="records"),
        "columns": list(preview_df.columns),
        "row_count": len(result_df),
        "output_file": output_filename,
        "files_used": files_used_names,
        "suggestions": suggestions,
    }
    memory.save_message("assistant", answer, {
        "type": intent,
        "output_file": output_filename,
        "files_used": files_used_names,
    })
    return result


def _extract_filter_terms(text: str) -> List[Tuple[str, str, str]]:
    """Extract filter patterns like 'status is active', 'region contains North'."""
    pattern = re.compile(
        r"([a-zA-Z][a-zA-Z0-9_\s]{1,25}?)\s+"
        r"(is|are|=|contains|like|equals|over|under|more than|less than|greater than)\s+"
        r"([\"']?[a-zA-Z0-9_\s\.\-]{1,40}[\"']?)",
        re.IGNORECASE,
    )
    return [(m.group(1).strip(), m.group(2).strip().lower(), m.group(3).strip().strip("\"'"))
            for m in pattern.finditer(text)]


def _do_aggregate(df: pd.DataFrame, query: str) -> Tuple[pd.DataFrame, str]:
    tl = query.lower()
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != "__source__"]
    text_cols    = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c]) and c != "__source__"]

    # Try to find the target column from the query
    target_num_col = None
    for col in numeric_cols:
        if col.lower() in tl or any(w in tl for w in col.lower().split("_")):
            target_num_col = col
            break
    target_num_col = target_num_col or (numeric_cols[0] if numeric_cols else None)

    # Group by text column?
    group_match = re.search(r"(?:by|per|grouped by|group by)\s+([a-zA-Z][a-zA-Z0-9_\s]{1,25})", tl)
    group_col = None
    if group_match:
        group_col = _find_col(df, group_match.group(1).strip())

    if group_col and target_num_col:
        if "count" in tl or "how many" in tl:
            result = df.groupby(group_col).size().reset_index(name="Count")
            answer = f"Count grouped by **{group_col}**: {len(result)} groups."
        elif "average" in tl or "avg" in tl or "mean" in tl:
            result = df.groupby(group_col)[target_num_col].mean().reset_index()
            result[target_num_col] = result[target_num_col].round(2)
            answer = f"Average of **{target_num_col}** grouped by **{group_col}**."
        else:
            result = df.groupby(group_col)[target_num_col].sum().reset_index()
            answer = f"Total of **{target_num_col}** grouped by **{group_col}**."
        return result, answer

    # No grouping — single-value aggregate
    if target_num_col:
        if "average" in tl or "avg" in tl or "mean" in tl:
            val = df[target_num_col].mean()
            return pd.DataFrame(), f"The **average of {target_num_col}** is **{val:,.2f}**."
        if "max" in tl or "highest" in tl or "largest" in tl:
            val = df[target_num_col].max()
            return pd.DataFrame(), f"The **maximum of {target_num_col}** is **{val:,.2f}**."
        if "min" in tl or "lowest" in tl or "smallest" in tl:
            val = df[target_num_col].min()
            return pd.DataFrame(), f"The **minimum of {target_num_col}** is **{val:,.2f}**."
        val = df[target_num_col].sum()
        return pd.DataFrame(), f"The **total of {target_num_col}** is **{val:,.2f}**."

    count = len(df)
    return df, f"There are **{count:,} rows** matching your criteria."


def _generate_suggestions(df: pd.DataFrame, query: str, intent: str) -> List[str]:
    suggestions = []
    if df.empty:
        return ["Try scanning more folders to find more data files"]

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != "__source__"]
    text_cols    = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c]) and c != "__source__"]

    if numeric_cols:
        suggestions.append(f"Create a chart of {numeric_cols[0]}")
        suggestions.append(f"Show total {numeric_cols[0]}" + (f" by {text_cols[0]}" if text_cols else ""))
    if text_cols:
        suggestions.append(f"Group results by {text_cols[0]}")
    if intent != "create":
        suggestions.append("Create a new Excel file with this data")
    return suggestions[:3]


def _no_files_response() -> Dict[str, Any]:
    return {
        "answer": "I don't have any files indexed yet! Click the **Scan Folders** button in the sidebar to let me discover your Excel and CSV files. I'll automatically search your Desktop, Documents, OneDrive, and Downloads.",
        "type": "info",
        "rows": [], "columns": [], "row_count": 0,
        "output_file": None, "files_used": [],
        "suggestions": ["Scan my folders for Excel files"],
    }
