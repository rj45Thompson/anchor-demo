import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import fake_ib_async  # noqa: E402

# The bot imports this in-memory TWS in place of the real ib_async, so no test can reach TWS or an account.
sys.modules["ib_async"] = fake_ib_async
