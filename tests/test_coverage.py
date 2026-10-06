"""The coverage grid: the build tool, the status thresholds, and the fallback when the grid is missing or damaged."""

import numpy as np
import pytest

from backend.services.coverage_service import (
    EARTH_RADIUS_KM, FALLBACK_WARNING, OUTSIDE_MESSAGE, SPARSE_MESSAGE, CoverageService,
)
from tools import build_coverage_grid

THRESHOLDS = {"sparse_km": 3, "outside_km": 10}
CENTRE = (51.5, -0.12)


def point_north(lat: float, lon: float, km: float) -> tuple[float, float]:
    """Moves a point due north by km. One degree of latitude is R * pi / 180 km."""
    return lat + km / (EARTH_RADIUS_KM * np.pi / 180), lon


def write_grid(path, centres):
    lats = np.array([c[0] for c in centres], dtype=np.float32)
    lons = np.array([c[1] for c in centres], dtype=np.float32)
    np.savez(path, centre_latitude=lats, centre_longitude=lons, cell_degrees=np.float64(0.01))
    return path


@pytest.fixture
def grid_path(tmp_path):
    return write_grid(tmp_path / "grid.npz", [CENTRE])


@pytest.fixture
def service(grid_path):
    service = CoverageService(grid_path, THRESHOLDS)
    assert service.loaded
    return service


def test_build_grid_reads_only_coordinates_drops_bad_rows_and_bins_cells(tmp_path, capsys):
    csv = tmp_path / "collisions.csv"
    csv.write_text(
        "collision_index,latitude,longitude,extra\n"
        "1,51.501,-0.121,a\n"
        "2,51.502,-0.122,b\n"
        "3,51.5015,-0.1205,c\n"
        "4,52.005,-1.005,d\n"
        "5,,-0.1,e\n"          # blank latitude: dropped
        "6,40.0,0.0,f\n"       # outside the box: dropped
        "7,51.5,3.0,g\n",      # outside the box: dropped
        encoding="utf-8",
    )
    out = tmp_path / "gb.npz"
    assert build_coverage_grid.main([str(csv), "--out", str(out), "--cell", "0.01"]) == 0
    data = np.load(out)
    assert data["centre_latitude"].dtype == np.float32
    assert len(data["centre_latitude"]) == 2  # the first three points share one cell
    assert data["source_rows"] == 7
    assert str(data["source_file"]) == "collisions.csv"
    assert str(data["built_at"])
    assert float(data["cell_degrees"]) == 0.01
    output = capsys.readouterr().out
    assert "Rows used (inside the UK box, coordinates present): 4" in output
    assert "Rows dropped: 3" in output
    assert "Occupied cells: 2" in output


def test_build_grid_rejects_a_non_positive_cell(tmp_path):
    csv = tmp_path / "c.csv"
    csv.write_text("latitude,longitude\n51.5,-0.1\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        build_coverage_grid.main([str(csv), "--out", str(tmp_path / "x.npz"), "--cell", "0"])


def test_status_thresholds_and_their_exact_boundaries(grid_path):
    service = CoverageService(grid_path, THRESHOLDS)
    lat, lon = CENTRE
    assert service.check(*point_north(lat, lon, 2.9))["status"] == "covered"
    assert service.check(*point_north(lat, lon, 3.1))["status"] == "sparse"
    assert service.check(*point_north(lat, lon, 9.9))["status"] == "sparse"
    assert service.check(*point_north(lat, lon, 10.1))["status"] == "outside"


def test_exact_boundaries_use_the_same_distance_as_the_check(grid_path):
    lat, lon = point_north(*CENTRE, 5.0)
    probe = CoverageService(grid_path, THRESHOLDS)
    raw = float(probe.tree.query(np.radians([[lat, lon]]), k=1)[0][0, 0]) * EARTH_RADIUS_KM

    at_sparse = CoverageService(grid_path, {"sparse_km": raw, "outside_km": raw + 1})
    assert at_sparse.check(lat, lon)["status"] == "covered"  # distance equal to sparse_km is covered

    at_outside = CoverageService(grid_path, {"sparse_km": raw - 1, "outside_km": raw})
    assert at_outside.check(lat, lon)["status"] == "sparse"  # distance equal to outside_km is still sparse

    past_outside = CoverageService(grid_path, {"sparse_km": raw - 2, "outside_km": raw - 0.001})
    assert past_outside.check(lat, lon)["status"] == "outside"


def test_sparse_and_outside_messages_are_exact(service):
    lat, lon = CENTRE
    sparse = service.check(*point_north(lat, lon, 5.0))
    assert sparse["message"] == SPARSE_MESSAGE.format(km=sparse["nearest_km"])
    assert sparse["allowed"] is True
    outside = service.check(*point_north(lat, lon, 20.0))
    assert outside["message"] == (
        "This location is more than 10 km from any collision in the data. "
        "The data covers Great Britain only (England, Scotland and Wales)."
    )
    assert outside["message"] == OUTSIDE_MESSAGE.format(km=10)
    assert outside["allowed"] is False
    covered = service.check(lat, lon)
    assert covered == {"status": "covered", "nearest_km": 0.0, "message": None, "allowed": True}


def test_an_irish_point_is_outside_a_great_britain_grid(service):
    dublin = service.check(53.35, -6.26)
    assert dublin["status"] == "outside"
    assert dublin["allowed"] is False


def test_missing_grid_falls_back_to_the_box_and_says_so(tmp_path):
    service = CoverageService(tmp_path / "absent.npz", THRESHOLDS)
    assert not service.loaded
    assert service.warnings == [FALLBACK_WARNING]
    assert service.health_text() == "missing"
    inside = service.check(53.35, -6.26)  # Dublin is inside the box, so it is not checked
    assert inside == {"status": "unchecked", "nearest_km": None, "message": None, "allowed": True}
    outside = service.check(40.0, 0.0)
    assert outside["status"] == "outside" and outside["allowed"] is False


def test_damaged_grid_falls_back_with_the_reason(tmp_path):
    bad = tmp_path / "bad.npz"
    bad.write_bytes(b"not a numpy file")
    service = CoverageService(bad, THRESHOLDS)
    assert not service.loaded
    assert service.warnings[0].startswith("Coverage grid could not be read")
    assert FALLBACK_WARNING in service.warnings[0]


def test_invalid_thresholds_fall_back_instead_of_stopping_the_app(grid_path):
    service = CoverageService(grid_path, {"sparse_km": 10, "outside_km": 3})
    assert not service.loaded
    assert any("sparse_km < outside_km" in w for w in service.warnings)


def test_health_text_reports_the_number_of_cells(tmp_path):
    path = write_grid(tmp_path / "two.npz", [CENTRE, (52.0, -1.0)])
    assert CoverageService(path, THRESHOLDS).health_text() == "loaded (2 cells)"
