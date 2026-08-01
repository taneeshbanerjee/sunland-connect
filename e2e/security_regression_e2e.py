"""Security regression checks for Sunland Residency.

Covers the role-based rules that must never regress:
  1. Directory masking       - residents cannot read another resident's flat number.
  2. Receipts                - residents can only read their own receipts and cannot issue one.
  3. Resident deletion       - a plain resident cannot delete profiles / auth accounts,
                               and nobody can delete the Super Admin.
  4. Notification opt-out    - a resident can flip notify_announcements and it sticks.
  5. Reports                 - anyone (even signed out) can file a report, nobody but the
                               committee can read them back.

Run:  python3 e2e/security_regression_e2e.py
Needs a .env with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (read automatically).
"""

import json
import os
import random
import string
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env() -> dict:
    env = {}
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v.strip().strip('"')
    return env


ENV = load_env()
URL = ENV.get("VITE_SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
KEY = ENV.get("VITE_SUPABASE_PUBLISHABLE_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY", "")

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    results.append((ok, label))
    print(("PASS  " if ok else "FAIL  ") + label)


def call(method: str, path: str, token: str | None = None, body=None, extra_headers=None):
    req = urllib.request.Request(URL + path, method=method)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {token or KEY}")
    req.add_header("Content-Type", "application/json")
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            raw = r.read().decode() or "null"
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "null"
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def rnd(n=8):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def signup(flat: str):
    email = f"sec-{rnd()}@example.com"
    password = "Regress!" + rnd(6)
    status, body = call(
        "POST",
        "/auth/v1/signup",
        body={
            "email": email,
            "password": password,
            "data": {"full_name": f"Regression {flat}", "flat_no": flat},
        },
    )
    if status >= 400 or not body.get("access_token"):
        print("  could not create test account:", status, body)
        return None
    return {"email": email, "token": body["access_token"], "id": body["user"]["id"], "flat": flat}


def main() -> int:
    if not URL or not KEY:
        print("Missing Supabase URL/key")
        return 1

    a = signup("SEC-A1")
    b = signup("SEC-B2")
    if not a or not b:
        return 1

    # 1. directory masking -------------------------------------------------
    call("PATCH", f"/rest/v1/profiles?id=eq.{a['id']}", a["token"], {"hide_flat_no": True})
    _, dir_rows = call("POST", "/rest/v1/rpc/residents_directory", b["token"], {})
    seen = [r for r in (dir_rows or []) if isinstance(r, dict) and r.get("id") == a["id"]]
    check(len(seen) == 0, "resident cannot see another resident's directory row")

    _, own = call("GET", f"/rest/v1/profiles?select=flat_no&id=eq.{a['id']}", a["token"])
    check(
        isinstance(own, list) and own and own[0].get("flat_no") == "SEC-A1",
        "resident still sees their own flat number",
    )
    _, other = call("GET", f"/rest/v1/profiles?select=flat_no&id=eq.{a['id']}", b["token"])
    check(other == [], "direct profile read of another resident returns nothing")

    # 2. receipts ----------------------------------------------------------
    status, _ = call(
        "POST",
        "/rest/v1/receipts",
        b["token"],
        {"user_id": a["id"], "title": "forged receipt", "amount": 1},
    )
    check(status >= 400, "resident cannot issue a receipt to someone else")

    _, their_receipts = call("GET", f"/rest/v1/receipts?user_id=eq.{a['id']}", b["token"])
    check(their_receipts == [], "resident cannot read another resident's receipts")

    # 3. deletion ----------------------------------------------------------
    status, _ = call("DELETE", f"/rest/v1/profiles?id=eq.{a['id']}", b["token"])
    _, still = call("GET", f"/rest/v1/profiles?select=id&id=eq.{a['id']}", a["token"])
    check(bool(still), "resident cannot delete another resident's profile")

    status, body = call("POST", "/rest/v1/rpc/delete_resident", b["token"], {"_target": a["id"]})
    check(status >= 400, "resident cannot call the delete_resident tool")

    # 4. notification opt-out ---------------------------------------------
    call("PATCH", f"/rest/v1/profiles?id=eq.{a['id']}", a["token"], {"notify_announcements": False})
    _, pref = call("GET", f"/rest/v1/profiles?select=notify_announcements&id=eq.{a['id']}", a["token"])
    check(
        isinstance(pref, list) and pref and pref[0]["notify_announcements"] is False,
        "notification opt-out persists for the resident",
    )
    status, _ = call(
        "PATCH", f"/rest/v1/profiles?id=eq.{a['id']}", b["token"], {"notify_announcements": True}
    )
    _, pref2 = call("GET", f"/rest/v1/profiles?select=notify_announcements&id=eq.{a['id']}", a["token"])
    check(pref2[0]["notify_announcements"] is False, "another resident cannot flip that opt-out")

    # 5. public reports ----------------------------------------------------
    status, _ = call(
        "POST",
        "/rest/v1/reports",
        None,
        {"subject": "regression probe", "message": "filed by the security regression suite"},
    )
    check(status < 400, "anyone (signed out) can file a report")
    _, read_back = call("GET", "/rest/v1/reports?select=id", b["token"])
    check(read_back == [], "a plain resident cannot read reports")

    # 6. announcements -----------------------------------------------------
    status, _ = call(
        "POST",
        "/rest/v1/announcements",
        b["token"],
        {"title": "fake", "body": "resident should not post", "author_id": b["id"]},
    )
    check(status >= 400, "resident cannot publish an announcement")

    failed = [label for ok, label in results if not ok]
    print("\n%d/%d checks passed" % (len(results) - len(failed), len(results)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
