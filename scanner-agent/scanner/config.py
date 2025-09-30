import os, sys, yaml


def load_cfg(path: str = "filters.yaml") -> dict:
    candidates = []
    env_path = os.getenv("SCANNER_FILTERS_PATH")
    if env_path:
        candidates.append(env_path)
    candidates.append(path)

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            with open(candidate, "r") as f:
                data = yaml.safe_load(f) or {}
            return data

    print("ERROR: filters.yaml not found"); sys.exit(1)
