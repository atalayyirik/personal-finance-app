import os, sys, random, time
import requests
from requests.adapters import HTTPAdapter
from requests.exceptions import ConnectTimeout, ReadTimeout, ConnectionError as ReqConnError, HTTPError
from urllib3.util.retry import Retry
from .utils import _netlog

# globals configurable from CLI
GLOBAL_HTTP_TIMEOUT = 8.0
GLOBAL_MAX_RETRIES = 2

def set_http(timeo: float, retries: int):
    global GLOBAL_HTTP_TIMEOUT, GLOBAL_MAX_RETRIES
    GLOBAL_HTTP_TIMEOUT = float(timeo)
    GLOBAL_MAX_RETRIES = int(retries)

SESSION = requests.Session()
ADAPTER = HTTPAdapter(pool_connections=256, pool_maxsize=256,
                      max_retries=Retry(total=0, backoff_factor=0, raise_on_status=False))
SESSION.mount("https://", ADAPTER)
SESSION.mount("http://", ADAPTER)

def backoff_sleep(attempt: int, base: float = 0.6):
    import random
    sleep_s = base * (2 ** (attempt - 1))
    sleep_s = sleep_s * (0.75 + 0.5 * random.random())
    time.sleep(min(sleep_s, 1.5))

def http_get(url, headers=None, params=None, retries=None, retry_status=(429,500,502,503,504), retry_forbidden=(403,404)):
    if retries is None: retries = GLOBAL_MAX_RETRIES
    for attempt in range(1, retries + 1):
        try:
            r = SESSION.get(url, headers=headers or {}, params=params or {}, timeout=(5.0, GLOBAL_HTTP_TIMEOUT))
            if r.status_code in retry_forbidden:
                _netlog(f"[net warn] {url} -> HTTP {r.status_code}. Not retrying.")
                return None
            if r.status_code in retry_status:
                raise HTTPError(f"Retryable HTTP {r.status_code}")
            r.raise_for_status()
            return r
        except (ConnectTimeout, ReadTimeout, ReqConnError, HTTPError) as e:
            if attempt >= retries:
                _netlog(f"[net error] {url} -> {e}; giving up.")
                return None
            _netlog(f"[net warn] {url} -> {e}; retry {attempt}/{retries}")
            backoff_sleep(attempt)
        except Exception as e:
            _netlog(f"[net warn] {url} -> {e}; skip")
            return None
    return None
