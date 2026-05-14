from __future__ import annotations

import argparse

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser(description="Open a page with Playwright and print its title")
    parser.add_argument("url")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except Exception:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page()
        page.goto(args.url, wait_until="networkidle")
        print(page.title())
        browser.close()


if __name__ == "__main__":
    main()
