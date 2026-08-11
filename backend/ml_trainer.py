import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error, classification_report
from typing import Any, Dict, List, Optional
import warnings
warnings.filterwarnings("ignore")


class MLTrainer:
    def __init__(self):
        self.models: Dict[str, Any] = {}
        self.encoders: Dict[str, LabelEncoder] = {}
        self.feature_names: List[str] = []
        self.target_col: str = ""
        self.task_type: str = ""  # 'classification' or 'regression'

    def _encode_df(self, df: pd.DataFrame, fit: bool = True) -> pd.DataFrame:
        result = df.copy()
        for col in result.columns:
            if result[col].dtype == object or str(result[col].dtype) == "category":
                result[col] = result[col].astype(str).fillna("Unknown")
                if fit:
                    enc = LabelEncoder()
                    result[col] = enc.fit_transform(result[col])
                    self.encoders[col] = enc
                else:
                    enc = self.encoders.get(col)
                    if enc:
                        known = set(enc.classes_)
                        result[col] = result[col].apply(lambda x: x if x in known else enc.classes_[0])
                        result[col] = enc.transform(result[col])
                    else:
                        result[col] = 0
            else:
                result[col] = pd.to_numeric(result[col], errors="coerce").fillna(0)
        return result

    def train(
        self,
        df: pd.DataFrame,
        target_col: str,
        feature_cols: Optional[List[str]] = None,
        algorithm: str = "random_forest",
    ) -> Dict[str, Any]:
        """
        Train a model to predict target_col from feature_cols.
        Returns metrics, feature_importances and predictions on the full dataset.
        """
        if target_col not in df.columns:
            raise ValueError(f"Target column '{target_col}' not found.")

        self.target_col = target_col
        self.encoders = {}

        # Determine features
        if feature_cols:
            feats = [c for c in feature_cols if c != target_col and c in df.columns]
        else:
            feats = [c for c in df.columns if c != target_col]

        self.feature_names = feats

        # Drop rows where target is null
        data = df[feats + [target_col]].dropna(subset=[target_col])

        # Determine task type
        target_series = data[target_col]
        unique_vals = target_series.nunique()
        is_numeric_target = pd.api.types.is_numeric_dtype(target_series)

        if is_numeric_target and unique_vals > 10:
            self.task_type = "regression"
        else:
            self.task_type = "classification"

        # Encode all
        X_raw = data[feats]
        y_raw = data[target_col]

        X = self._encode_df(X_raw, fit=True)

        if self.task_type == "classification":
            y_enc = LabelEncoder()
            y = y_enc.fit_transform(y_raw.astype(str))
            self.encoders["__target__"] = y_enc
        else:
            y = y_raw.astype(float).values

        # Split
        test_size = min(0.2, max(0.05, 50 / len(X)))
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )

        # Pick model
        if self.task_type == "classification":
            if algorithm == "gradient_boosting":
                model = GradientBoostingClassifier(n_estimators=100, random_state=42)
            else:
                model = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
        else:
            if algorithm == "gradient_boosting":
                model = GradientBoostingRegressor(n_estimators=100, random_state=42)
            else:
                model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)

        model.fit(X_train, y_train)
        self.models["active"] = model

        # Evaluate
        y_pred = model.predict(X_test)
        if self.task_type == "classification":
            acc = accuracy_score(y_test, y_pred)
            metrics = {
                "task": "classification",
                "accuracy": round(float(acc), 4),
                "accuracy_pct": f"{acc*100:.1f}%",
                "train_samples": len(X_train),
                "test_samples": len(X_test),
            }
        else:
            r2 = r2_score(y_test, y_pred)
            mae = mean_absolute_error(y_test, y_pred)
            metrics = {
                "task": "regression",
                "r2_score": round(float(r2), 4),
                "mae": round(float(mae), 4),
                "r2_pct": f"{max(r2,0)*100:.1f}%",
                "train_samples": len(X_train),
                "test_samples": len(X_test),
            }

        # Feature importances
        importances = model.feature_importances_
        feature_importance = sorted(
            [{"feature": f, "importance": round(float(imp), 4)} for f, imp in zip(feats, importances)],
            key=lambda x: x["importance"],
            reverse=True,
        )

        # Predict on full dataframe
        df_result = df.copy()
        X_full_raw = df[feats].copy()
        for col in X_full_raw.columns:
            if X_full_raw[col].dtype == object or str(X_full_raw[col].dtype) == "category":
                X_full_raw[col] = X_full_raw[col].astype(str).fillna("Unknown")
            else:
                X_full_raw[col] = pd.to_numeric(X_full_raw[col], errors="coerce").fillna(0)

        X_full = self._encode_df(X_full_raw, fit=False)
        preds = model.predict(X_full)

        if self.task_type == "classification":
            target_enc = self.encoders.get("__target__")
            if target_enc:
                preds_decoded = target_enc.inverse_transform(preds)
            else:
                preds_decoded = preds
            df_result[f"{target_col}_predicted"] = preds_decoded
        else:
            df_result[f"{target_col}_predicted"] = np.round(preds, 2)

        df_result = df_result.replace({np.nan: None})

        return {
            "metrics": metrics,
            "feature_importance": feature_importance,
            "target_column": target_col,
            "feature_columns": feats,
            "task_type": self.task_type,
            "algorithm": algorithm,
            "predictions": df_result.head(500).to_dict(orient="records"),
            "all_columns": list(df_result.columns),
        }
