import datetime as dt
import replay
from fake_ib_async import ET

import json, pathlib
w = json.loads((pathlib.Path(replay.__file__).parent / "results" / "week.json").read_text(encoding="utf-8"))
budgets = [l for d in w["days"] for _, l in d["console"] if l.startswith("[BUDGET]")]
assert budgets[0].startswith("[BUDGET] $100.00"), budgets[0]
assert all("from the log's last row" in b for b in budgets[1:]), f"a later session did not start from the log: {budgets}"
