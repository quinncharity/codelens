from __future__ import annotations

import sys
from pathlib import Path

# Make `src/` importable without packaging the project yet.
_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))

