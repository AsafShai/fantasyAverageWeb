import pytest
from unittest.mock import patch

from app.services.data_provider import DataProvider

_UNPATCHED_DATAPROVIDER_NEW = DataProvider.__new__
_UNPATCHED_DATAPROVIDER_INIT = DataProvider.__init__


@pytest.fixture(autouse=True)
def real_dataprovider_for_marked_tests(request):
    marker = request.node.get_closest_marker("real_dataprovider")
    if not marker:
        yield
        return
    DataProvider._instance = None
    DataProvider._initialized = False
    with patch.object(DataProvider, "__new__", _UNPATCHED_DATAPROVIDER_NEW), patch.object(
        DataProvider, "__init__", _UNPATCHED_DATAPROVIDER_INIT
    ):
        yield
    DataProvider._instance = None
    DataProvider._initialized = False
