"""Legacy HTTP route `POST /api/search-assistant` (served here as `/search-assistant`).

The assistant is not built yet; the legacy route validated the question and answered
"coming soon". That honest placeholder is kept as is.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["search"])


def valid_question(body: object) -> bool:
    """zod: { question: string, trimmed, 2..300 chars }."""
    if not isinstance(body, dict):
        return False
    question = body.get("question")
    if not isinstance(question, str):
        return False
    return 2 <= len(question.strip()) <= 300


@router.post("/search-assistant")
async def search_assistant(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — unparsable body → null (legacy `.catch(() => null)`)
        body = None
    if not valid_question(body):
        return JSONResponse({"error": "Please enter a question."}, status_code=400)
    return JSONResponse({"status": "coming_soon", "message": "AI answers coming soon"})
