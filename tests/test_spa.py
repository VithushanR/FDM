"""Serving the React build: frontend/dist first, client-side routes fall back to index.html, /api/ stays JSON."""

import pytest


@pytest.fixture
def frontend(tmp_path):
    """frontend/ with a source index.html, and frontend/dist/ with the built one."""
    root = tmp_path / "frontend"
    (root / "dist" / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<html>SOURCE</html>", encoding="utf-8")
    (root / "dist" / "index.html").write_text("<html>BUILT</html>", encoding="utf-8")
    (root / "dist" / "assets" / "app.js").write_text("console.log('built');", encoding="utf-8")
    return root


def test_dist_is_preferred_over_the_source_folder(make_client, dummy_model_path, frontend):
    with make_client(dummy_model_path, frontend_root=frontend) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "BUILT" in response.text and "SOURCE" not in response.text


def test_client_routes_return_index_html(make_client, dummy_model_path, frontend):
    with make_client(dummy_model_path, frontend_root=frontend) as client:
        for route in ("/hotspots", "/about", "/location/anything"):
            response = client.get(route)
            assert response.status_code == 200, route
            assert "BUILT" in response.text, route


def test_real_built_files_are_served_as_files(make_client, dummy_model_path, frontend):
    with make_client(dummy_model_path, frontend_root=frontend) as client:
        response = client.get("/assets/app.js")
        assert response.status_code == 200
        assert "console.log('built');" in response.text


def test_unknown_api_paths_stay_json_404(make_client, dummy_model_path, frontend):
    with make_client(dummy_model_path, frontend_root=frontend) as client:
        response = client.get("/api/unknown")
        assert response.status_code == 404
        assert response.json() == {"detail": "Not Found"}
        assert client.get("/api").status_code == 404


def test_api_routes_still_answer_with_the_frontend_present(make_client, dummy_model_path, frontend):
    with make_client(dummy_model_path, frontend_root=frontend) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/about").status_code == 200


def test_paths_cannot_escape_the_frontend_folder(make_client, dummy_model_path, frontend, tmp_path):
    (tmp_path / "secret.txt").write_text("TOP SECRET", encoding="utf-8")
    with make_client(dummy_model_path, frontend_root=frontend) as client:
        response = client.get("/..%2F..%2Fsecret.txt")
        assert "TOP SECRET" not in response.text
        assert "BUILT" in response.text


def test_without_a_frontend_there_is_no_fallback(make_client, dummy_model_path, tmp_path):
    empty = tmp_path / "no_front"
    empty.mkdir()
    with make_client(dummy_model_path, frontend_root=empty) as client:
        assert client.get("/hotspots").status_code == 404


def test_source_folder_is_used_when_there_is_no_dist(make_client, dummy_model_path, tmp_path):
    root = tmp_path / "frontend_src_only"
    root.mkdir()
    (root / "index.html").write_text("<html>SOURCE</html>", encoding="utf-8")
    with make_client(dummy_model_path, frontend_root=root) as client:
        assert "SOURCE" in client.get("/about").text
