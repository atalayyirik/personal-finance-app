import os

QUIET_WARNINGS = False  # run-time set from CLI/options

def set_quiet(val: bool):
    global QUIET_WARNINGS
    QUIET_WARNINGS = bool(val)

def _netlog(msg):
    if not QUIET_WARNINGS:
        print(msg)

def human_money(n: float):
    if n is None or not isinstance(n, (int, float)): return ""
    absn = abs(n)
    if absn >= 1_000_000_000_000: return f"{n/1_000_000_000_000:.2f}T"
    if absn >= 1_000_000_000:     return f"{n/1_000_000_000:.2f}B"
    if absn >= 1_000_000:         return f"{n/1_000_000:.2f}M"
    if absn >= 1_000:             return f"{n/1_000:.2f}K"
    return f"{n:.0f}"

def ensure_dir(p): os.makedirs(p, exist_ok=True)
