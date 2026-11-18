# Kindle desk panel

An old Kindle (8th gen, firmware 5.16.2.1.1) shows a black-and-white version of the desk panel.

## How it works
1. `kindle.html` is a 600×800 e-ink layout that uses the same data and rules as pad5: hero, agenda, countdown rings, family 2×2 and workout pictures.
2. The GitHub Actions workflow `.github/workflows/pages.yml` runs every 15 minutes from 05:37 to 00:22 IST and on every push. It opens `kindle.html` in headless Chrome with the dashboard key (stored as a GitHub secret), saves a 16-grey PNG and publishes the whole site to Pages.
3. The PNG is published at `k/<KINDLE_TOKEN>.png`. That file exists only on the published site, never in this repo, and the token is a random 32-character name.
4. The Kindle runs `panel/panel.sh` (started from KUAL). It wakes at :05 and :35 past each hour from 06:05 to 23:35, downloads the PNG, draws it with `eips`, then suspends to RAM. When the battery is at 15% or below it adds a "please charge" line.

## Install on the Kindle (after the jailbreak and KUAL)
Connect the Kindle to the Mac over USB, then copy:
- `~/Fridge/kindle/panel` to the Kindle's top level, so it becomes `/mnt/us/panel` (it must include `local.sh`)
- `~/Fridge/kindle/extensions/kindle-panel` to the Kindle's `extensions` folder

Eject the Kindle, open KUAL, choose **Desk panel: test download once**, then **Desk panel: start**.

To leave panel mode, hold the power button about 40 seconds until the Kindle restarts. The panel doesn't start again by itself.

## Files
| File | Purpose |
|---|---|
| `kindle.html` | the layout (preview: `kindle.html?demo=1&fam=1&at=16:10` in a 600×800 window) |
| `kindle/render.py` | screenshot plus greyscale conversion (used by the workflow) |
| `kindle/panel/*.sh` | the Kindle-side loop, the KUAL start entry and a one-off test |
| `kindle/panel/local.sh` | **not in git**: the image URL with the token |
| `kindle/setup.sh` | one-time setup: secrets, Pages source, push |
