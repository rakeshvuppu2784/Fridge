#!/bin/bash
# One-time setup for the Kindle panel. Run from Terminal on the Mac:  bash ~/Fridge/kindle/setup.sh
# Needs: gh signed in (it is), kindle/.dashkey present (written by Claude; deleted at the end).
set -euo pipefail
cd ~/Fridge
REPO=rakeshvuppu2784/Fridge
API='https://script.google.com/macros/s/AKfycby0HGiMg_xgCzBcArMW2MbfbWfSnsz0o5guryPA9CAt_JIU-gPZsZH4kD0L7HYksZ-DEA/exec'

echo "== 1/6 pull"; git pull --rebase --autostash
echo "== 2/6 workflow file"; mkdir -p .github/workflows; [ -f kindle/pages.yml ] && mv kindle/pages.yml .github/workflows/pages.yml
echo "== 3/6 secrets (stored only in GitHub, never in the repo)"
[ -s kindle/.dashkey ] || { echo "kindle/.dashkey missing"; exit 1; }
TOKEN=$(openssl rand -hex 16)
gh secret set DASH_API -R $REPO --body "$API"
gh secret set DASH_KEY -R $REPO < kindle/.dashkey
gh secret set KINDLE_TOKEN -R $REPO --body "$TOKEN"
printf 'PANEL_URL="https://rakeshvuppu2784.github.io/Fridge/k/%s.png"\n' "$TOKEN" > kindle/panel/local.sh
echo "== 4/6 Pages: publish from the workflow instead of the branch"
gh api -X PUT repos/$REPO/pages -f build_type=workflow >/dev/null
echo "== 5/6 commit + push"
git add .gitignore kindle.html kindle/render.py kindle/panel/panel.sh kindle/panel/start.sh kindle/panel/once.sh kindle/local.sh.example kindle/extensions kindle/setup.sh kindle/README.md .github/workflows/pages.yml
git commit -q -m "Kindle e-ink panel: kindle.html, render job, Kindle client" || true
if ! git push; then echo "push failed: trying to add the 'workflow' scope"; gh auth refresh -h github.com -s workflow; git push; fi
echo "== 6/6 waiting for the first publish (~3 min)"
sleep 15
RUN=$(gh run list -R $REPO -w pages.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R $REPO "$RUN" --exit-status || { echo "Publish FAILED - tell Claude"; exit 1; }
rm -f kindle/.dashkey
sleep 20
CODE=$(curl -s -o /tmp/kpanel.png -w '%{http_code}' "https://rakeshvuppu2784.github.io/Fridge/k/$TOKEN.png?t=$RANDOM")
echo "Kindle image: HTTP $CODE, $(wc -c < /tmp/kpanel.png) bytes"
cp /tmp/kpanel.png kindle/preview.png 2>/dev/null || true
echo "DONE. Kindle files are ready in ~/Fridge/kindle/panel and ~/Fridge/kindle/extensions"
