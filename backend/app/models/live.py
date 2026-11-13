"""The ``live`` block live-capable responses carry (plans/live_data_updates_design.md,
"Response contract addition")."""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, model_serializer


class LiveBlock(BaseModel):
    active: bool
    period: Optional[int] = None
    as_of: Optional[datetime] = None
    games_total: int = 0
    games_live: int = 0
    games_final: int = 0
    official_updated_at: Optional[datetime] = None


class LiveAware(BaseModel):
    """Base of every response that can carry tonight's ``live`` block.

    ``live`` stays None while LIVE_STANDINGS_ENABLED is off, and is then left
    out of the serialized response altogether, so with the flag off the JSON is
    exactly what it was before the field existed."""
    live: Optional[LiveBlock] = None

    @model_serializer(mode='wrap')
    def _omit_absent_live(self, handler) -> Any:
        data = handler(self)
        if isinstance(data, dict) and data.get('live') is None:
            data.pop('live', None)
        return data


def with_live(response: LiveAware, state) -> LiveAware:
    """A copy of ``response`` carrying ``state`` (a LiveState) as its ``live``
    block, or ``response`` itself when there is no state (flag off). A copy, so
    a memoised response is never changed."""
    if state is None:
        return response
    return response.model_copy(update={'live': LiveBlock(**state.to_dict())})
