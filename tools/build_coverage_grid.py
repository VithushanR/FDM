"""Builds the location coverage grid from a collision CSV.

Usage (from the repo root):
    python tools/build_coverage_grid.py <collisions.csv>
    python tools/build_coverage_grid.py <collisions.csv> --out backend/resources/gb_coverage.npz --cell 0.01

Only the latitude and longitude columns are read. Points outside the coarse UK box are dropped, and so are
blank coordinates. Each remaining point goes into a cell of --cell degrees, and the centre of every occupied
cell is stored. The app measures how far a location is from the nearest occupied centre.
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from backend.config import COVERAGE_GRID_PATH  # noqa: E402
from backend.services.coverage_service import BOX_LATITUDE, BOX_LONGITUDE  # noqa: E402


def build_grid(csv_path: Path, cell: float) -> tuple[dict, int, int]:
    """Returns the arrays to save, the number of rows used, and the number of rows read."""
    frame = pd.read_csv(csv_path, usecols=["latitude", "longitude"], low_memory=False)
    source_rows = len(frame)
    frame = frame.dropna()
    inside = (
        frame["latitude"].between(*BOX_LATITUDE) & frame["longitude"].between(*BOX_LONGITUDE)
    )
    points = frame[inside]
    rows_used = len(points)
    lat_index = np.floor(points["latitude"].to_numpy(dtype=float) / cell).astype(np.int64)
    lon_index = np.floor(points["longitude"].to_numpy(dtype=float) / cell).astype(np.int64)
    cells = np.unique(np.column_stack([lat_index, lon_index]), axis=0)
    centres_lat = ((cells[:, 0] + 0.5) * cell).astype(np.float32)
    centres_lon = ((cells[:, 1] + 0.5) * cell).astype(np.float32)
    arrays = {
        "centre_latitude": centres_lat,
        "centre_longitude": centres_lon,
        "cell_degrees": np.float64(cell),
        "source_rows": np.int64(source_rows),
        "source_file": np.array(csv_path.name),
        "built_at": np.array(datetime.now(timezone.utc).isoformat()),
    }
    return arrays, rows_used, source_rows


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", type=Path, help="collision CSV with latitude and longitude columns")
    parser.add_argument("--out", type=Path, default=COVERAGE_GRID_PATH, help="output .npz file")
    parser.add_argument("--cell", type=float, default=0.01, help="cell size in degrees (default 0.01)")
    args = parser.parse_args(argv)
    if args.cell <= 0:
        parser.error("--cell must be greater than 0")

    start = time.perf_counter()
    arrays, rows_used, source_rows = build_grid(args.csv, args.cell)
    out = args.out if args.out.is_absolute() else ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, **arrays)
    occupied = len(arrays["centre_latitude"])
    print(f"Source: {args.csv.name}, {source_rows} rows read")
    print(f"Rows used (inside the UK box, coordinates present): {rows_used}")
    print(f"Rows dropped: {source_rows - rows_used}")
    print(f"Occupied cells: {occupied} (cell {args.cell} degrees)")
    print(f"Wrote {out} ({os.path.getsize(out) / 1024:.1f} KB) in {time.perf_counter() - start:.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
