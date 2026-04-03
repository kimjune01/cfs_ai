from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from docling.document_converter import DocumentConverter

PDF_PATH = Path(__file__).parent.parent / "public" / "CFS.pdf"
OUTPUT_PATH = Path(__file__).parent.parent / "data" / "chunks.json"

# Canadian ICAO codes: C + 3 uppercase letters/digits
ICAO_RE = re.compile(r'^C[A-Z0-9]{3,4}$')

# Province+ICAO prefix that appears as a text item before the section header (e.g. "BCCYPK")
PROVINCE_PREFIX_RE = re.compile(r'^[A-Z]{2}C[A-Z0-9]{3,4}$')

# Noise embedded in cell content from two-column page continuation headers
# e.g. "... unless approved by APM. BC (Cont'd) CYPK"
CELL_NOISE_RE = re.compile(r'\s+[A-Z]{2}\s+\(Cont\'?d\)\s+C[A-Z0-9]{3,4}\s*$')

SECTION_GROUPS: dict[str, str] = {
    "REF":      "identity",
    "OPR":      "identity",
    "PF":       "identity",
    "FLT PLN":  "identity",
    "FIC":      "identity",
    "ACC":      "identity",
    "WX":       "identity",
    "SERVICES": "identity",
    "FUEL":     "identity",
    "OIL":      "identity",
    "S":        "identity",
    "PVT ADV":  "identity",
    "CUST":     "identity",
    "RWY DATA": "movement",
    "RWY CERT": "movement",
    "TWY CERT": "movement",
    "APRON":    "movement",
    "RCR":      "movement",
    "HELI DATA":"movement",
    "LIGHTING": "movement",
    "COMM":     "comms",
    "ATIS":     "comms",
    "GND":      "comms",
    "TWR":      "comms",
    "MF":       "comms",
    "ATF":      "comms",
    "CTF":      "comms",
    "CTAF":     "comms",
    "NAV":      "comms",
    "NAV VOR":  "comms",
    "VOR":      "comms",
    "NDB":      "comms",
    "ILS":      "comms",
    "DME":      "comms",
    "PRO":      "procedures",
    "CAUTION":  "procedures",
}


def parse_table(table_item, doc) -> list[tuple[str, str]]:
    """
    Parse a Docling TableItem into (label, content) pairs.
    Skips noise header rows (aerodrome name / cont'd lines).
    Deduplicates identical mirrored columns from two-column page layouts.
    """
    rows = []
    try:
        md = table_item.export_to_markdown(doc)
    except TypeError:
        md = table_item.export_to_markdown()

    for line in md.split("\n"):
        line = line.strip()
        if not line.startswith("|") or "---" in line:
            continue
        cols = [c.strip() for c in line.strip("|").split("|")]
        if not cols:
            continue

        label = cols[0]
        content_cols = [c for c in cols[1:] if c]

        # Skip noise header rows (aerodrome name / Cont'd lines)
        if label and label.upper() not in SECTION_GROUPS and content_cols:
            # If content mirrors the label it's a duplicate-column header row
            if all(c == label or "(Cont'd)" in c for c in content_cols):
                continue
            # Any row whose label isn't a known section and has non-empty content
            # is a header/noise row — skip it
            continue

        # Deduplicate identical mirrored columns
        if content_cols and len(set(content_cols)) == 1:
            content = content_cols[0]
        else:
            content = "  ".join(content_cols)

        # Strip page-continuation noise embedded in cell text
        content = CELL_NOISE_RE.sub("", content).strip()

        rows.append((label, content))

    return rows


def flush(chunks: list, chunk_id: int, icao: str | None,
          group_data: dict[str, list[tuple[str, int]]]) -> int:
    if not icao or not group_data:
        return chunk_id

    for sg in ["identity", "movement", "comms", "procedures"]:
        lines_pages = group_data.get(sg, [])
        if not lines_pages:
            continue
        lines = [lp[0] for lp in lines_pages]
        pages = [lp[1] for lp in lines_pages if lp[1]]
        text = "\n".join(lines).strip()
        if not text:
            continue
        chunks.append({
            "id": chunk_id,
            "icao": icao,
            "section_group": sg,
            "start_page": min(pages) if pages else 0,
            "end_page": max(pages) if pages else 0,
            "text": text,
        })
        chunk_id += 1

    return chunk_id


def parse_cfs(pdf_path: Path) -> list:
    print(f"Converting {pdf_path} with Docling...", file=sys.stderr)
    result = DocumentConverter().convert(str(pdf_path))
    doc = result.document
    print("Conversion done. Building section-group chunks...", file=sys.stderr)

    chunks: list[dict] = []
    chunk_id = 0
    current_icao: str | None = None
    current_group = "identity"
    # group -> list of (line_text, page_no)
    group_data: dict[str, list[tuple[str, int]]] = defaultdict(list)

    for item, _ in doc.iterate_items():
        label = str(item.label)
        page: int = item.prov[0].page_no if item.prov else 0

        if label == "picture":
            continue

        if label == "section_header":
            text = item.text.strip()
            if ICAO_RE.match(text):
                # New aerodrome — flush the previous one
                chunk_id = flush(chunks, chunk_id, current_icao, group_data)
                current_icao = text
                current_group = "identity"
                group_data = defaultdict(list)
            # Non-ICAO headings (province names, aerodrome full names) → skip
            continue

        if label == "table":
            rows = parse_table(item, doc)
            for row_label, content in rows:
                key = row_label.upper()
                if key in SECTION_GROUPS:
                    current_group = SECTION_GROUPS[key]
                # Rows with empty label are continuations of current section
                if current_icao:
                    line = f"{row_label}  {content}".strip() if content else row_label
                    if line:
                        group_data[current_group].append((line, page))
            continue

        if label in ("text", "list_item"):
            text = (item.text or "").strip()
            if not text or PROVINCE_PREFIX_RE.match(text):
                continue
            if current_icao:
                group_data[current_group].append((text, page))

    # Flush last aerodrome
    chunk_id = flush(chunks, chunk_id, current_icao, group_data)
    return chunks


if __name__ == "__main__":
    chunks = parse_cfs(PDF_PATH)

    icaos = set(c["icao"] for c in chunks if c["icao"])
    print(f"  {len(icaos)} aerodromes, {len(chunks)} section-group chunks", file=sys.stderr)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)
    print(f"Done. {len(chunks)} chunks saved to {OUTPUT_PATH}", file=sys.stderr)
