"""Minimal, dependency-free Socrata (SODA 2.1) client with paging, retries and an on-disk cache.

Standard library only, so it runs unchanged inside IBM's s390x jupyterlab image.
"""
from __future__ import annotations

import gzip
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .config import RAW_DIR, SOCRATA_DOMAIN

PAGE_SIZE = 50_000
MAX_RETRIES = 5
TIMEOUT_S = 180


def _get_json(url: str) -> object:
    headers = {"Accept": "application/json", "User-Agent": "urban-sentinel-datathon/0.1"}
    token = os.environ.get("SOCRATA_APP_TOKEN")
    if token:
        headers["X-App-Token"] = token
    delay = 2.0
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=TIMEOUT_S) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            # 4xx other than throttling means a bad query: fail fast with Socrata's message.
            if exc.code not in (429, 500, 502, 503, 504) or attempt == MAX_RETRIES:
                detail = exc.read().decode("utf-8", "replace")[:500]
                raise RuntimeError(f"Socrata HTTP {exc.code} for {url}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if attempt == MAX_RETRIES:
                raise RuntimeError(f"Socrata request failed after {attempt} attempts: {url}") from exc
        time.sleep(delay)
        delay *= 2
    raise AssertionError("unreachable")


def query(dataset_id: str, *, select: str | None = None, where: str | None = None,
          order: str = ":id", page_size: int = PAGE_SIZE) -> list[dict]:
    """Fetch every row matching the query, paging with a stable order."""
    rows: list[dict] = []
    offset = 0
    while True:
        params = {"$limit": page_size, "$offset": offset, "$order": order}
        if select:
            params["$select"] = select
        if where:
            params["$where"] = where
        url = f"https://{SOCRATA_DOMAIN}/resource/{dataset_id}.json?{urllib.parse.urlencode(params)}"
        page = _get_json(url)
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected Socrata response for {dataset_id}: {str(page)[:300]}")
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def dataset_metadata(dataset_id: str) -> dict:
    meta = _get_json(f"https://{SOCRATA_DOMAIN}/api/views/{dataset_id}.json")
    updated = meta.get("rowsUpdatedAt")
    return {
        "dataset_id": dataset_id,
        "name": meta.get("name"),
        "rows_updated_at": datetime.fromtimestamp(updated, tz=timezone.utc).isoformat() if updated else None,
    }


def cached_query(name: str, dataset_id: str, *, refresh: bool = False, **kwargs) -> pd.DataFrame:
    """Return the query result as an all-string DataFrame, cached as .csv.gz + provenance JSON.

    CSV (not Parquet) because pyarrow has no s390x wheel.
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    data_path = RAW_DIR / f"{name}.csv.gz"
    meta_path = RAW_DIR / f"{name}.meta.json"
    if data_path.exists() and meta_path.exists() and not refresh:
        return pd.read_csv(data_path, dtype=str, keep_default_na=False, na_values=[""])
    fetched_at = datetime.now(timezone.utc).isoformat()
    rows = query(dataset_id, **kwargs)
    frame = pd.DataFrame(rows, dtype=str)
    with gzip.open(data_path, "wt", encoding="utf-8") as fh:
        frame.to_csv(fh, index=False)
    provenance = {**dataset_metadata(dataset_id), "fetched_at": fetched_at, "rows": len(frame), "query": kwargs}
    meta_path.write_text(json.dumps(provenance, indent=2, default=str))
    return frame


def read_provenance(name: str) -> dict | None:
    path = Path(RAW_DIR / f"{name}.meta.json")
    return json.loads(path.read_text()) if path.exists() else None
