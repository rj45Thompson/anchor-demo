import datetime as dt
import replay
from fake_ib_async import ET

import ast, pathlib
tree = ast.parse(pathlib.Path(replay.__file__).read_text(encoding="utf-8"))
set_on_bot = {t.attr for n in ast.walk(tree) if isinstance(n, ast.Assign) for t in n.targets
              if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "bot"}
set_on_bot |= {e.attr for n in ast.walk(tree) if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Tuple)
               for e in t.elts if isinstance(e, ast.Attribute) and isinstance(e.value, ast.Name) and e.value.id == "bot"}
allowed = {"ib", "now_et", "LOG_FILENAME", "STOP_LOSS_PCT", "TAKE_PROFIT_PCT"}
assert set_on_bot <= allowed, f"the replay changes the bot's {sorted(set_on_bot - allowed)}"
