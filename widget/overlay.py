#!/usr/bin/env python3
"""Token Meter — always-on-top overlay showing Claude usage.

Reads ~/.local/share/token-meter/status.json, which the Claude Usage Meter
browser extension keeps fresh via a native messaging host. This process does
no network access and holds no credentials — it only renders whatever the
extension last pushed.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PySide6.QtCore import Qt, QTimer, QPoint
from PySide6.QtGui import QColor, QPainter, QPainterPath, QFont
from PySide6.QtWidgets import QApplication, QWidget, QMenu

STATUS_FILE = Path.home() / ".local" / "share" / "token-meter" / "status.json"
POSITION_FILE = Path.home() / ".local" / "share" / "token-meter" / "widget_position.json"
STALE_AFTER_MS = 20 * 60 * 1000  # extension refreshes every 10 min; flag one missed cycle

BG_COLOR = QColor(28, 26, 24, 235)
FG_COLOR = QColor(240, 236, 230)
DIM_COLOR = QColor(170, 165, 158)
BLUE = QColor(58, 111, 217)
AMBER = QColor(217, 134, 57)
RED = QColor(200, 83, 60)
GRAY = QColor(120, 120, 120)


def pct_color(pct):
    if pct is None:
        return GRAY
    if pct >= 90:
        return RED
    if pct >= 70:
        return AMBER
    return BLUE


def fmt_reset(iso):
    if not iso:
        return "—"
    try:
        target = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return "—"
    now = datetime.now(timezone.utc)
    diff = (target - now).total_seconds()
    if diff <= 0:
        return "resets now"
    mins = int(diff // 60)
    hrs, mins = divmod(mins, 60)
    days, hrs = divmod(hrs, 24)
    if days > 0:
        return f"resets in {days}d {hrs}h"
    if hrs > 0:
        return f"resets in {hrs}h {mins}m"
    return f"resets in {mins}m"


class MeterRow(QWidget):
    def __init__(self, label, parent=None):
        super().__init__(parent)
        self.label = label
        self.pct = None
        self.reset_text = "—"
        self.setFixedHeight(34)

    def set_data(self, pct, resets_at):
        self.pct = pct
        self.reset_text = fmt_reset(resets_at)
        self.update()

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)

        p.setFont(QFont("Sans", 9))
        p.setPen(FG_COLOR)
        p.drawText(0, 12, self.label)

        pct_str = "—" if self.pct is None else f"{round(self.pct)}%"
        p.setPen(DIM_COLOR)
        p.setFont(QFont("Sans", 8))
        fm = p.fontMetrics()
        p.drawText(self.width() - fm.horizontalAdvance(self.reset_text), 12, self.reset_text)

        p.setFont(QFont("Sans", 9, QFont.Bold))
        p.setPen(FG_COLOR)
        p.drawText(0, 30, pct_str)

        bar_x = 40
        bar_y = 22
        bar_w = self.width() - bar_x
        bar_h = 6
        track = QPainterPath()
        track.addRoundedRect(bar_x, bar_y, bar_w, bar_h, 3, 3)
        p.fillPath(track, QColor(255, 255, 255, 30))

        if self.pct is not None:
            fill_w = max(4, min(bar_w, bar_w * min(self.pct, 100) / 100))
            fill = QPainterPath()
            fill.addRoundedRect(bar_x, bar_y, fill_w, bar_h, 3, 3)
            p.fillPath(fill, pct_color(self.pct))

        p.end()


class Overlay(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.resize(210, 118)

        self.five_hour = MeterRow("5-hour", self)
        self.five_hour.setGeometry(14, 12, 182, 34)
        self.weekly = MeterRow("Weekly", self)
        self.weekly.setGeometry(14, 52, 182, 34)

        self.status_text = ""
        self._drag_offset = None
        self._last_mtime = None

        self.load_position()

        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(self.poll_status)
        self.poll_timer.start(5000)

        self.tick_timer = QTimer(self)
        self.tick_timer.timeout.connect(self.tick)
        self.tick_timer.start(1000)

        self.poll_status(force=True)

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        path = QPainterPath()
        path.addRoundedRect(0, 0, self.width(), self.height(), 12, 12)
        p.fillPath(path, BG_COLOR)

        p.setFont(QFont("Sans", 7))
        p.setPen(DIM_COLOR)
        p.drawText(14, self.height() - 8, self.status_text)
        p.end()

    def poll_status(self, force=False):
        try:
            mtime = STATUS_FILE.stat().st_mtime
        except FileNotFoundError:
            self.status_text = "waiting for extension…"
            self.five_hour.set_data(None, None)
            self.weekly.set_data(None, None)
            self.update()
            return

        if not force and mtime == self._last_mtime:
            self.tick()
            return
        self._last_mtime = mtime

        try:
            record = json.loads(STATUS_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return

        self._record = record
        self.render_record()

    def render_record(self):
        record = getattr(self, "_record", None)
        if not record:
            return
        data = (record.get("data") or {}).get("usage") or {}
        fh = data.get("five_hour") or {}
        wk = data.get("seven_day") or {}
        self.five_hour.set_data(fh.get("utilization"), fh.get("resets_at"))
        self.weekly.set_data(wk.get("utilization"), wk.get("resets_at"))

        received_at = record.get("receivedAt")
        if received_at:
            age_ms = datetime.now().timestamp() * 1000 - received_at
            age_min = int(age_ms // 60000)
            if age_ms > STALE_AFTER_MS:
                self.status_text = f"stale — last update {age_min}m ago (is Chromium running?)"
            elif age_min < 1:
                self.status_text = "updated just now"
            else:
                self.status_text = f"updated {age_min}m ago"
        self.update()

    def tick(self):
        # Re-render countdown text every second without re-reading the file.
        self.render_record()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._drag_offset = event.globalPosition().toPoint() - self.pos()
        elif event.button() == Qt.RightButton:
            self.show_menu(event.globalPosition().toPoint())

    def mouseMoveEvent(self, event):
        if self._drag_offset is not None:
            self.move(event.globalPosition().toPoint() - self._drag_offset)

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._drag_offset = None
            self.save_position()

    def show_menu(self, pos):
        menu = QMenu(self)
        refresh_action = menu.addAction("Refresh")
        quit_action = menu.addAction("Quit")
        chosen = menu.exec(pos)
        if chosen == refresh_action:
            self.poll_status(force=True)
        elif chosen == quit_action:
            self.save_position()
            QApplication.quit()

    def load_position(self):
        try:
            pos = json.loads(POSITION_FILE.read_text())
            self.move(pos["x"], pos["y"])
        except (FileNotFoundError, json.JSONDecodeError, KeyError):
            screen = QApplication.primaryScreen().availableGeometry()
            self.move(screen.width() - self.width() - 24, 24)

    def save_position(self):
        POSITION_FILE.parent.mkdir(parents=True, exist_ok=True)
        POSITION_FILE.write_text(json.dumps({"x": self.x(), "y": self.y()}))


def main():
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(True)
    overlay = Overlay()
    overlay.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
