import datetime as dt
import replay
from fake_ib_async import ET

import json, pathlib
for name in ("week.json", "week_reset_daily.json"):
    w = json.loads((pathlib.Path(replay.__file__).parent / "results" / name).read_text(encoding="utf-8"))
    assert "MODELED" in w["model"] and "REAL" in w["model"], f"{name} does not say what is modeled and what is real"
