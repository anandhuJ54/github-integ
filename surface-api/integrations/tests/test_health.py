"""The integrations Surface's base router: /hello is public, /me needs a signed-in user."""
from __future__ import annotations


def test_hello_is_public(surface_client):
    res = surface_client("integrations", signed_in=False).get("/integrations/hello")
    assert res.status_code == 200
    assert res.json() == {"surface": "14-integrations", "message": "Hello from FastAPI"}


def test_me_returns_the_signed_in_user(surface_client):
    res = surface_client("integrations").get("/integrations/me")
    assert res.status_code == 200
    assert res.json() == {"surface": "14-integrations", "sub": "user-1"}


def test_me_needs_a_token(surface_client):
    assert surface_client("integrations", signed_in=False).get("/integrations/me").status_code in (401, 403)
