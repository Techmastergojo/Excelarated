import os
import re
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Tuple


class DataEngine:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)

    def get_file_path(self, filename: str) -> str:
        return os.path.join(self.data_dir, filename)

    def load_file(self, filename: str) -> pd.DataFrame:
        path = self.get_file_path(filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"File '{filename}' not found.")
        ext = os.path.splitext(filename)[1].lower()
        if ext in [".xlsx", ".xls"]:
            return pd.read_excel(path)
        elif ext == ".csv":
            return pd.read_csv(path)
        else:
            raise ValueError("Unsupported format. Use .xlsx, .xls or .csv")

    def save_file(self, df: pd.DataFrame, filename: str) -> str:
        path = self.get_file_path(filename)
        ext = os.path.splitext(filename)[1].lower()
        if ext in [".xlsx", ".xls"]:
            df.to_excel(path, index=False)
        elif ext == ".csv":
            df.to_csv(path, index=False)
        else:
            path = path + ".xlsx"
            df.to_excel(path, index=False)
        return os.path.basename(path)

    def get_metadata(self, filename: str) -> Dict[str, Any]:
        df = self.load_file(filename)
        df_clean = df.replace({np.nan: None})
        columns_info = []
        for col in df.columns:
            non_null = df[col].dropna()
            sample_val = non_null.iloc[0] if len(non_null) > 0 else None
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
                "unique_count": int(df[col].nunique()),
                "sample": str(sample_val) if sample_val is not None else None,
            })
        return {
            "filename": filename,
            "row_count": len(df),
            "column_count": len(df.columns),
            "columns": columns_info,
            "preview_rows": df_clean.head(200).to_dict(orient="records"),
        }

    def list_files(self) -> List[Dict[str, Any]]:
        files = []
        for f in os.listdir(self.data_dir):
            if f.lower().endswith((".xlsx", ".xls", ".csv")):
                fpath = os.path.join(self.data_dir, f)
                files.append({
                    "filename": f,
                    "size_kb": round(os.path.getsize(fpath) / 1024, 2),
                    "modified": os.path.getmtime(fpath),
                })
        return files

    def merge_files(
        self,
        files: List[str],
        column_maps: Dict[str, Dict[str, str]],
        merge_type: str = "concat",
    ) -> pd.DataFrame:
        """
        Merge multiple files. column_maps = {filename: {old_col: new_col}}
        merge_type: 'concat' (stack rows) | 'join' (merge on shared columns)
        """
        dfs = []
        for fname in files:
            df = self.load_file(fname)
            if fname in column_maps:
                df = df.rename(columns=column_maps[fname])
            dfs.append(df)

        if not dfs:
            raise ValueError("No valid files to merge.")

        if merge_type == "concat":
            return pd.concat(dfs, ignore_index=True)
        elif merge_type == "join":
            result = dfs[0]
            for next_df in dfs[1:]:
                shared = list(set(result.columns) & set(next_df.columns))
                if shared:
                    result = pd.merge(result, next_df, on=shared, how="outer")
                else:
                    result = pd.concat([result, next_df], ignore_index=True)
            return result
        else:
            raise ValueError(f"Unknown merge_type: {merge_type}")

    def clean_data(self, df: pd.DataFrame, options: Dict[str, Any]) -> Tuple[pd.DataFrame, List[str]]:
        report = []
        original_len = len(df)

        if options.get("remove_duplicates"):
            df = df.drop_duplicates()
            removed = original_len - len(df)
            if removed:
                report.append(f"Removed {removed} duplicate rows.")

        fill_num = options.get("fill_numeric_nan", "none")
        if fill_num != "none":
            for col in df.select_dtypes(include=[np.number]).columns:
                n = df[col].isna().sum()
                if n:
                    if fill_num == "mean":
                        df[col] = df[col].fillna(df[col].mean())
                    elif fill_num == "median":
                        df[col] = df[col].fillna(df[col].median())
                    elif fill_num == "zero":
                        df[col] = df[col].fillna(0)
                    report.append(f"Filled {n} missing values in '{col}' with {fill_num}.")

        fill_text = options.get("fill_text_nan", "none")
        if fill_text != "none":
            for col in df.select_dtypes(exclude=[np.number]).columns:
                n = df[col].isna().sum()
                if n:
                    if fill_text == "unknown":
                        df[col] = df[col].fillna("Unknown")
                    elif fill_text == "mode":
                        mode = df[col].mode()
                        df[col] = df[col].fillna(mode[0] if not mode.empty else "")
                    elif fill_text == "empty":
                        df[col] = df[col].fillna("")
                    report.append(f"Filled {n} missing text values in '{col}' with {fill_text}.")

        if options.get("trim_whitespace"):
            for col in df.select_dtypes(include=[object]).columns:
                df[col] = df[col].astype(str).str.strip()
            report.append("Trimmed whitespace from all text columns.")

        if options.get("standardize_dates"):
            date_keywords = ["date", "time", "created", "updated", "dob", "born"]
            for col in df.columns:
                if any(k in col.lower() for k in date_keywords):
                    try:
                        converted = pd.to_datetime(df[col], errors="coerce")
                        if converted.notna().sum() > 0:
                            df[col] = converted.dt.strftime("%Y-%m-%d")
                            report.append(f"Standardized dates in '{col}' to YYYY-MM-DD.")
                    except Exception:
                        pass

        if not report:
            report.append("No changes were needed or applied.")
        return df, report

    # ────────────────────────────────────────────────────────
    # NATURAL LANGUAGE QUERY ENGINE
    # ────────────────────────────────────────────────────────
    def _find_col(self, df: pd.DataFrame, term: str):
        """Fuzzy column match."""
        t = term.lower().replace(" ", "").replace("_", "")
        for c in df.columns:
            cc = str(c).lower().replace(" ", "").replace("_", "")
            if t == cc or t in cc or cc in t:
                return c
        return None

    def query_data(
        self,
        filenames: List[str],
        query_text: str,
    ) -> Dict[str, Any]:
        """
        Execute a natural language query across one or more files.
        Returns {answer, rows, columns, type, export_df (serializable)}
        """
        # Load and (optionally) combine all files
        dfs = {f: self.load_file(f) for f in filenames}

        if len(filenames) == 1:
            df = list(dfs.values())[0]
        else:
            # Cross-file search: stack all files, add source column
            parts = []
            for fname, fdf in dfs.items():
                fdf = fdf.copy()
                fdf["__source_file__"] = fname
                parts.append(fdf)
            df = pd.concat(parts, ignore_index=True)

        query = query_text.strip()
        ql = query.lower()

        # ── 1. Aggregation: total / sum ──────────────────────
        m = re.search(r"\b(total|sum|add up)\b\s+(?:of\s+|the\s+)?(.+)", ql)
        if m:
            col = self._find_col(df, m.group(2).strip())
            if col and pd.api.types.is_numeric_dtype(df[col]):
                val = df[col].sum()
                return self._ans(f"The total of **{col}** is **{val:,.2f}**.", df, "aggregation")

        # ── 2. Aggregation: average / mean ───────────────────
        m = re.search(r"\b(average|avg|mean)\b\s+(?:of\s+|the\s+)?(.+)", ql)
        if m:
            col = self._find_col(df, m.group(2).strip())
            if col and pd.api.types.is_numeric_dtype(df[col]):
                val = df[col].mean()
                return self._ans(f"The average of **{col}** is **{val:,.2f}**.", df, "aggregation")

        # ── 3. Min / Max ──────────────────────────────────────
        m = re.search(r"\b(minimum|min|lowest|smallest)\b\s+(?:of\s+|the\s+)?(.+)", ql)
        if m:
            col = self._find_col(df, m.group(2).strip())
            if col and pd.api.types.is_numeric_dtype(df[col]):
                val = df[col].min()
                return self._ans(f"The minimum of **{col}** is **{val:,.2f}**.", df, "aggregation")

        m = re.search(r"\b(maximum|max|highest|largest)\b\s+(?:of\s+|the\s+)?(.+)", ql)
        if m:
            col = self._find_col(df, m.group(2).strip())
            if col and pd.api.types.is_numeric_dtype(df[col]):
                val = df[col].max()
                return self._ans(f"The maximum of **{col}** is **{val:,.2f}**.", df, "aggregation")

        # ── 4. Count ──────────────────────────────────────────
        m = re.search(r"\b(count|how many|number of)\b", ql)
        if m:
            return self._ans(f"There are **{len(df):,} rows** in the data.", df, "aggregation")

        # ── 5. Sort / Top N ──────────────────────────────────
        m = re.search(r"\b(top|best|highest)\s+(\d+)\b\s+(?:by\s+|in\s+)?(.+)?", ql)
        if m:
            n = int(m.group(2))
            col_term = (m.group(3) or "").strip()
            col = self._find_col(df, col_term)
            if col and pd.api.types.is_numeric_dtype(df[col]):
                result = df.nlargest(n, col)
                return self._ans(f"Top {n} rows by **{col}**:", result, "filter")

        m = re.search(r"\b(bottom|worst|lowest)\s+(\d+)\b\s+(?:by\s+|in\s+)?(.+)?", ql)
        if m:
            n = int(m.group(2))
            col_term = (m.group(3) or "").strip()
            col = self._find_col(df, col_term)
            if col and pd.api.types.is_numeric_dtype(df[col]):
                result = df.nsmallest(n, col)
                return self._ans(f"Bottom {n} rows by **{col}**:", result, "filter")

        # ── 6. Row filter ──────────────────────────────────────
        filter_pat = re.compile(
            r"(?:filter|where|find|show|get|extract|give me|list)\s+(.+?)\s+"
            r"(is|are|=|>|<|>=|<=|contains|like|equals|over|under|more than|less than)\s+(.+)",
            re.IGNORECASE,
        )
        m = filter_pat.search(query)
        if m:
            col_term = m.group(1).strip()
            op = m.group(2).strip().lower()
            val_str = m.group(3).strip().strip('"\'')
            col = self._find_col(df, col_term)
            if col:
                try:
                    num_val = float(val_str.replace(",", "").replace("$", ""))
                    is_num = True
                except ValueError:
                    num_val = None
                    is_num = False

                result = df
                if op in ("is", "=", "equals", "are"):
                    result = df[df[col].astype(str).str.lower() == val_str.lower()] if not is_num else df[df[col] == num_val]
                elif op in ("contains", "like"):
                    result = df[df[col].astype(str).str.lower().str.contains(val_str.lower(), na=False)]
                elif op in (">", "over", "more than"):
                    if is_num:
                        result = df[pd.to_numeric(df[col], errors="coerce") > num_val]
                elif op in ("<", "under", "less than"):
                    if is_num:
                        result = df[pd.to_numeric(df[col], errors="coerce") < num_val]
                elif op == ">=":
                    if is_num:
                        result = df[pd.to_numeric(df[col], errors="coerce") >= num_val]
                elif op == "<=":
                    if is_num:
                        result = df[pd.to_numeric(df[col], errors="coerce") <= num_val]

                msg = f"Filtered where **{col}** {op} '{val_str}'. Found **{len(result):,} rows**."
                return self._ans(msg, result, "filter")

        # ── 7. Group by + aggregate ────────────────────────────
        m = re.search(r"(?:group by|by)\s+(.+?)\s+(?:and\s+)?(sum|total|average|avg|count)\s+(?:of\s+)?(.+)?", ql)
        if m:
            grp_col = self._find_col(df, m.group(1).strip())
            agg_func = m.group(2).strip()
            num_col_term = (m.group(3) or "").strip()
            num_col = self._find_col(df, num_col_term) if num_col_term else None
            if grp_col:
                if num_col and pd.api.types.is_numeric_dtype(df[num_col]):
                    if agg_func in ("sum", "total"):
                        result = df.groupby(grp_col)[num_col].sum().reset_index()
                    else:
                        result = df.groupby(grp_col)[num_col].mean().reset_index()
                else:
                    result = df.groupby(grp_col).size().reset_index(name="count")
                return self._ans(f"Grouped by **{grp_col}**:", result, "group")

        # ── 8. Full-text search (catch-all) ──────────────────
        words = [w for w in re.split(r"\s+", query.strip()) if len(w) > 2]
        if words:
            search_term = " ".join(words[:4])
            mask = np.column_stack([
                df[col].astype(str).str.lower().str.contains(search_term.lower(), regex=False, na=False)
                for col in df.columns
            ])
            result = df[mask.any(axis=1)]
            if len(result) > 0:
                return self._ans(
                    f"Found **{len(result):,} rows** matching '{search_term}' across all columns.",
                    result,
                    "search",
                )

        # ── 9. Fallback ───────────────────────────────────────
        return self._ans(
            f"I understood your question but couldn't find a matching result in the data. "
            f"Try asking like: *'total of Sales'*, *'filter Status is Active'*, or *'top 10 by Revenue'*.",
            df.head(50),
            "info",
        )

    def _ans(self, message: str, df: pd.DataFrame, qtype: str) -> Dict[str, Any]:
        df_clean = df.replace({np.nan: None})
        return {
            "answer": message,
            "type": qtype,
            "row_count": len(df),
            "columns": list(df.columns),
            "rows": df_clean.head(500).to_dict(orient="records"),
        }
