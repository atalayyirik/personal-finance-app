def sanitize_ticker(sym: str):
    bad_markers = (".WS", ".W", ".WT", ".U", "PFD", "WRT", "RIGHT")
    if any(b in sym for b in bad_markers):
        return None
    return sym.replace(".", "-").strip()

def load_tickers(path="tickers_stocks_cs.txt", max_n=None):
    import os, sys
    path = os.path.join("./tickers",path)
    if not os.path.exists(path):
        print(f"ERROR: {path} not found"); sys.exit(1)
    with open(path) as f:
        raw = [t.strip() for t in f if t.strip() and not t.startswith("#")]
    out = []
    for s in sorted(set(raw)):
        s2 = sanitize_ticker(s)
        if s2: out.append(s2)
    if max_n is not None:
        out = out[:max_n]
    if not out:
        print("ERROR: no usable tickers after sanitize()"); sys.exit(1)
    return out
