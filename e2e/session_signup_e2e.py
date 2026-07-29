"""E2E: signup auto-signs in, persists a session, and refreshes its access token."""
import asyncio, json, os, uuid, urllib.request
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
email = f"e2e-signup-{uuid.uuid4().hex[:8]}@example.com"; pw = "SunlandTest#2026"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await page.goto(BASE + "/", wait_until="domcontentloaded")
        await page.get_by_role("tab", name="Create account").click()
        await page.fill("#su-name", "E2E Session"); await page.fill("#su-flat", "C-101")
        await page.fill("#su-phone", "9990001111"); await page.fill("#su-email", email)
        await page.fill("#su-pass", pw)
        await page.get_by_role("button", name="Create my account").click()
        await page.wait_for_url("**/dashboard", timeout=30000)
        print("PASS: signup landed on dashboard with a live session")

        s1 = await page.evaluate("""async () => {
            const m = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
            const s = JSON.parse(localStorage.getItem(m));
            return { token: s.access_token, refresh: !!s.refresh_token, expires: s.expires_at };
        }""")
        assert s1["refresh"], "no refresh token persisted"
        print("PASS: session persisted with refresh token, expires_at =", s1["expires"])

        # Force a token refresh through the client and confirm a new access token.
        s2 = await page.evaluate("""async () => {
            const { supabase } = await import('/src/integrations/supabase/client.ts');
            const { data, error } = await supabase.auth.refreshSession();
            return { err: error?.message ?? null, token: data.session?.access_token ?? null };
        }""")
        assert not s2["err"], s2["err"]
        assert s2["token"] and s2["token"] != s1["token"], "access token did not rotate"
        print("PASS: token refresh issued a new access token")

        # Reload: session must survive and stay on the dashboard (no bounce to sign-in).
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        assert "/dashboard" in page.url, f"session lost on reload -> {page.url}"
        print("PASS: session survives reload; still on", page.url)
        await b.close()

asyncio.run(main())
uid = None
req = urllib.request.Request(f"{URL}/auth/v1/admin/users?page=1&per_page=200", headers={"apikey": SR})
for u in json.loads(urllib.request.urlopen(req).read())["users"]:
    if u["email"] == email: uid = u["id"]
if uid:
    urllib.request.urlopen(urllib.request.Request(f"{URL}/auth/v1/admin/users/{uid}", headers={"apikey": SR}, method="DELETE"))
print("ALL SESSION CHECKS PASSED")
