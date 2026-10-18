#!/usr/bin/env bash
# تست‌های واحد برای توابع خالص deploy/install.sh
# اجرا: bash deploy/install.test.sh
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# برای source کردن، main اجرا نمی‌شود (نگهبان BASH_SOURCE).
# shellcheck disable=SC1090
. "$SCRIPT_DIR/install.sh"

# اسکریپت اصلی با set -Eeuo و trap ERR بالا می‌آید؛ در تست این‌ها را خنثی
# می‌کنیم تا یک تستِ ناموفق کل فایل را متوقف نکند.
set +e
trap - ERR

PASS=0
FAIL=0
t() {
  local desc=$1 expected=$2 actual=$3
  if [[ $expected == "$actual" ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL: %s\n  expected: %q\n  actual:   %q\n' "$desc" "$expected" "$actual"
  fi
}

# ------------------------------------------------------------ fa ----
t 'fa: Persian digits' '۱۲۳۴۵۶۷۸۹۰' "$(fa 1234567890)"
t 'fa: no digits' 'سلام' "$(fa 'سلام')"
t 'fa: converts digits, keeps punctuation' 'نسخهٔ ۲.۰.۰' "$(fa 'نسخهٔ 2.0.0')"
t 'fa: empty' '' "$(fa '')"

# --------------------------------------------------- valid_path ----
t 'valid_path: normal' 'yes' "$(valid_path /var/www/hamgam && echo yes || echo no)"
t 'valid_path: rejects relative' 'no' "$(valid_path var/www && echo yes || echo no)"
t 'valid_path: rejects ..' 'no' "$(valid_path /var/../etc && echo yes || echo no)"
t 'valid_path: rejects empty' 'no' "$(valid_path '' && echo yes || echo no)"

# --------------------------------------------------- guard_webroot ----
guard_webroot /var/www/hamgam >/dev/null 2>&1
t 'guard_webroot: accepts /var/www/hamgam' '0' "$?"

for bad in / /etc /usr/bin /var /opt /root /dev/null '..' ''; do
  # در subshell اجرا می‌کنیم چون die از exit استفاده می‌کند.
  (guard_webroot "$bad" >/dev/null 2>&1)
  t "guard_webroot: rejects '$bad'" '1' "$?"
done

# ------------------------------------------- build_server_names ----
OPT_DOMAIN='fit.example.com'
OPT_EXTRA_HOSTS=''
t 'server_names: single' 'fit.example.com' "$(build_server_names)"
OPT_EXTRA_HOSTS='www.example.com, fit2.example.com'
t 'server_names: extras trimmed' 'fit.example.com www.example.com fit2.example.com' "$(build_server_names)"
OPT_EXTRA_HOSTS='www.example.com'

# ------------------------------------- validate_extra_hosts ----
OPT_EXTRA_HOSTS='www.example.com,fit.example.com'
validate_extra_hosts >/dev/null 2>&1
t 'extra_hosts: valid accepted' '0' "$?"
(OPT_EXTRA_HOSTS='not a domain' validate_extra_hosts >/dev/null 2>&1)
t 'extra_hosts: invalid rejected' '1' "$?"

# ------------------------------------------ domain/email regex ----
for d in fit.example.com a-b.example.co.uk sub.domain.example.com; do
  [[ $d =~ $VALID_DOMAIN_RE ]]
  t "domain regex: accepts $d" '0' "$?"
done
for d in '-bad.example.com' 'nodot' 'a..b.com' 'example.c' '' 'a b.com'; do
  if [[ $d =~ $VALID_DOMAIN_RE ]]; then r=0; else r=1; fi
  t "domain regex: rejects '$d'" '1' "$r"
done
for e in me@example.com a.b+c@sub.example.co.uk; do
  [[ $e =~ $VALID_EMAIL_RE ]]
  t "email regex: accepts $e" '0' "$?"
done
for e in 'noat' 'a@b' 'a b@example.com' '@example.com' ''; do
  if [[ $e =~ $VALID_EMAIL_RE ]]; then r=0; else r=1; fi
  t "email regex: rejects '$e'" '1' "$r"
done

# ------------------------------------------ write_if_changed ----
TMP=$(mktemp -d)
export TMPDIR="$TMP"
trap 'rm -rf "$TMP"' EXIT
target="$TMP/f.conf"
write_if_changed "$target" <<<"alpha" >/dev/null 2>&1
t 'write_if_changed: first write returns 0' '0' "$?"
t 'write_if_changed: content written' 'alpha' "$(cat "$target")"
write_if_changed "$target" <<<"alpha" >/dev/null 2>&1
t 'write_if_changed: identical returns 1' '1' "$?"
write_if_changed "$target" <<<"beta" >/dev/null 2>&1
t 'write_if_changed: changed returns 0' '0' "$?"
t 'write_if_changed: content updated' 'beta' "$(cat "$target")"
t 'write_if_changed: mode 0644' '644' "$(stat -c '%a' "$target")"
# فایل موقت باید همان‌جا پاک شود؛ mktemp روی هر پلتفرمی جای دیگری می‌سازد،
# پس شمارش فایل‌های موقتِ بی‌صاحب در برابر الگوی خودمان انجام می‌شود.
t 'write_if_changed: no temp leak' '0' "$(find "${TMPDIR:-/tmp}" /tmp -maxdepth 1 -name 'hamgam-wic.*' 2>/dev/null | wc -l | tr -d ' ')"

# ------------------------------------------- nginx config paths ----
# مسیرهای تولیدشده باید به پیوند نسخه اشاره کنند، نه به پوشهٔ تخت.
OPT_WEBROOT="$TMP/www"
init_paths
t 'init_paths: SITE_ROOT' "$TMP/www" "$SITE_ROOT"
t 'init_paths: RELEASES_DIR' "$TMP/www/releases" "$RELEASES_DIR"
t 'init_paths: CURRENT_LINK' "$TMP/www/current" "$CURRENT_LINK"

# ------------------------------------- config heredoc assembly ----
# بازتولید همان heredoc ای که write_site_config می‌نویسد، بدون تماس با nginx.
OPT_EXTRA_HOSTS=''
CURRENT_LINK='/var/www/hamgam/current'
server_names=$(build_server_names)
CONF=$(cat <<EOF
server {
    listen 80;
    server_name $server_names;
    root $CURRENT_LINK;
    include /etc/nginx/snippets/hamgam-headers.conf;
    add_header Cache-Control \$hamgam_cache always;
    location /assets/ { try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
)
t 'site config: root is current symlink' 'yes' "$(grep -q 'root /var/www/hamgam/current;' <<<"$CONF" && echo yes || echo no)"
t 'site config: server_name present' 'yes' "$(grep -q 'server_name fit.example.com;' <<<"$CONF" && echo yes || echo no)"
t 'site config: $hamgam_cache not expanded' 'yes' "$(grep -q 'Cache-Control \$hamgam_cache' <<<"$CONF" && echo yes || echo no)"
t 'site config: $uri not expanded' 'yes' "$(grep -q 'try_files \$uri =404;' <<<"$CONF" && echo yes || echo no)"
t 'site config: no stray backslash-dollar' '0' "$(grep -c '\\\$' <<<"$CONF" | tr -d ' ')"
t 'site config: headers included once' '1' "$(grep -c 'include /etc/nginx/snippets/hamgam-headers.conf;' <<<"$CONF" | tr -d ' ')"

# --------------------------------------------- cache map content ----
MAP=$(cat <<'EOF'
map $uri $hamgam_cache {
    default                            "no-cache";
    ~^/assets/                         "public, max-age=31536000, immutable";
    ~^/workbox-[A-Za-z0-9_-]+\.js$     "no-cache, must-revalidate";
    =/index.html                       "no-cache, must-revalidate";
    =/sw.js                            "no-cache, must-revalidate";
    =/manifest.webmanifest             "no-cache, must-revalidate";
    =/robots.txt                       "public, max-age=3600";
}
EOF
)
t 'cache map: default no-cache' 'yes' "$(grep -q 'default  *"no-cache"' <<<"$MAP" && echo yes || echo no)"
t 'cache map: assets immutable' 'yes' "$(grep -q '/assets/' <<<"$MAP" && grep -q 'immutable' <<<"$MAP" && echo yes || echo no)"
t 'cache map: sw.js no-cache' 'yes' "$(grep -q '=/sw.js  *"no-cache, must-revalidate"' <<<"$MAP" && echo yes || echo no)"

# ----------------------------------------------- merge_previous ----
# نسخهٔ پیشین باید فایل‌های هش‌دار خودش را در نسخهٔ تازه نگه دارد.
NEW="$TMP/rel/new"; OLD="$TMP/rel/old"
mkdir -p "$NEW/assets" "$OLD/assets"
echo 'new-app' >"$NEW/assets/index-NEW.js"
echo 'old-lazy' >"$OLD/assets/DataChart-OLD.js"
echo 'shared' >"$OLD/assets/shared.js"
echo 'shared' >"$NEW/assets/shared.js"
merge_previous_assets "$NEW" "$OLD" >/dev/null 2>&1
t 'merge: keeps old unique asset' 'yes' "$([[ -f $NEW/assets/DataChart-OLD.js ]] && echo yes || echo no)"
t 'merge: keeps new asset' 'yes' "$([[ -f $NEW/assets/index-NEW.js ]] && echo yes || echo no)"
t 'merge: does not overwrite existing' 'yes' "$([[ -f $NEW/assets/shared.js ]] && echo yes || echo no)"
bak=$(find "$TMP/rel/new" -name '*.js.bak' | wc -l | tr -d ' ')
t 'merge: no .bak files left' '0' "$bak"
# بدون نسخهٔ پیشین نباید خطا بدهد
merge_previous_assets "$NEW" '' >/dev/null 2>&1
t 'merge: tolerates empty previous' '0' "$?"

# ------------------------------------------- atomic_swap + rollback ----
SITE="$TMP/site"
mkdir -p "$SITE/releases/r1" "$SITE/releases/r2"
echo one >"$SITE/releases/r1/index.html"
echo two >"$SITE/releases/r2/index.html"
OPT_WEBROOT="$SITE"
init_paths
atomic_swap "$SITE/releases/r1"
t 'atomic_swap: link created' 'yes' "$([[ -L $CURRENT_LINK ]] && echo yes || echo no)"
t 'atomic_swap: points to r1' "$SITE/releases/r1" "$(readlink "$CURRENT_LINK")"
atomic_swap "$SITE/releases/r2"
t 'atomic_swap: repoints to r2' "$SITE/releases/r2" "$(readlink "$CURRENT_LINK")"
t 'atomic_swap: still a symlink' 'yes' "$([[ -L $CURRENT_LINK ]] && echo yes || echo no)"
t 'atomic_swap: no tmp left behind' 'no' "$([[ -e $SITE/.current.tmp ]] && echo yes || echo no)"

printf '%s\n' "$SITE/releases/r1" >"$PREVIOUS_MARK"
rollback_deploy >/dev/null 2>&1
t 'rollback: back to r1' "$SITE/releases/r1" "$(readlink "$CURRENT_LINK")"
t 'rollback: clears SWAP_DONE' '0' "$SWAP_DONE"
# بدون نشانه، باید فقط هشدار بدهد
rm -f "$PREVIOUS_MARK"
rollback_deploy >/dev/null 2>&1
t 'rollback: no marker is safe' '0' "$?"

# ------------------------------------ migrate_legacy_layout ----
LEG="$TMP/legacy"; mkdir -p "$LEG"
echo old >"$LEG/index.html"
echo oldsw >"$LEG/sw.js"
mkdir -p "$LEG/assets" && echo a >"$LEG/assets/x.js"
OPT_WEBROOT="$LEG"
init_paths
migrate_legacy_layout >/dev/null 2>&1
t 'migrate: current link now exists' 'yes' "$([[ -L $CURRENT_LINK ]] && echo yes || echo no)"
t 'migrate: flat index.html moved out' 'no' "$([[ -e $LEG/index.html ]] && echo yes || echo no)"
t 'migrate: releases dir kept' 'yes' "$([[ -d $RELEASES_DIR ]] && echo yes || echo no)"
t 'migrate: previous marker written' 'yes' "$([[ -r $PREVIOUS_MARK ]] && echo yes || echo no)"
t 'migrate: is idempotent' '0' "$(migrate_legacy_layout >/dev/null 2>&1; echo $?)"

# --------------------------------------------- validate_build ----
VB="$TMP/vb"; mkdir -p "$VB/assets"
cat >"$VB/index.html" <<'EOF'
<!doctype html><html><body><div id="root"></div>
<script type="module" src="/assets/index-ABC.js"></script>
<link rel="stylesheet" href="/assets/index-XYZ.css">
</body></html>
EOF
echo 'self.precacheAndRoute([])' >"$VB/sw.js"
echo '{}' >"$VB/manifest.webmanifest"
echo 'x' >"$VB/assets/index-ABC.js"
echo 'y' >"$VB/assets/index-XYZ.css"
# die از exit استفاده می‌کند؛ پس validate_build را داخل یک subshell تودرتو
# اجرا می‌کنیم تا exit فقط همان subshell را ببندد و کد خروج قابل خواندن بماند.
vb_code() { (validate_build "$1" >/dev/null 2>&1); echo $?; }

t 'validate_build: good build accepted' '0' "$(vb_code "$VB")"

mv "$VB/sw.js" "$VB/sw.bak"
t 'validate_build: missing sw.js rejected' '1' "$(vb_code "$VB")"
mv "$VB/sw.bak" "$VB/sw.js"

mv "$VB/assets/index-ABC.js" "$VB/a.bak"
t 'validate_build: missing asset rejected' '1' "$(vb_code "$VB")"
mv "$VB/a.bak" "$VB/assets/index-ABC.js"

# خروجی ساخته‌شده برای GitHub Pages روی دامنهٔ ریشه همه‌چیز را ۴۰۴ می‌کند.
sed 's#/assets/#/fit-tracker-pwa/assets/#g' "$VB/index.html" >"$VB/i2"
mv "$VB/i2" "$VB/index.html"
t 'validate_build: pages-base build rejected' '1' "$(vb_code "$VB")"
sed 's#/fit-tracker-pwa/assets/#/assets/#g' "$VB/index.html" >"$VB/i3"
mv "$VB/i3" "$VB/index.html"

echo 'console.log(1)' >"$VB/sw.js"
t 'validate_build: non-workbox sw rejected' '1' "$(vb_code "$VB")"
echo 'self.precacheAndRoute([])' >"$VB/sw.js"

sed 's/id="root"/id="other"/' "$VB/index.html" >"$VB/i4"
mv "$VB/i4" "$VB/index.html"
t 'validate_build: no-root html rejected' '1' "$(vb_code "$VB")"
sed 's/id="other"/id="root"/' "$VB/index.html" >"$VB/i5"
mv "$VB/i5" "$VB/index.html"

t 'validate_build: still accepts the restored build' '0' "$(vb_code "$VB")"

# --------------------------------------------------------- نتیجه ----
printf '\n──────────────────────────────\n'
printf 'passed: %d\nfailed: %d\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
