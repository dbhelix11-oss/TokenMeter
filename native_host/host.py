#!/usr/bin/env python3
"""Native messaging host for Token Meter.

Chromium spawns this process per chrome.runtime.sendNativeMessage() call from
the Claude Usage Meter extension, feeds one length-prefixed JSON message on
stdin, and expects an optional length-prefixed JSON reply on stdout. This
host just writes what it receives to a local status file for the desktop
overlay widget to read, then exits.
"""
import json
import os
import pwd
import struct
import sys
import tempfile
import time
from pathlib import Path

# Chromium's snap sandbox rewrites HOME for processes it spawns (including
# this native messaging host), so Path.home() / os.environ["HOME"] can point
# at the snap's private directory instead of the real user home. Resolve the
# real home from the passwd database, which snap confinement doesn't touch.
#
# The data dir also can't live under a hidden path like ~/.local/share/ —
# snap's apparmor profile for chromium only allows specific pre-declared
# subpaths there (fonts, mime, applications, icons, ...), not arbitrary new
# ones. Its blanket home-write rule instead matches top-level directory names
# that don't start with "." or "s" (owner @{HOME}/[^s.]** rwklix), so a plain
# non-hidden folder is required.
REAL_HOME = Path(pwd.getpwuid(os.getuid()).pw_dir)
STATUS_DIR = REAL_HOME / "token-meter"
STATUS_FILE = STATUS_DIR / "status.json"


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    length = struct.unpack("<I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(payload):
    data = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def write_status(message):
    STATUS_DIR.mkdir(parents=True, exist_ok=True)
    record = {
        "data": message.get("data"),
        "fetchedAt": message.get("fetchedAt"),
        "receivedAt": int(time.time() * 1000),
    }
    fd, tmp_path = tempfile.mkstemp(dir=STATUS_DIR, prefix=".status-", suffix=".tmp")
    try:
        with open(fd, "w") as f:
            json.dump(record, f)
        Path(tmp_path).replace(STATUS_FILE)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def main():
    message = read_message()
    if message is not None:
        write_status(message)
        send_message({"ok": True})


if __name__ == "__main__":
    main()
