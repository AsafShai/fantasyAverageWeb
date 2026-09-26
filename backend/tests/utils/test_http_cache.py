from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.utils.http_cache import HttpCacheMiddleware, weak_etag


def _app(payload):
    app = FastAPI()
    app.add_middleware(HttpCacheMiddleware, rules={"/cached": "public, max-age=60"})

    @app.get("/cached")
    async def cached():
        return payload["value"]

    @app.get("/other")
    async def other():
        return payload["value"]

    @app.get("/missing")
    async def missing():
        raise HTTPException(status_code=404, detail="nope")

    return TestClient(app)


def test_adds_etag_and_cache_control_without_touching_body():
    payload = {"value": {"b": [1, 2.5, None], "a": "x"}}
    client = _app(payload)
    plain = _app(payload)  # same handler, compare against a route the middleware ignores

    r = client.get("/cached")

    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=60"
    assert r.headers["etag"] == weak_etag(r.content)
    assert r.content == plain.get("/other").content


def test_matching_if_none_match_returns_empty_304():
    client = _app({"value": {"a": 1}})
    etag = client.get("/cached").headers["etag"]

    r = client.get("/cached", headers={"If-None-Match": etag})

    assert r.status_code == 304
    assert r.content == b""
    assert r.headers["etag"] == etag
    assert r.headers["cache-control"] == "public, max-age=60"


def test_changed_body_gets_new_etag_and_full_200():
    payload = {"value": {"a": 1}}
    client = _app(payload)
    old = client.get("/cached").headers["etag"]
    payload["value"] = {"a": 2}

    r = client.get("/cached", headers={"If-None-Match": old})

    assert r.status_code == 200
    assert r.json() == {"a": 2}
    assert r.headers["etag"] != old


def test_if_none_match_list_and_star():
    client = _app({"value": {"a": 1}})
    etag = client.get("/cached").headers["etag"]

    assert client.get("/cached", headers={"If-None-Match": f'W/"zzz", {etag}'}).status_code == 304
    assert client.get("/cached", headers={"If-None-Match": "*"}).status_code == 304


def test_unlisted_path_untouched():
    r = _app({"value": {"a": 1}}).get("/other")
    assert "etag" not in r.headers
    assert "cache-control" not in r.headers


def test_error_responses_are_not_cached():
    r = _app({"value": {}}).get("/missing")
    assert r.status_code == 404
    assert "etag" not in r.headers
    assert "cache-control" not in r.headers


def test_existing_cache_control_is_kept():
    from fastapi import Response
    app = FastAPI()
    app.add_middleware(HttpCacheMiddleware, rules={"/own": "public, max-age=60"})

    @app.get("/own")
    async def own(response: Response):
        response.headers["Cache-Control"] = "private, max-age=5"
        return {"a": 1}

    r = TestClient(app).get("/own")
    assert r.headers["cache-control"] == "private, max-age=5"
    assert "etag" in r.headers
