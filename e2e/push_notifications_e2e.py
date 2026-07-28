"""End-to-end test: a published announcement must reach a signed-in resident
on a mobile device as a push/system notification.

Run:  python3 e2e/push_notifications_e2e.py
Env:  E2E_EMAIL, E2E_PASSWORD, BASE_URL (default http://localhost:8080)
      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (to publish the announcement)
"""
import asyncio, json, os, sys, time, urllib.request
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# iPhone-sized mobile viewport
MOBILE = {"width": 390, "height": 844}


def publish_announcement(title, body, author_id):
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/announcements",
        data=json.dumps({
            "title": title, "body": body, "importance": "urgent",
            "author_id": author_id, "author_name": "E2E Test",
        }).encode(),
        headers={"apikey": SB_KEY, 
                 "Content-Type": "application/json", "Prefer": "return=representation"},
        method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport=MOBILE, is_mobile=True,
                                        has_touch=True, permissions=["notifications"])
        page = await ctx.new_page()

        # Capture every notification the app raises (page API + service worker).
        await page.add_init_script("""
          window.__notifications = [];
          const orig = window.Notification;
          function Fake(title, opts) { window.__notifications.push({title, body: (opts||{}).body}); }
          Fake.permission = 'granted';
          Fake.requestPermission = async () => 'granted';
          window.Notification = Fake;
          navigator.serviceWorker && navigator.serviceWorker.register &&
            (navigator.serviceWorker.__realRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker));
          if (navigator.serviceWorker) {
            navigator.serviceWorker.register = async (...a) => {
              const reg = await navigator.serviceWorker.__realRegister(...a);
              const wrapped = Object.create(reg);
              wrapped.showNotification = async (title, opts) => {
                window.__notifications.push({title, body: (opts||{}).body});
              };
              return wrapped;
            };
          }
        """)

        # 1. Sign in on mobile
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.get_by_label("Email", exact=True).first.fill(EMAIL)
        await page.get_by_label("Password", exact=True).first.fill(PASSWORD)
        await page.get_by_role("button", name="Sign in securely").click()
        await page.wait_for_url("**/dashboard", timeout=25000)
        print("PASS: mobile sign-in reached the dashboard")

        user_id = await page.evaluate("""async () => {
          const k = Object.keys(localStorage).find(k => k.includes('auth-token'));
          return JSON.parse(localStorage.getItem(k)).user.id;
        }""")

        # 2. Wait for the realtime subscription to be live
        await page.wait_for_timeout(4000)

        # 3. Publish a critical announcement from the backend
        title = f"E2E critical notice {int(time.time())}"
        publish_announcement(title, "Water supply will be cut at 10am. Please store water.", user_id)
        print("published announcement:", title)

        # 4. Assert it reached the device as a notification
        for _ in range(20):
            notes = await page.evaluate("window.__notifications || []")
            if any(title in (n.get("title") or "") for n in notes):
                print("PASS: notification delivered to mobile device ->", notes[-1])
                await browser.close()
                return 0
            await page.wait_for_timeout(500)

        print("FAIL: no notification received", await page.evaluate("window.__notifications || []"))
        await page.screenshot(path="/tmp/browser/push_fail.png")
        await browser.close()
        return 1


sys.exit(asyncio.run(main()))
