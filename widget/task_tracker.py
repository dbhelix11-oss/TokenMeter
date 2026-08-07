"""Tracks token usage per Claude Code CLI session.

Reads ~/.claude/projects/*/*.jsonl transcripts directly — this is fully
local and has nothing to do with the browser extension / claude.ai usage
API used for the 5-hour and weekly percentage meters. Each assistant turn
in a transcript carries a "usage" block with token counts; this module
sums them per session file incrementally, only reading bytes appended
since the last scan.
"""
import json
import time
from pathlib import Path

PROJECTS_DIR = Path.home() / ".claude" / "projects"
ACTIVE_AFTER_S = 120  # a session touched more recently than this counts as "running"


class _FileState:
    __slots__ = ("offset", "totals", "label", "mtime")

    def __init__(self):
        self.offset = 0
        self.totals = 0
        self.label = None
        self.mtime = 0.0


class TaskTracker:
    def __init__(self):
        self._files = {}  # str(path) -> _FileState

    def scan(self, limit=5):
        try:
            paths = list(PROJECTS_DIR.glob("*/*.jsonl"))
        except OSError:
            return []

        seen = set()
        for path in paths:
            try:
                stat = path.stat()
            except OSError:
                continue
            key = str(path)
            seen.add(key)
            state = self._files.setdefault(key, _FileState())
            state.mtime = stat.st_mtime
            if stat.st_size < state.offset:
                state.offset = 0
                state.totals = 0
            if stat.st_size > state.offset:
                self._consume(path, state)

        for stale in [k for k in self._files if k not in seen]:
            del self._files[stale]

        recent = sorted(self._files.values(), key=lambda s: s.mtime, reverse=True)
        now = time.time()
        return [
            {
                "label": s.label or "session",
                "tokens": s.totals,
                "active": (now - s.mtime) < ACTIVE_AFTER_S,
            }
            for s in recent
            if s.totals > 0
        ][:limit]

    def _consume(self, path, state):
        try:
            with open(path, "rb") as f:
                f.seek(state.offset)
                chunk = f.read()
        except OSError:
            return
        if not chunk:
            return

        # Only process complete lines; leave a trailing partial line for the
        # next scan rather than risk a truncated JSON parse.
        last_nl = chunk.rfind(b"\n")
        if last_nl == -1:
            return
        complete = chunk[:last_nl]
        state.offset += last_nl + 1

        for raw_line in complete.split(b"\n"):
            if not raw_line.strip():
                continue
            try:
                entry = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            if state.label is None:
                cwd = entry.get("cwd")
                if cwd:
                    state.label = Path(cwd).name

            usage = (entry.get("message") or {}).get("usage")
            if isinstance(usage, dict):
                state.totals += (
                    usage.get("input_tokens", 0)
                    + usage.get("output_tokens", 0)
                    + usage.get("cache_creation_input_tokens", 0)
                    + usage.get("cache_read_input_tokens", 0)
                )


def fmt_tokens(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)
