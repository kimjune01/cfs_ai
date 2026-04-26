"""Remove boilerplate page headers from parsed_llama.md."""

import re
import sys
from pathlib import Path

DATA = Path(__file__).parents[2] / "data"
DEFAULT_IN = DATA / "parsed_llama.md"
DEFAULT_OUT = DATA / "parsed_llama_preprocessed.md"

in_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT

text = in_path.read_text()
# Remove the GPH 205 header line in all its forms (plain, bold **, inline <mark> date)
cleaned = re.sub(r"\*{0,2}CANADA FLIGHT SUPPLEMENT / GPH 205\*{0,2}[^\n]*\n", "", text)
# Remove orphaned "Effective 0901Z ..." lines (plain or italic *...*) left when header spanned two lines
cleaned = re.sub(r"^\*?Effective 0901Z \d[^\n]*\*?\n", "", cleaned, flags=re.MULTILINE)

removed = text.count("\n") - cleaned.count("\n")
out_path.write_text(cleaned)
print(f"Removed {removed} lines → {out_path}")
