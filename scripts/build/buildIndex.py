from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import lancedb

DEFAULT_INPUT = Path(__file__).parents[2] / "data" / "embeddings.json"
DEFAULT_DB = Path(__file__).parents[2] / "data" / "lancedb"


def main(input_path: Path, db_path: Path) -> None:
    print(f"Reading {input_path}...", file=sys.stderr)
    records = json.loads(input_path.read_text(encoding="utf-8"))
    print(f"  {len(records)} records", file=sys.stderr)

    if db_path.exists():
        shutil.rmtree(db_path)
    db = lancedb.connect(str(db_path))
    db.create_table("cfs", [
        {
            "id": r["id"],
            "text": r["text"],
            "title": r["title"],
            "start_page": r["start_page"],
            "end_page": r["end_page"],
            "vector": r["embedding"],
        }
        for r in records
    ])
    print(f"Done. {len(records)} chunks indexed at {db_path}.", file=sys.stderr)


if __name__ == "__main__":
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT
    db_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_DB
    main(input_path, db_path)
