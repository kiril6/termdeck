#!/bin/bash
# Throwaway HOME with a sample repo for README captures. Re-runnable.
# Only wipes folders this script created (marked by a .td-capture file), never an existing folder of yours.
set -e
H="$1"; R="$2"
for m in "$H/.td-capture" "$R/.git/td-capture"; do
  d="${m%/.td-capture}"; d="${d%/.git/td-capture}"
  if [ -e "$d" ] && [ ! -e "$m" ]; then echo "refusing to wipe $d: not created by tools/capture" >&2; exit 1; fi
done
rm -rf "$H" "$R" "$R-worktrees"; mkdir -p "$H" "$R/src" "$R/test"; touch "$H/.td-capture"
cat > "$H/.zshrc" <<'Z'
export PS1=$'%F{cyan}%1~%f $ '
export PROMPT_EOL_MARK=''
unsetopt PROMPT_SP
export GIT_AUTHOR_NAME=dev GIT_AUTHOR_EMAIL=dev@example.com GIT_COMMITTER_NAME=dev GIT_COMMITTER_EMAIL=dev@example.com
export GIT_PAGER=cat NO_UPDATE_NOTIFIER=1 npm_config_update_notifier=false
Z
cd "$R"
cat > package.json <<'J'
{ "name": "shop-api", "version": "0.4.0", "private": true, "scripts": { "test": "node --test --test-reporter=spec" } }
J
cat > src/client.js <<'J'
// HTTP client for the payments provider.
export async function charge(order) {
  const res = await fetch(PROVIDER_URL + '/charges', {
    method: 'POST',
    body: JSON.stringify({ amount: order.total, currency: order.currency }),
  });
  if (!res.ok) throw new Error('charge failed: ' + res.status);
  return res.json();
}

const PROVIDER_URL = process.env.PROVIDER_URL || 'https://payments.example.com';
J
cat > src/webhooks.js <<'J'
// Incoming provider webhooks.
export function handleWebhook(req) {
  const event = JSON.parse(req.body);
  return { type: event.type, id: event.id };
}
J
cat > src/orders.js <<'J'
export function total(items) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}
J
cat > test/orders.test.js <<'J'
import { test } from 'node:test';
import assert from 'node:assert';
import { total } from '../src/orders.js';
test('total sums price × qty', () => assert.equal(total([{ price: 5, qty: 2 }, { price: 1, qty: 3 }]), 13));
test('total of an empty cart is 0', () => assert.equal(total([]), 0));
J
cat > README.md <<'J'
# shop-api
Orders, payments and webhooks for the shop.
J
node -e "const p=require('./package.json');p.type='module';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
export GIT_AUTHOR_NAME=dev GIT_AUTHOR_EMAIL=dev@example.com GIT_COMMITTER_NAME=dev GIT_COMMITTER_EMAIL=dev@example.com
git init -q -b main && git add . && git commit -qm "orders + payments client" && git commit -q --allow-empty -m "webhook skeleton"
touch .git/td-capture
echo ok
