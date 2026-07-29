"""E2E: only the supreme admin gets full admin powers; other roles are limited."""
import os, json, asyncio, urllib.request, uuid
from playwright.async_api import async_playwright

URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PUB = "sb_publishable_MBC2PTXVur72XtVol9hfag_NH37zgp1"
OWNER = ("mickeybanerjee29@gmail.com", "291013")
BASE = "http://localhost:8080"

def api(path, body=None, method="POST", key=SR, token=None):
    h = {"apikey": key, "Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers=h, method=method)
    try:
        r = urllib.request.urlopen(req); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def make_user(role):
    email = f"e2e-{role}-{uuid.uuid4().hex[:8]}@example.com"; pw = "SunlandTest#2026"
    st, u = api("/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                                         "user_metadata": {"full_name": f"E2E {role}"}})
    assert st in (200, 201), (st, u)
    uid = u["id"]
    if role != "resident":
        st, r = api("/rest/v1/user_roles", {"user_id": uid, "role": role})
        assert st in (200, 201), (st, r)
    return email, pw, uid

async def signin(page, email, pw):
    await page.goto(BASE + "/", wait_until="domcontentloaded")
    await page.wait_for_selector("#si-email", timeout=20000)
    await page.fill("#si-email", email); await page.fill("#si-pass", pw)
    await page.get_by_role("button", name="Sign in securely").click()
    await page.wait_for_url("**/dashboard", timeout=25000)

async def main():
    results = []
    resident = make_user("resident"); board = make_user("board_member"); pres = make_user("president")
    async with async_playwright() as pw_:
        b = await pw_.chromium.launch(headless=True)
        async def run(label, creds, expect_console, expect_tabs, expect_absent):
            ctx = await b.new_context(viewport={"width": 1280, "height": 1800})
            p = await ctx.new_page()
            await signin(p, creds[0], creds[1])
            await p.goto(BASE + "/admin", wait_until="domcontentloaded")
            await p.wait_for_timeout(3500)
            body = await p.inner_text("body")
            has_console = "Committee console" in body
            assert has_console == expect_console, f"{label}: console visible={has_console}, expected {expect_console}"
            if not expect_console:
                assert "Restricted area" in body, f"{label}: expected restricted notice"
            for t in expect_tabs:
                assert t in body, f"{label}: missing tab {t}"
            for t in expect_absent:
                assert t not in body, f"{label}: tab {t} should be hidden"
            results.append(f"{label}: OK (console={has_console}, tabs={expect_tabs})")
            await ctx.close()

        await run("resident", resident, False, [], ["Admin roles", "Audit trail", "Monitoring"])
        await run("board_member", board, True, ["Residents", "Maintenance"], ["Admin roles", "Audit trail", "Monitoring"])
        await run("president", pres, True, ["Residents", "Audit trail", "Monitoring"], ["Admin roles"])
        await run("SUPREME ADMIN", OWNER, True, ["Residents", "Admin roles", "Audit trail", "Monitoring"], [])
        await b.close()

    # Server-side enforcement: non-super admin cannot grant roles, resident cannot read audit logs.
    def token(email, pw):
        st, d = api("/auth/v1/token?grant_type=password", {"email": email, "password": pw}, key=PUB)
        assert st == 200, d
        return d["access_token"]

    t_pres = token(pres[0], pres[1]); t_res = token(resident[0], resident[1])
    for label, tok, fn, body in [
        ("president->assignRole", t_pres, "assignRole", {"email": resident[0], "role": "president"}),
        ("resident->listAuditLogs", t_res, "listAuditLogs", {"category": "all"}),
        ("resident->listCommittee", t_res, "listCommittee", None),
    ]:
        req = urllib.request.Request(f"{BASE}/_serverFn/{fn}", data=json.dumps({"data": body}).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
        try:
            r = urllib.request.urlopen(req); code, payload = r.status, r.read().decode()[:200]
        except urllib.error.HTTPError as e:
            code, payload = e.code, e.read().decode()[:200]
        blocked = code >= 400 or "Forbidden" in payload
        assert blocked, f"{label} NOT blocked: {code} {payload}"
        results.append(f"{label}: blocked ({code})")

    # Cleanup
    for _, _, uid in (resident, board, pres):
        api(f"/auth/v1/admin/users/{uid}", method="DELETE")
    print("\n".join(results)); print("ALL RBAC CHECKS PASSED")

asyncio.run(main())
