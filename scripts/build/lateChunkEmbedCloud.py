from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import requests
from transformers import AutoTokenizer

HF_MODEL = "jinaai/jina-embeddings-v2-base-en"   # tokenizer
API_MODEL = "jina-embeddings-v2-base-en"          # Jina API
CHUNK_SIZE = 128
MAX_TOKENS = 8192

DATA = Path(__file__).parents[2] / "data"
DEFAULT_INPUT = DATA / "parsed_llama_preprocessed.md"
DEFAULT_OUTPUT = DATA / "embeddings.json"


def load_markdown_pages(path: Path) -> list[dict]:
    """Parse <!-- page:N --> markers into [{text, pageNum}] dicts."""
    text = path.read_text(encoding="utf-8")
    parts = re.split(r"<!-- page:(\d+) -->", text)
    # parts = ["", "1", "<page 1 text>", "2", "<page 2 text>", ...]
    pages = []
    for i in range(1, len(parts) - 1, 2):
        page_num = int(parts[i])
        page_text = parts[i + 1].strip()
        if page_text:
            pages.append({"pageNum": page_num, "text": page_text})
    return pages


@dataclass
class Chunk:
    id: int
    text: str
    start_page: int
    end_page: int


def split_by_tokens(pages: list[dict], tokenizer) -> list[Chunk]:
    flat: list[tuple[int, int]] = []
    for page in pages:
        token_ids = tokenizer.encode(page["text"], add_special_tokens=False)
        flat.extend((tok, page["pageNum"]) for tok in token_ids)

    chunks: list[Chunk] = []
    for i in range(0, len(flat), CHUNK_SIZE):
        span = flat[i : i + CHUNK_SIZE]
        token_ids = [t[0] for t in span]
        page_nums = [t[1] for t in span]
        chunks.append(Chunk(
            id=len(chunks),
            text=tokenizer.decode(token_ids, skip_special_tokens=True),
            start_page=page_nums[0],
            end_page=page_nums[-1],
        ))
    return chunks


def batch_chunks(chunks: list[Chunk], tokenizer) -> list[list[Chunk]]:
    batches: list[list[Chunk]] = []
    current: list[Chunk] = []
    total = 0
    for chunk in chunks:
        n = len(tokenizer.encode(chunk.text, add_special_tokens=False))
        if current and total + n > MAX_TOKENS - 2:
            batches.append(current)
            current = []
            total = 0
        current.append(chunk)
        total += n
    if current:
        batches.append(current)
    return batches


def embed_batch(chunks: list[Chunk], api_key: str) -> list[list[float]]:
    for attempt in range(3):
        resp = requests.post(
            "https://api.jina.ai/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": API_MODEL,
                "late_chunking": True,
                "normalized": True,
                "input": [c.text for c in chunks],
            },
            timeout=120,
        )
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 10))
            print(f"    rate limited, waiting {wait}s...", file=sys.stderr)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()["data"]
        data.sort(key=lambda x: x["index"])
        return [item["embedding"] for item in data]
    resp.raise_for_status()  # re-raise after 3 attempts


def main(input_path: Path, output_path: Path) -> None:
    api_key = os.environ.get("JINA_API_KEY")
    if not api_key:
        print("JINA_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {input_path}...", file=sys.stderr)
    pages = load_markdown_pages(input_path)
    print(f"  {len(pages)} pages", file=sys.stderr)

    tokenizer = AutoTokenizer.from_pretrained(HF_MODEL, trust_remote_code=True)

    chunks = split_by_tokens(pages, tokenizer)
    print(f"  {len(chunks)} chunks ({CHUNK_SIZE} tokens each)", file=sys.stderr)

    batches = batch_chunks(chunks, tokenizer)
    print(f"  {len(batches)} API batches", file=sys.stderr)

    embeddings: list[list[float]] = []
    for i, batch in enumerate(batches):
        print(f"  Batch {i + 1}/{len(batches)} ({len(batch)} chunks)...", file=sys.stderr)
        embeddings.extend(embed_batch(batch, api_key))

    records = [
        {**asdict(chunk), "embedding": embeddings[i]}
        for i, chunk in enumerate(chunks)
    ]
    output_path.write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"Done. {len(records)} records written to {output_path}.", file=sys.stderr)


if __name__ == "__main__":
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT
    main(input_path, output_path)
