import datetime as dt
from typing import Optional

try:
    import dateparser
except Exception:
    dateparser = None


def parse_due_text_to_ts(text: str, now: Optional[dt.datetime] = None) -> Optional[int]:
    if not text:
        return None
    if dateparser is None:
        return None
    now = now or dt.datetime.now()
    parsed = dateparser.parse(text, settings={"RELATIVE_BASE": now})
    if not parsed:
        return None
    return int(parsed.timestamp())


