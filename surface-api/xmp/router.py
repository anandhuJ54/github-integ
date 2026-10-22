"""Aggregate router for the xmp Surface.

The app mounts only this. Include this Surface's sub-routers here as it grows —
new capabilities go in this file, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
