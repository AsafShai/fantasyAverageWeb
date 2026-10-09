from datetime import date, datetime, timezone
from unittest.mock import patch

from app.utils import utils


def test_latest_client_date_is_ahead_of_utc_for_east_of_utc_viewers():
    # 22:30 UTC on Jan 1 is already Jan 2 in Israel; that date must be accepted.
    fake_now = datetime(2026, 1, 1, 22, 30, tzinfo=timezone.utc)
    with patch.object(utils, "datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        assert utils.latest_client_date() == date(2026, 1, 2)


def test_latest_client_date_never_more_than_one_day_ahead():
    fake_now = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    with patch.object(utils, "datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        assert utils.latest_client_date() == date(2026, 1, 1)
