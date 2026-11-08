import repro_kit as kit
import zdt_autopilot as bot

import ast, pathlib
tree = ast.parse(pathlib.Path(bot.__file__).read_text(encoding="utf-8"))
used = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr == "sleep"
        and isinstance(n.value, ast.Name) and n.value.id == "time"]
assert not used, f"time.sleep at lines {used}"
