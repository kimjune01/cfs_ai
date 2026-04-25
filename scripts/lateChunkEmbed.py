from __future__ import annotations

import json
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import lancedb
import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MODEL_NAME = "jinaai/jina-embeddings-v2-base-en"
MAX_TOKENS = 8192
OVERLAP_TOKENS = 512
CHUNK_SIZE = 512       # tokens per chunk
CHUNK_SEPARATOR = "\n\n"

DEFAULT_INPUT = Path(__file__).parent.parent / "data" / "parsed.json"
DEFAULT_DB = Path(__file__).parent.parent / "data" / "lancedb"


@dataclass
class Chunk:
    id: int
    text: str
    start_page: int
    end_page: int


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def split_by_tokens(pages: list[dict], tokenizer, chunk_size: int = CHUNK_SIZE) -> list[Chunk]:
    """
    Tokenize each page, build a flat (token_id, page_num) sequence,
    then slice into fixed-size chunks preserving start_page and end_page.
    """
    flat: list[tuple[int, int]] = []  # (token_id, page_num)
    for page in pages:
        token_ids = tokenizer.encode(page["text"], add_special_tokens=False)
        flat.extend((tok, page["pageNum"]) for tok in token_ids)

    chunks: list[Chunk] = []
    for i in range(0, len(flat), chunk_size):
        span = flat[i : i + chunk_size]
        token_ids = [t[0] for t in span]
        page_nums = [t[1] for t in span]
        chunks.append(Chunk(
            id=len(chunks),
            text=tokenizer.decode(token_ids, skip_special_tokens=True),
            start_page=page_nums[0],
            end_page=page_nums[-1],
        ))

    return chunks


# ---------------------------------------------------------------------------
# Sliding window construction
# ---------------------------------------------------------------------------

def count_tokens(text: str, tokenizer) -> int:
    return len(tokenizer.encode(text, add_special_tokens=False))


def build_windows(chunks: list[Chunk], tokenizer) -> list[list[int]]:
    """
    Build overlapping windows of chunk indices that fit within MAX_TOKENS.
    Adjacent windows share ~OVERLAP_TOKENS worth of chunks for context continuity.
    """
    token_counts = [count_tokens(c.text, tokenizer) for c in chunks]

    windows: list[list[int]] = []
    i = 0
    while i < len(chunks):
        window: list[int] = []
        total = 0

        j = i
        while j < len(chunks):
            cost = token_counts[j] + (len(CHUNK_SEPARATOR) if window else 0)
            if total + cost > MAX_TOKENS - 2:  # -2 for CLS/SEP
                break
            window.append(j)
            total += cost
            j += 1

        if not window:  # single chunk exceeds budget — include it alone
            window = [i]
            j = i + 1

        windows.append(window)

        # Next window starts far enough back to preserve ~OVERLAP_TOKENS of context
        overlap_budget = OVERLAP_TOKENS
        overlap_count = 0
        for k in reversed(window):
            if overlap_budget >= token_counts[k]:
                overlap_budget -= token_counts[k]
                overlap_count += 1
            else:
                break

        next_i = j - overlap_count
        i = next_i if next_i > i else i + 1  # always advance

    return windows


# ---------------------------------------------------------------------------
# Late chunking — embed one window, pool per chunk span
# ---------------------------------------------------------------------------

def embed_window(
    window_chunks: list[Chunk],
    tokenizer,
    model,
    device: str,
) -> dict[int, np.ndarray]:
    """
    Forward-pass the full window, then mean-pool each chunk's token span.
    Returns {chunk.id: vector}.
    """
    full_text = CHUNK_SEPARATOR.join(c.text for c in window_chunks)

    char_spans: list[tuple[int, int]] = []
    pos = 0
    for chunk in window_chunks:
        start = pos
        end = pos + len(chunk.text)
        char_spans.append((start, end))
        pos = end + len(CHUNK_SEPARATOR)

    encoding = tokenizer(
        full_text,
        return_tensors="pt",
        truncation=True,
        max_length=MAX_TOKENS,
        return_offsets_mapping=True,
    )
    offset_mapping = encoding.pop("offset_mapping")[0].tolist()
    encoding = {k: v.to(device) for k, v in encoding.items()}

    with torch.no_grad():
        token_embeddings = model(**encoding).last_hidden_state[0]  # [seq_len, dim]

    results: dict[int, np.ndarray] = {}
    for chunk, (char_start, char_end) in zip(window_chunks, char_spans):
        token_indices = [
            idx for idx, (tok_s, tok_e) in enumerate(offset_mapping)
            if tok_e > char_start and tok_s < char_end and tok_e > tok_s
        ]
        if token_indices:
            vec = token_embeddings[token_indices].mean(dim=0).cpu().numpy()
        else:
            vec = token_embeddings.mean(dim=0).cpu().numpy()
        norm = np.linalg.norm(vec)
        results[chunk.id] = vec / norm if norm > 0 else vec

    return results


# ---------------------------------------------------------------------------
# Main embedding loop
# ---------------------------------------------------------------------------

def embed_all(chunks: list[Chunk], tokenizer, model, device: str) -> list[np.ndarray]:
    """
    Embed every chunk using late chunking + sliding window.
    Chunks that appear in multiple overlapping windows have their embeddings averaged.
    """
    windows = build_windows(chunks, tokenizer)
    chunk_map = {c.id: c for c in chunks}
    accumulated: dict[int, list[np.ndarray]] = {c.id: [] for c in chunks}

    for win_idx, window in enumerate(windows):
        print(
            f"  Window {win_idx + 1}/{len(windows)}  "
            f"(chunks {window[0]}–{window[-1]})",
            file=sys.stderr,
        )
        vecs = embed_window([chunk_map[idx] for idx in window], tokenizer, model, device)
        for chunk_id, vec in vecs.items():
            accumulated[chunk_id].append(vec)

    return [np.mean(accumulated[c.id], axis=0) for c in chunks]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(input_path: Path, db_path: Path) -> None:
    print(f"Reading {input_path}...", file=sys.stderr)
    pages = json.loads(input_path.read_text(encoding="utf-8"))
    print(f"  {len(pages)} pages", file=sys.stderr)

    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    print(f"Loading {MODEL_NAME} on {device}...", file=sys.stderr)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    model = AutoModel.from_pretrained(MODEL_NAME, trust_remote_code=True).to(device)
    model.eval()

    chunks = split_by_tokens(pages, tokenizer)
    print(f"  {len(chunks)} chunks ({CHUNK_SIZE} tokens each)", file=sys.stderr)

    print("Embedding with late chunking + sliding window...", file=sys.stderr)
    embeddings = embed_all(chunks, tokenizer, model, device)

    print(f"Writing {len(chunks)} records to LanceDB at {db_path}...", file=sys.stderr)
    if db_path.exists():
        shutil.rmtree(db_path)
    db = lancedb.connect(str(db_path))
    db.create_table("cfs", [
        {
            "id": chunk.id,
            "text": chunk.text,
            "start_page": chunk.start_page,
            "end_page": chunk.end_page,
            "vector": embeddings[i].tolist(),
        }
        for i, chunk in enumerate(chunks)
    ])
    print(f"Done. {len(chunks)} chunks embedded and stored.", file=sys.stderr)


if __name__ == "__main__":
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT
    db_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_DB
    main(input_path, db_path)
