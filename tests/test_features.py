"""Pure derivation formulas in services/features.py."""

import math
from datetime import date, time

import pytest

from backend.services.features import (
    day_of_week, hour_sin_cos, month_sin_cos, season_for_month, time_bucket_for_hour, parse_date, parse_time,
)


@pytest.mark.parametrize("day, expected", [
    (date(2024, 3, 17), 1),  # Sunday
    (date(2024, 3, 18), 2),  # Monday
    (date(2024, 3, 23), 7),  # Saturday
])
def test_day_of_week_uses_stats19_coding(day, expected):
    assert day_of_week(day) == expected


@pytest.mark.parametrize("month, season", [
    (12, "Winter"), (1, "Winter"), (2, "Winter"),
    (3, "Spring"), (5, "Spring"),
    (6, "Summer"), (8, "Summer"),
    (9, "Autumn"), (11, "Autumn"),
])
def test_season_boundaries(month, season):
    assert season_for_month(month) == season


@pytest.mark.parametrize("hour, bucket", [
    (0, "Night"), (5, "Night"),
    (6, "Morning Rush"), (9, "Morning Rush"),
    (10, "Midday"), (15, "Midday"),
    (16, "Evening Rush"), (18, "Evening Rush"),
    (19, "Evening"), (23, "Evening"),
])
def test_time_bucket_boundaries(hour, bucket):
    assert time_bucket_for_hour(hour) == bucket


def test_month_and_hour_sin_cos_use_the_documented_formula():
    sin, cos = month_sin_cos(1)
    assert sin == pytest.approx(math.sin(2 * math.pi / 12))
    assert cos == pytest.approx(math.cos(2 * math.pi / 12))
    sin, cos = hour_sin_cos(6)
    assert sin == pytest.approx(1.0)
    assert cos == pytest.approx(0.0, abs=1e-12)


def test_date_and_time_text_must_match_the_exact_format():
    assert parse_date("2024-03-15") == date(2024, 3, 15)
    assert parse_date("15/03/2024") is None
    assert parse_date("2024-02-30") is None
    assert parse_time("18:30") == time(18, 30)
    assert parse_time("6:30") is None
    assert parse_time("24:00") is None
