from datetime import datetime

import pytest

from scheduler import seconds_until


def test_target_later_today():
    now = datetime(2026, 9, 3, 1, 30, 0)
    assert seconds_until("02:00", now) == 30 * 60


def test_target_already_passed_rolls_to_tomorrow():
    now = datetime(2026, 9, 3, 3, 0, 0)
    assert seconds_until("02:00", now) == 23 * 3600


def test_exact_time_rolls_to_tomorrow():
    now = datetime(2026, 9, 3, 2, 0, 0)
    assert seconds_until("02:00", now) == 24 * 3600


def test_invalid_format_raises():
    with pytest.raises(ValueError):
        seconds_until("not-a-time", datetime(2026, 9, 3))
