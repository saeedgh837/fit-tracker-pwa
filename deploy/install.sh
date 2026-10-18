#!/usr/bin/env bash
#
# همگام | نصب‌کنندهٔ خودکار روی Ubuntu/Debian با nginx و TLS
#
# استفادهٔ سریع:
#   sudo bash deploy/install.sh
#
# حالت غیرتعاملی (برای CI یا نصب مجدد):
#   sudo bash deploy/install.sh --non-interactive \
#     --domain fit.example.com --email me@example.com --yes
#
# به‌روزرسانی یک نصب موجود:
#   sudo bash deploy/install.sh --update
#
# بازگردانی به نسخهٔ قبلی:
#   sudo bash deploy/install.sh --rollback
#
# ── ساختار استقرار ─────────────────────────────────────────────────────────
# فایل‌ها هرگز مستقیم روی نسخهٔ زنده کپی نمی‌شوند. هر اجرا یک نسخهٔ کامل و
# مستقل می‌سازد و در پایان یک پیوند نمادین به‌صورت اتمیک جابه‌جا می‌شود:
#
#   <webroot>/releases/20261019-010203-a1b2c3d   ← نسخهٔ کامل
#   <webroot>/current -> releases/...            ← پیوند اتمیک (ریشهٔ nginx)
#   <webroot>/.previous                          ← نسخهٔ پیشین، برای بازگردانی
#
# این کار یعنی هیچ‌وقت نسخهٔ نیمه‌کپی‌شده روی سایت نیست، تب‌های باز نسخهٔ قبلی
# هم فایل‌های هش‌دار قدیمی را از دست نمی‌دهند (asset های نسخهٔ پیشین در نسخهٔ
# تازه نگه داشته می‌شوند) و اگر تست سلامت شکست بخورد، خودکار به نسخهٔ پیشین
# بازگردانده می‌شود.
#
# اجرای دوبارهٔ اسکریپت بی‌خطر و idempotent است.

set -Eeuo pipefail

readonly SCRIPT_VERSION='2.0.0'
readonly APP_NAME='همگام'
readonly REPO_URL_DEFAULT='https://github.com/saeedgh837/fit-tracker-pwa.git'
readonly CONF_DIR='/etc/hamgam'
readonly CONF_FILE="$CONF_DIR/install.conf"
readonly LOG_FILE='/var/log/hamgam-install.log'
readonly NGINX_SITE='/etc/nginx/sites-available/hamgam'
readonly NGINX_LINK='/etc/nginx/sites-enabled/hamgam'
readonly HEADERS_SNIPPET='/etc/nginx/snippets/hamgam-headers.conf'
readonly CACHE_MAP='/etc/nginx/conf.d/hamgam-cache.conf'
readonly LOCK_FILE='/run/lock/hamgam-install.lock'
readonly NODE_MAJOR='22'
readonly RELEASES_KEEP=3
readonly TOTAL_STEPS=10

# ---------------------------------------------------------------- رنگ‌ها ----
# فقط وقتی رنگ می‌دهیم که خروجی یک ترمینال واقعی باشد و NO_COLOR تنظیم نشده باشد.
if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-dumb}" != 'dumb' ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[38;5;203m'
  C_GREEN=$'\033[38;5;78m'
  C_YELLOW=$'\033[38;5;221m'
  C_CYAN=$'\033[38;5;80m'
  C_TEAL=$'\033[38;5;37m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_CYAN='' C_TEAL=''
fi
readonly C_RESET C_BOLD C_DIM C_RED C_GREEN C_YELLOW C_CYAN C_TEAL

readonly PERSIAN_DIGITS=(۰ ۱ ۲ ۳ ۴ ۵ ۶ ۷ ۸ ۹)

# fa <عدد لاتین>: ارقام فارسی، برای متن‌های فارسی داخل پیام‌ها.
fa() {
  local input=$1 out='' i ch
  for ((i = 0; i < ${#input}; i++)); do
    ch=${input:i:1}
    if [[ $ch =~ [0-9] ]]; then out+="${PERSIAN_DIGITS[$ch]}"; else out+="$ch"; fi
  done
  printf '%s' "$out"
}

# ------------------------------------------------------------ چاپ و لاگ ----
LOG_READY=0
# از همان ابتدا به /dev/null اشاره می‌کند تا اگر هر خطی پیش از init_log اجرا
# شد، ریدایرکت‌های «2>>$LOG_PATH» بی‌خطر باشند؛ اگر نبود، شکست ریدایرکت خودش
# با set -e اسکریپت را می‌کشت، نه فقط لاگ را.
LOG_PATH=/dev/null
init_log() {
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  if : >"$LOG_FILE" 2>/dev/null; then
    LOG_READY=1
    LOG_PATH=$LOG_FILE
  fi
  if [[ $LOG_READY -eq 1 ]]; then
    {
      printf 'همگام installer v%s | %s\n' "$SCRIPT_VERSION" "$(date -Is)"
      printf 'command: %s\n\n' "$*"
    } >>"$LOG_PATH"
  fi
}
log() {
  [[ $LOG_READY -eq 1 ]] || return 0
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG_PATH"
  return 0
}

ui_out() { printf '%b\n' "$*"; log "$(printf '%s' "$*" | sed 's/\x1b\[[0-9;]*m//g')"; }
plain() { ui_out "${C_RESET}$*${C_RESET}"; }
ok() { ui_out "${C_GREEN}  ✓${C_RESET} $*"; }
warn() { ui_out "${C_YELLOW}  ▲${C_RESET} $*"; }
note() { ui_out "${C_DIM}    $*${C_RESET}"; }
bad() { ui_out "${C_RED}  ✗${C_RESET} $*"; }

hr() { ui_out "${C_DIM}  ────────────────────────────────────────────────────────────${C_RESET}"; }

banner() {
  ui_out ''
  ui_out "${C_TEAL}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
  ui_out "${C_TEAL}${C_BOLD}   │${C_RESET}  ${C_BOLD}${APP_NAME}${C_RESET}  ${C_DIM}نصب‌کنندهٔ سرور${C_RESET}                                   ${C_TEAL}${C_BOLD}│${C_RESET}"
  ui_out "${C_TEAL}${C_BOLD}   │${C_RESET}  ${C_DIM}برنامهٔ سلامت روزانه · بدون سرور داده · آفلاین${C_RESET}          ${C_TEAL}${C_BOLD}│${C_RESET}"
  ui_out "${C_TEAL}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
  ui_out "${C_DIM}    نسخهٔ نصب‌کننده $(fa "$SCRIPT_VERSION") · لاگ: $LOG_FILE${C_RESET}"
  ui_out ''
}

STEP_INDEX=0
step() {
  STEP_INDEX=$((STEP_INDEX + 1))
  ui_out ''
  ui_out "${C_CYAN}${C_BOLD}  ▸ گام $(fa "$STEP_INDEX") از $(fa "$TOTAL_STEPS"): $*${C_RESET}"
  hr
}

die() {
  bad "$*"
  ui_out ''
  ui_out "${C_RED}${C_BOLD}  نصب متوقف شد.${C_RESET}"
  ui_out "  ${C_DIM}نسخهٔ زندهٔ سایت دست‌نخورده است؛ اگر جابه‌جایی نسخه انجام شده بود، خودکار بازگردانده می‌شود.${C_RESET}"
  if [[ $LOG_READY -eq 1 ]]; then ui_out "  ${C_DIM}لاگ کامل: $LOG_FILE${C_RESET}"; fi
  exit 1
}

on_error() {
  local code=$1 line=$2 cmd=$3

  # داخل یک زیرپوسته (مثلاً $(...) در آرگومان یک دستور) فراخوانی می‌شویم.
  # آن‌جا die فقط همان زیرپوسته را می‌بندد و اسکریپت اصلی ادامه می‌دهد؛ پس
  # نباید پیام «نصب متوقف شد» چاپ کنیم، وگرنه کاربر فکر می‌کند نصب شکست خورده
  # در حالی که ادامه یافته است. به‌جایش یک هشدار صریح می‌دهیم.
  if [[ ${BASH_SUBSHELL:-0} -gt 0 ]]; then
    bad "یک دستور کمکی در زیرپوسته شکست خورد (کد $(fa "$code")): $cmd"
    log "SUBSHELL ERROR line $line: $cmd (exit $code)"
    return 0
  fi

  bad "دستور زیر با کد $(fa "$code") شکست خورد"
  note "خط $(fa "$line"): $cmd"
  if [[ ${SWAP_DONE:-0} -eq 1 ]]; then
    warn 'نسخهٔ تازه فعال شده بود؛ بازگردانی به نسخهٔ پیشین…'
    rollback_deploy || true
  fi
  die 'جزئیات در لاگ ثبت شد.'
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

# ------------------------------------------------------------ آرگومان‌ها ----
NON_INTERACTIVE=0
ASSUME_YES=0
UPDATE_ONLY=0
ROLLBACK_ONLY=0
OPT_DOMAIN=''
OPT_EMAIL=''
OPT_SOURCE=''
OPT_GIT_URL=''
OPT_GIT_REF='main'
OPT_WEBROOT=''
OPT_REPO_DIR=''
OPT_DIST=''
OPT_EXTRA_HOSTS=''
OPT_CF_CREDENTIALS=''
OPT_ENABLE_CSP=1
OPT_SKIP_TLS=0
OPT_KEEP_DEFAULT_SITE=0

usage() {
  cat <<'USAGE'
همگام | نصب‌کنندهٔ سرور

  sudo bash deploy/install.sh [گزینه‌ها]

گزینه‌ها:
  --domain <name>        دامنهٔ اصلی، مثل fit.example.com
  --email <address>      ایمیل برای Let's Encrypt
  --extra-hosts <list>   دامنه‌های اضافی با کاما، مثل www.example.com,fit.example.com
  --source <git|local|prebuilt>
                           git: clone و build روی سرور (پیش‌فرض)
                           local: از همین مخزن محلی build کن
                           prebuilt: از پوشهٔ dist آماده deploy کن
  --git-url <url>        نشانی مخزن برای حالت git
  --git-ref <ref>        شاخه یا تگ (پیش‌فرض main)
  --dist <path>          پوشهٔ dist آماده، برای حالت prebuilt
  --webroot <path>       مسیر نگهداری نسخه‌ها (پیش‌فرض /var/www/hamgam)
  --repo-dir <path>      مسیر کلون مخزن (پیش‌فرض /opt/hamgam)
  --cf-credentials <file>
                           فایل مجوز Cloudflare برای گرفتن گواهی با DNS-01.
                           وقتی دامنه پشت پروکسی Cloudflare است لازم می‌شود.
                           قالب فایل: dns_cloudflare_api_token = <توکن>
  --keep-default-site    کانفیگ پیش‌فرض nginx را دست نزن (پیش‌فرض: پرسیده می‌شود)
  --no-csp               هدر Content-Security-Policy را نگذار
  --skip-tls             گواهی SSL نصب نکن، فقط HTTP (حالت آزمایشی)
  --non-interactive      هیچ سؤالی نپرس؛ فقط با گزینه‌های داده‌شده کار کن
  --update               نصب موجود را به‌روزرسانی کن (فقط سورس و استقرار)
  --rollback             به نسخهٔ پیشین بازگردان
  --yes                  تأییدهای تأییدی را خودکار بپذیر
  --help                 همین راهنما
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --domain) OPT_DOMAIN=${2:-}; shift 2 ;;
      --email) OPT_EMAIL=${2:-}; shift 2 ;;
      --extra-hosts) OPT_EXTRA_HOSTS=${2:-}; shift 2 ;;
      --source) OPT_SOURCE=${2:-}; shift 2 ;;
      --git-url) OPT_GIT_URL=${2:-}; shift 2 ;;
      --git-ref) OPT_GIT_REF=${2:-}; shift 2 ;;
      --dist) OPT_DIST=${2:-}; shift 2 ;;
      --webroot) OPT_WEBROOT=${2:-}; shift 2 ;;
      --repo-dir) OPT_REPO_DIR=${2:-}; shift 2 ;;
      --cf-credentials) OPT_CF_CREDENTIALS=${2:-}; shift 2 ;;
      --no-csp) OPT_ENABLE_CSP=0; shift ;;
      --skip-tls) OPT_SKIP_TLS=1; shift ;;
      --keep-default-site) OPT_KEEP_DEFAULT_SITE=1; shift ;;
      --non-interactive) NON_INTERACTIVE=1; shift ;;
      --update) UPDATE_ONLY=1; shift ;;
      --rollback) ROLLBACK_ONLY=1; shift ;;
      --yes | -y) ASSUME_YES=1; shift ;;
      --help | -h) usage; exit 0 ;;
      *) die "گزینهٔ ناشناخته: $1 (با --help راهنما را ببینید)" ;;
    esac
  done
}

# -------------------------------------------------------- ابزارهای کمکی ----
have() { command -v "$1" >/dev/null 2>&1; }

# اجرای دستور با ثبت کامل خروجی در لاگ.
run_logged() {
  log "run: $*"
  if [[ $LOG_READY -eq 1 ]]; then
    if ! "$@" >>"$LOG_PATH" 2>&1; then
      log "FAILED: $*"
      return 1
    fi
  else
    if ! "$@" >/dev/null 2>&1; then
      log "FAILED: $*"
      return 1
    fi
  fi
  return 0
}

# انتظار برای آزاد شدن قفل apt؛ روی سرور تازه ممکن است unattended-upgrades
# در حال کار باشد و بدون این کار نصب بسته‌ها شکست می‌خورد.
wait_for_apt() {
  local waited=0 limit=300
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 ||
    fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
    if [[ $waited -eq 0 ]]; then
      warn 'مدیر بسته‌ها مشغول است (احتمالاً به‌روزرسانی خودکار). کمی صبر می‌کنیم…'
    fi
    sleep 5
    waited=$((waited + 5))
    if [[ $waited -ge $limit ]]; then
      die 'قفل apt پس از ۵ دقیقه آزاد نشد. دستور unattended-upgrades را بررسی کنید.'
    fi
  done
  if [[ $waited -gt 0 ]]; then ok 'قفل apt آزاد شد.'; fi
  return 0
}

apt_install() {
  wait_for_apt
  run_logged env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

ask_value() {
  # ask_value <نام متغیر> <برچسب> <پیش‌فرض> <الگوی اعتبارسنجی> <پیام خطا>
  local __var=$1 label=$2 default=$3 pattern=$4 errmsg=$5 input=''
  while true; do
    if [[ -n $default ]]; then
      ui_out "${C_BOLD}  $label${C_RESET} ${C_DIM}[$default]${C_RESET}"
    else
      ui_out "${C_BOLD}  $label${C_RESET}"
    fi
    read -r -p "  › " input || die 'ورودی خوانده نشد.'
    input=${input:-$default}
    if [[ -z $input ]]; then
      bad 'این مقدار لازم است.'
      continue
    fi
    if [[ -n $pattern && ! $input =~ $pattern ]]; then
      bad "$errmsg"
      continue
    fi
    printf -v "$__var" '%s' "$input"
    return 0
  done
}

ask_yes_no() {
  # ask_yes_no <برچسب> <پیش‌فرض y|n>
  local label=$1 default=${2:-n} input='' hint
  if [[ $ASSUME_YES -eq 1 ]]; then return 0; fi
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    [[ $default == y ]]
    return
  fi
  hint='y/N'
  [[ $default == y ]] && hint='Y/n'
  while true; do
    ui_out "${C_BOLD}  $label${C_RESET} ${C_DIM}($hint)${C_RESET}"
    read -r -p "  › " input || die 'ورودی خوانده نشد.'
    input=${input:-$default}
    case ${input,,} in
      y | yes | بله | آره) return 0 ;;
      n | no | خیر | نه) return 1 ;;
      *) bad 'لطفاً y یا n بنویسید.' ;;
    esac
  done
}

# --------------------------------------------------------- اعتبارسنجی‌ها ----
VALID_DOMAIN_RE='^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'
VALID_EMAIL_RE='^[^@[:space:]]+@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'

valid_path() { [[ $1 == /* && $1 != *..* && ${#1} -lt 200 ]]; }

# محافظ حیاتی: هرگز اجازه نمی‌دهیم مسیری که پاک می‌شود ریشه یا پوشهٔ سیستمی باشد.
guard_webroot() {
  local p=${1:-}
  [[ -n $p ]] || die 'مسیر انتشار خالی است.'
  valid_path "$p" || die "مسیر انتشار نامعتبر است: $p"
  case $p in
    / | /etc | /etc/* | /usr | /usr/* | /bin | /bin/* | /sbin | /sbin/* | \
      /lib | /lib/* | /lib64 | /lib64/* | /boot | /boot/* | /dev | /dev/* | \
      /proc | /proc/* | /sys | /sys/* | /root | /root/* | /var | /home | /opt | /srv)
      die "مسیر انتشار برای این کار مناسب نیست: $p"
      ;;
  esac
  local depth
  depth=$(awk -F/ '{print NF-1}' <<<"$p")
  if [[ $depth -lt 2 ]]; then
    die "مسیر انتشار باید حداقل دو سطح داشته باشد (مثل /var/www/hamgam): $p"
  fi
  if [[ -e $p && ! -d $p ]]; then
    die "مسیر انتشار یک پوشه نیست: $p"
  fi
  return 0
}

acquire_lock() {
  local dir
  dir=$(dirname "$LOCK_FILE")
  [[ -d $dir ]] || dir=/tmp
  if ! exec 9>"$dir/hamgam-install.lock" 2>/dev/null; then
    if ! exec 9>/tmp/hamgam-install.lock 2>/dev/null; then
      warn 'قفل فایل ساخته نشد؛ بدون قفل ادامه می‌دهیم.'
      return 0
    fi
  fi
  if ! flock -w 300 9; then
    die 'اجرای دیگری از این نصب‌کننده در حال کار است. چند دقیقه بعد دوباره تلاش کنید.'
  fi
  return 0
}

# -------------------------------------------------------------پیش‌نیازها ----
need_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    plain ''
    plain "  ${C_YELLOW}این اسکریپت برای نصب بسته‌ها و تنظیم nginx به دسترسی root نیاز دارد.${C_RESET}"
    plain "  ${C_DIM}همین حالا با sudo دوباره اجرا می‌شود؛ ممکن است رمز عبور بپرسد.${C_RESET}"
    plain ''
    if ! have sudo; then
      die 'sudo نصب نیست. اسکریپت را با کاربر root اجرا کنید.'
    fi
    exec sudo -E bash "$0" "$@"
  fi
}

# nginx نصب‌شده از snap یا مسیر غیربستهٔ apt با این نصب‌کننده سازگار نیست؛
# باید پیش از هر تغییری تشخیص داده شود، نه بعد از نصب نسخهٔ apt.
detect_foreign_nginx() {
  have nginx || return 0
  local bin
  bin=$(readlink -f "$(command -v nginx)" 2>/dev/null || true)
  [[ -n $bin ]] || return 0
  case $bin in
    /snap/*)
      die "nginx از snap نصب شده است ($bin). این نصب‌کننده فقط بستهٔ apt را مدیریت می‌کند. با «sudo snap remove nginx» حذفش کنید و دوباره اجرا کنید."
      ;;
    /usr/sbin/nginx | /usr/bin/nginx) ;;
    *)
      warn "nginx از مسیر غیرمعمول اجرا می‌شود: $bin"
      if [[ $NON_INTERACTIVE -eq 0 ]]; then
        ask_yes_no 'ادامه می‌دهیم؟ کانفیگ ممکن است در مسیر دیگری نوشته شود.' n ||
          die 'به‌درخواست شما متوقف شد.'
      fi
      ;;
  esac
  return 0
}

check_ports_free() {
  have ss || return 0
  local busy='' port svc
  for port in 80 443; do
    if ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then
      svc=$(ss -H -ltnp "sport = :$port" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -1 || true)
      if [[ $svc == nginx ]]; then continue; fi
      busy+="${port} (${svc:-نامشخص}) "
    fi
  done
  if [[ -n $busy ]]; then
    bad "پورت‌های زیر در اختیار سرویس دیگری هستند: $busy"
    note 'اگر Apache یا سرویس دیگری روی این پورت‌ها است، اول آن را متوقف کنید:'
    note '  sudo systemctl stop apache2 && sudo systemctl disable apache2'
    die 'پورت‌های لازم آزاد نیستند.'
  fi
  ok 'پورت‌های ۸۰ و ۴۴۳ آزادند'
  return 0
}

preflight() {
  step 'بررسی سیستم و پیش‌نیازها'

  if [[ ! -r /etc/os-release ]]; then
    die 'فایل /etc/os-release پیدا نشد؛ سیستم‌عامل پشتیبانی نمی‌شود.'
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  local id=${ID:-unknown} ver=${VERSION_ID:-0}
  case $id in
    ubuntu | debian) ;;
    *) die "این نصب‌کننده برای Ubuntu و Debian نوشته شده است؛ سیستم فعلی: $id" ;;
  esac
  ok "سیستم: ${PRETTY_NAME:-$id $ver}"
  log "os: $PRETTY_NAME arch: $(uname -m)"

  local arch
  arch=$(uname -m)
  if [[ $arch != x86_64 && $arch != aarch64 && $arch != arm64 ]]; then
    warn "معماری $arch آزمایش‌نشده است؛ ادامه می‌دهیم."
  fi

  if ! [[ $ver =~ ^[0-9]+ ]]; then
    warn "نسخهٔ سیستم‌عامل خوانده نشد ($ver)؛ ادامه می‌دهیم."
  elif [[ $id == ubuntu && ${ver%%.*} -lt 22 ]]; then
    warn "اوبونتو $(fa "$ver") قدیمی است؛ پیشنهاد می‌شود ۲۲٫۰۴ یا بالاتر."
  fi

  detect_foreign_nginx
  check_ports_free

  # فضای دیسک: سورس + node_modules + dist حدود ۱ گیگابایت لازم دارد.
  local avail_kb
  avail_kb=$(df -Pk / | awk 'NR==2 {print $4}')
  if [[ -n $avail_kb && $avail_kb -lt 1500000 ]]; then
    die "فضای دیسک کافی نیست: $(fa "$((avail_kb / 1024))") مگابایت آزاد است، حداقل ۱۵۰۰ مگابایت لازم است."
  fi
  ok "فضای دیسک: $(fa "$((avail_kb / 1024 / 1024))") گیگابایت آزاد"

  # اینترنت و DNS
  if ! getent hosts deb.debian.org >/dev/null 2>&1 && ! getent hosts archive.ubuntu.com >/dev/null 2>&1; then
    die 'اتصال به مخازن بسته‌ها برقرار نشد. اینترنت یا DNS سرور را بررسی کنید.'
  fi
  ok 'دسترسی به مخازن بسته‌ها برقرار است'

  # ابزارهای پایه‌ای که خود اسکریپت لازم دارد.
  local missing=() tool
  for tool in curl ca-certificates; do
    dpkg -s "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    note "نصب ابزارهای پایه: ${missing[*]}"
    if ! run_logged apt-get update -qq; then die 'apt-get update ناموفق بود.'; fi
    apt_install "${missing[@]}" || die 'نصب ابزارهای پایه ناموفق بود.'
  fi
  ok 'ابزارهای پایه موجودند'

  # هشدار حافظه: build روی سرور ۱ گیگابایتی می‌تواند OOM شود.
  local mem_mb swap_mb
  mem_mb=$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo)
  swap_mb=$(awk '/^SwapTotal:/ {printf "%d", $2/1024}' /proc/meminfo)
  log "mem: ${mem_mb}MB swap: ${swap_mb}MB"
  if [[ -n $mem_mb && $mem_mb -lt 1500 && $swap_mb -lt 512 ]]; then
    warn "حافظهٔ سرور کم است (RAM $(fa "$mem_mb") مگابایت، swap $(fa "$swap_mb") مگابایت)."
    note 'ساخت روی سرور ممکن است ناکام بماند. پیشنهاد می‌شود با --source prebuilt از خروجی CI استفاده کنید،'
    note 'یا اول swap بسازید: sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile'
  fi
  return 0
}

# ------------------------------------------------------------ تنظیمات -------
load_saved_conf() {
  [[ -r $CONF_FILE ]] || return 1
  # مقادیر قبلی پاک می‌شوند تا اگر فایل تنظیمات کلیدی را نداشت، مقدار قدیمی
  # باقی نماند و به‌جای خطای روشن، بی‌صدا با مقدار کهنه ادامه ندهیم.
  # shellcheck disable=SC2034
  CFG_DOMAIN='' CFG_EMAIL='' CFG_SOURCE='' CFG_GIT_URL='' CFG_GIT_REF=''
  CFG_WEBROOT='' CFG_REPO_DIR='' CFG_EXTRA_HOSTS='' CFG_ENABLE_CSP=''
  # shellcheck disable=SC1090
  . "$CONF_FILE" || return 1
  return 0
}

validate_extra_hosts() {
  [[ -n $OPT_EXTRA_HOSTS ]] || return 0
  local h
  IFS=',' read -ra hosts <<<"$OPT_EXTRA_HOSTS"
  for h in "${hosts[@]}"; do
    h=$(printf '%s' "$h" | xargs)
    if [[ -n $h && ! $h =~ $VALID_DOMAIN_RE ]]; then
      die "دامنهٔ اضافی نامعتبر است: $h"
    fi
  done
  return 0
}

collect_config() {
  step 'دریافت تنظیمات'

  if [[ $UPDATE_ONLY -eq 1 || $ROLLBACK_ONLY -eq 1 ]]; then
    load_saved_conf || die "نصب قبلی پیدا نشد ($CONF_FILE). بدون --update/--rollback دوباره اجرا کنید."
    ok "تنظیمات نصب قبلی خوانده شد: $CFG_DOMAIN"
    # همهٔ مقادیر ذخیره‌شده بازگردانده می‌شوند، نه فقط مسیرها؛ وگرنه در حالت
    # به‌روزرسانی OPT_SOURCE خالی می‌ماند و مرحلهٔ ساخت اصلاً اجرا نمی‌شود.
    # مقدار صریح خط فرمان بر مقدار ذخیره‌شده اولویت دارد.
    OPT_DOMAIN=${OPT_DOMAIN:-$CFG_DOMAIN}
    OPT_EMAIL=${OPT_EMAIL:-$CFG_EMAIL}
    OPT_SOURCE=${OPT_SOURCE:-$CFG_SOURCE}
    OPT_GIT_URL=${OPT_GIT_URL:-$CFG_GIT_URL}
    OPT_GIT_REF=${OPT_GIT_REF:-$CFG_GIT_REF}
    OPT_WEBROOT=${OPT_WEBROOT:-$CFG_WEBROOT}
    OPT_REPO_DIR=${OPT_REPO_DIR:-$CFG_REPO_DIR}
    OPT_EXTRA_HOSTS=${OPT_EXTRA_HOSTS:-${CFG_EXTRA_HOSTS:-}}
    # اگر خط فرمان --no-csp نداده و قبلاً هم خاموش شده بود، همان می‌ماند.
    if [[ $OPT_ENABLE_CSP -eq 1 && ${CFG_ENABLE_CSP:-1} -eq 0 ]]; then
      OPT_ENABLE_CSP=0
    fi
    if [[ -z ${OPT_DOMAIN:-} ]]; then
      die "تنظیمات ذخیره‌شده ناقص است ($CONF_FILE). نصب تازه اجرا کنید."
    fi
    guard_webroot "$OPT_WEBROOT"
    return 0
  fi

  # مقادیر از خط فرمان بر تنظیمات ذخیره‌شده اولویت دارند.
  if load_saved_conf; then
    OPT_DOMAIN=${OPT_DOMAIN:-$CFG_DOMAIN}
    OPT_EMAIL=${OPT_EMAIL:-$CFG_EMAIL}
    OPT_SOURCE=${OPT_SOURCE:-$CFG_SOURCE}
    OPT_GIT_URL=${OPT_GIT_URL:-$CFG_GIT_URL}
    OPT_GIT_REF=${OPT_GIT_REF:-$CFG_GIT_REF}
    OPT_WEBROOT=${OPT_WEBROOT:-$CFG_WEBROOT}
    OPT_REPO_DIR=${OPT_REPO_DIR:-$CFG_REPO_DIR}
    OPT_EXTRA_HOSTS=${OPT_EXTRA_HOSTS:-$CFG_EXTRA_HOSTS}
    warn 'نصب قبلی روی این سرور پیدا شد؛ مقادیر قبلی پیشنهاد می‌شوند.'
  fi

  OPT_SOURCE=${OPT_SOURCE:-git}
  OPT_GIT_URL=${OPT_GIT_URL:-$REPO_URL_DEFAULT}
  OPT_WEBROOT=${OPT_WEBROOT:-/var/www/hamgam}
  OPT_REPO_DIR=${OPT_REPO_DIR:-/opt/hamgam}

  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    if [[ -z $OPT_DOMAIN || -z $OPT_EMAIL ]]; then
      die 'در حالت غیرتعاملی، --domain و --email اجباری هستند.'
    fi
  else
    plain ''
    plain "  ${C_DIM}برای ادامه چند مقدار لازم است. هر کدام را می‌توانید با Enter بپذیرید.${C_RESET}"
    ask_value OPT_DOMAIN 'دامنهٔ سایت (بدون https)' "$OPT_DOMAIN" "$VALID_DOMAIN_RE" \
      'دامنه معتبر نیست. نمونهٔ درست: fit.example.com'
    ask_value OPT_EMAIL 'ایمیل برای گواهی SSL' "$OPT_EMAIL" "$VALID_EMAIL_RE" \
      'ایمیل معتبر نیست. نمونهٔ درست: me@example.com'
    ask_value OPT_WEBROOT 'مسیر نگهداری نسخه‌ها' "$OPT_WEBROOT" '' ''
    ask_value OPT_SOURCE 'حالت تأمین سورس (git/local/prebuilt)' "$OPT_SOURCE" '^(git|local|prebuilt)$' \
      'یکی از سه مقدار git یا local یا prebuilt را بنویسید.'
    if [[ $OPT_SOURCE == git ]]; then
      ask_value OPT_GIT_URL 'نشانی مخزن گیت' "$OPT_GIT_URL" '^(https?://|git@|/).+' \
        'نشانی مخزن معتبر نیست.'
      ask_value OPT_GIT_REF 'شاخه یا تگ' "$OPT_GIT_REF" '' ''
      ask_value OPT_REPO_DIR 'مسیر نگهداری مخزن روی سرور' "$OPT_REPO_DIR" '' ''
    elif [[ $OPT_SOURCE == prebuilt ]]; then
      ask_value OPT_DIST 'مسیر پوشهٔ dist آماده' "${OPT_DIST:-}" '' ''
    fi
  fi

  # اعتبارسنجی نهایی، مستقل از اینکه مقدار از کجا آمده است.
  [[ $OPT_DOMAIN =~ $VALID_DOMAIN_RE ]] || die "دامنهٔ نامعتبر: $OPT_DOMAIN"
  [[ $OPT_EMAIL =~ $VALID_EMAIL_RE ]] || die "ایمیل نامعتبر: $OPT_EMAIL"
  guard_webroot "$OPT_WEBROOT"
  valid_path "$OPT_REPO_DIR" || die "مسیر مخزن نامعتبر: $OPT_REPO_DIR"
  validate_extra_hosts
  case $OPT_SOURCE in
    git)
      [[ -n $OPT_GIT_URL ]] || die 'برای حالت git، نشانی مخزن لازم است.'
      [[ -n $OPT_GIT_REF ]] || die 'برای حالت git، شاخه لازم است.'
      ;;
    local)
      [[ -f ${PWD}/package.json ]] ||
        die "در مسیر فعلی package.json پیدا نشد. اسکریپت را از ریشهٔ مخزن اجرا کنید."
      ;;
    prebuilt)
      [[ -n ${OPT_DIST:-} && -d ${OPT_DIST:-} ]] || die "پوشهٔ dist پیدا نشد: ${OPT_DIST:-خالی}"
      ;;
    *) die "حالت سورس نامعتبر: $OPT_SOURCE" ;;
  esac

  if [[ -n $OPT_CF_CREDENTIALS && ! -r $OPT_CF_CREDENTIALS ]]; then
    die "فایل مجوز Cloudflare خوانده نشد: $OPT_CF_CREDENTIALS"
  fi

  # نمایش خلاصه و تأیید
  if [[ $NON_INTERACTIVE -eq 0 ]]; then
    ui_out ''
    hr
    plain "  ${C_BOLD}خلاصهٔ نصب${C_RESET}"
    plain "    دامنهٔ سایت      ${C_BOLD}$OPT_DOMAIN${C_RESET}"
    plain "    ایمیل گواهی      $OPT_EMAIL"
    plain "    حالت سورس        $OPT_SOURCE"
    if [[ $OPT_SOURCE == git ]]; then
      plain "    مخزن             $OPT_GIT_URL ($OPT_GIT_REF)"
      plain "    مسیر مخزن        $OPT_REPO_DIR"
    fi
    plain "    مسیر انتشار      $OPT_WEBROOT"
    plain "    پوشهٔ نسخه‌ها     $OPT_WEBROOT/releases"
    if [[ $OPT_SKIP_TLS -eq 1 ]]; then plain "    گواهی SSL        نصب نمی‌شود ${C_DIM}(--skip-tls)${C_RESET}"; fi
    if [[ $OPT_ENABLE_CSP -eq 0 ]]; then plain "    هدر CSP          غیرفعال ${C_DIM}(--no-csp)${C_RESET}"; fi
    hr
    ask_yes_no 'با این مقادیر ادامه می‌دهیم؟' y || die 'به‌درخواست شما متوقف شد.'
  fi
  return 0
}

save_config() {
  mkdir -p "$CONF_DIR"
  chmod 700 "$CONF_DIR"
  cat >"$CONF_FILE" <<EOF
# تنظیمات نصب همگام؛ این فایل توسط deploy/install.sh نوشته شده است.
CFG_DOMAIN='${OPT_DOMAIN}'
CFG_EMAIL='${OPT_EMAIL}'
CFG_SOURCE='${OPT_SOURCE}'
CFG_GIT_URL='${OPT_GIT_URL}'
CFG_GIT_REF='${OPT_GIT_REF}'
CFG_WEBROOT='${OPT_WEBROOT}'
CFG_REPO_DIR='${OPT_REPO_DIR}'
CFG_EXTRA_HOSTS='${OPT_EXTRA_HOSTS}'
CFG_ENABLE_CSP='${OPT_ENABLE_CSP}'
EOF
  chmod 600 "$CONF_FILE"
  ok "تنظیمات ذخیره شد: $CONF_FILE"
  return 0
}

# ------------------------------------------------------ نصب پیش‌نیازها -----
install_packages() {
  step 'نصب بسته‌های موردنیاز'

  wait_for_apt
  note 'به‌روزرسانی فهرست بسته‌ها…'
  run_logged apt-get update -qq || die 'apt-get update ناموفق بود. منابع مخازن را بررسی کنید.'
  ok 'فهرست بسته‌ها به‌روز شد'

  local packages=(nginx curl git rsync ca-certificates openssl gnupg dnsutils)
  local missing=() p
  for p in "${packages[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    note "نصب: ${missing[*]}"
    apt_install "${missing[@]}" || die 'نصب بسته‌های پایه ناموفق بود.'
  fi
  ok 'nginx و ابزارهای پایه نصب شدند'

  # بعد از نصب هم دوباره بررسی می‌کنیم که nginx از snap نیامده باشد.
  detect_foreign_nginx

  if [[ $OPT_SKIP_TLS -eq 0 ]]; then
    if ! dpkg -s python3-certbot-nginx >/dev/null 2>&1; then
      note 'نصب certbot برای گواهی SSL رایگان…'
      if ! apt_install python3-certbot-nginx; then
        warn 'نصب certbot ناموفق بود؛ ادامه می‌دهیم تا علت را در پایان گزارش کنیم.'
        OPT_SKIP_TLS=1
      fi
    fi
    if [[ $OPT_SKIP_TLS -eq 0 ]]; then ok 'certbot آماده است'; fi

    if [[ -n $OPT_CF_CREDENTIALS ]] && ! dpkg -s python3-certbot-dns-cloudflare >/dev/null 2>&1; then
      note 'نصب افزونهٔ DNS کلادفلر برای certbot…'
      apt_install python3-certbot-dns-cloudflare ||
        warn 'نصب افزونهٔ Cloudflare ناموفق بود.'
    fi
  fi

  # Node فقط وقتی لازم است که روی سرور build کنیم.
  if [[ $OPT_SOURCE == git || $OPT_SOURCE == local ]]; then
    local have_node=0 major=''
    if have node; then
      major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
      if [[ $major =~ ^[0-9]+$ && $major -ge 20 ]]; then
        have_node=1
        ok "Node.js موجود است: $(node -v)"
      else
        warn "نسخهٔ Node.js قدیمی است ($(node -v))؛ نسخهٔ $(fa "$NODE_MAJOR") نصب می‌شود."
      fi
    fi
    if [[ $have_node -eq 0 ]]; then
      note "نصب Node.js $(fa "$NODE_MAJOR") LTS از NodeSource…"
      install_node
    fi
    ok "npm: $(npm -v)"
  fi
  return 0
}

install_node() {
  local keyring=/usr/share/keyrings/nodesource.gpg
  wait_for_apt
  mkdir -p /usr/share/keyrings
  # کلید امضای NodeSource؛ اگر دریافت نشد، نصب ادامه نمی‌یابد چون مخزن
  # بدون کلید قابل اعتماد نیست.
  if ! curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor -o "$keyring" 2>>"$LOG_PATH"; then
    die 'دریافت کلید امضای NodeSource ناموفق بود. اتصال به deb.nodesource.com را بررسی کنید.'
  fi
  chmod 644 "$keyring"
  echo "deb [signed-by=$keyring] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  run_logged apt-get update -qq || die 'apt-get update پس از افزودن مخزن NodeSource ناموفق بود.'
  apt_install nodejs || die 'نصب Node.js ناموفق بود.'
  have node || die 'Node.js پس از نصب هم در PATH نیست.'
  return 0
}

# --------------------------------------------------- کاربر ساخت (غیرریشه) --
# اجرای npm ci و build با کاربر ریشه یعنی lifecycle scriptهای وابستگی‌ها هم
# دسترسی root می‌گیرند. این کار را نمی‌پذیریم.
BUILD_USER=''
BUILD_UID=0
BUILD_GID=0
BUILD_HOME=''

pick_build_user() {
  local candidate=''
  if [[ -n ${SUDO_USER:-} && ${SUDO_USER} != root ]] && id "$SUDO_USER" >/dev/null 2>&1; then
    candidate=$SUDO_USER
  elif [[ $OPT_SOURCE == local && -f ${PWD}/package.json ]]; then
    candidate=$(stat -c '%U' "${PWD}/package.json" 2>/dev/null || true)
  elif id www-data >/dev/null 2>&1; then
    candidate=www-data
  fi

  if [[ -z $candidate || $candidate == root ]]; then
    warn 'کاربر غیرریشه‌ای برای ساخت پیدا نشد؛ ساخت با root انجام می‌شود.'
    return 0
  fi
  BUILD_USER=$candidate
  BUILD_UID=$(id -u "$BUILD_USER")
  BUILD_GID=$(id -g "$BUILD_USER")
  ok "ساخت برنامه با کاربر ${BUILD_USER} انجام می‌شود (نه root)"
  return 0
}

# اجرای دستور با کاربر ساخت، داخل مسیر داده‌شده.
# نکته: setpriv یک برنامهٔ واقعی اجرا می‌کند، پس اینجا نمی‌توان run_logged را
# صدا زد (تابع شل در فرایند جدید وجود ندارد)؛ خودمان خروجی را به لاگ می‌فرستیم.
run_as_build_user() {
  local dir=$1
  shift
  local out=/dev/null
  if [[ $LOG_READY -eq 1 ]]; then out=$LOG_PATH; fi
  log "run(as ${BUILD_USER:-root}): $*"

  if [[ $BUILD_UID -eq 0 ]] || ! have setpriv; then
    if [[ $BUILD_UID -ne 0 ]]; then
      warn 'setpriv موجود نیست؛ ساخت با root انجام می‌شود.'
    fi
    if ! (cd "$dir" && "$@") >>"$out" 2>&1; then
      log "FAILED: $*"
      return 1
    fi
    return 0
  fi

  if ! (
    cd "$dir" || exit 1
    setpriv --reuid="$BUILD_UID" --regid="$BUILD_GID" --clear-groups \
      env HOME="$BUILD_HOME" npm_config_cache="$BUILD_HOME/.npm" "$@"
  ) >>"$out" 2>&1; then
    log "FAILED: $*"
    return 1
  fi
  return 0
}

# --------------------------------------------------- سورس و ساخت ----------
BUILD_DIR=''
BUILD_ID='manual'

fetch_and_build() {
  step 'آماده‌سازی سورس و ساخت برنامه'

  case $OPT_SOURCE in
    git) fetch_git ;;
    local) fetch_local ;;
    prebuilt) use_prebuilt ;;
  esac

  [[ -n $BUILD_DIR && -d $BUILD_DIR ]] || die 'پوشهٔ خروجی ساخت پیدا نشد.'
  validate_build "$BUILD_DIR"
  ok 'خروجی نهایی آماده است'
  return 0
}

fetch_git() {
  local dir=$OPT_REPO_DIR
  if [[ -d $dir/.git ]]; then
    note "به‌روزرسانی مخزن موجود در $dir"
    run_logged git -C "$dir" fetch --depth 1 origin "$OPT_GIT_REF" ||
      die "دریافت شاخهٔ $OPT_GIT_REF ناموفق بود."
    run_logged git -C "$dir" checkout -f FETCH_HEAD || die 'جابه‌جایی به نسخهٔ تازه ناموفق بود.'
    git -C "$dir" reset --hard FETCH_HEAD >/dev/null 2>&1 || true
  else
    note "کلون مخزن در $dir"
    rm -rf "$dir"
    mkdir -p "$(dirname "$dir")"
    run_logged git clone --depth 1 --branch "$OPT_GIT_REF" "$OPT_GIT_URL" "$dir" ||
      die "کلون مخزن ناموفق بود. دسترسی به $OPT_GIT_URL را بررسی کنید."
  fi
  BUILD_ID=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || printf 'nogit')
  ok "سورس آماده است: $BUILD_ID"
  build_project "$dir"
}

fetch_local() {
  local dir
  dir=$(readlink -f "$PWD")
  BUILD_ID=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || printf 'nogit')
  ok "استفاده از مخزن محلی: $dir"
  build_project "$dir"
}

build_project() {
  local dir=$1
  [[ -f $dir/package.json ]] || die "package.json در $dir پیدا نشد."
  if [[ ! -f $dir/package-lock.json ]]; then
    warn 'package-lock.json نیست؛ نصب با npm install انجام می‌شود.'
  fi

  pick_build_user

  # مخزن کلون‌شده را به کاربر ساخت می‌دهیم تا npm بتواند بنویسد؛ در حالت
  # مخزن محلی دست نمی‌زنیم چون مالکیت خود کاربر است.
  if [[ $OPT_SOURCE == git && $BUILD_UID -ne 0 ]]; then
    chown -R "$BUILD_UID:$BUILD_GID" "$dir"
  fi

  BUILD_HOME="$dir/.build-home"
  mkdir -p "$BUILD_HOME"
  if [[ $BUILD_UID -ne 0 ]]; then chown "$BUILD_UID:$BUILD_GID" "$BUILD_HOME"; fi
  chmod 700 "$BUILD_HOME"

  note 'نصب وابستگی‌ها (ممکن است چند دقیقه طول بکشد)…'
  local mem_mb extra_env=()
  mem_mb=$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo)
  if [[ -n $mem_mb && $mem_mb -lt 1500 ]]; then
    # سقف heap تضمین جلوگیری از OOM نیست، اما فشار روی حافظه را کم می‌کند.
    extra_env=(env NODE_OPTIONS=--max-old-space-size=512)
    note 'سرور کم‌حافظه است؛ سقف حافظهٔ Node محدود شد.'
  fi

  if [[ -f $dir/package-lock.json ]]; then
    run_as_build_user "$dir" "${extra_env[@]}" npm ci --no-audit --no-fund ||
      die 'npm ci ناموفق بود. لاگ کامل را ببینید.'
  else
    run_as_build_user "$dir" "${extra_env[@]}" npm install --no-audit --no-fund ||
      die 'npm install ناموفق بود.'
  fi
  ok 'وابستگی‌ها نصب شدند'

  note 'ساخت نسخهٔ تولید…'
  # APP_BASE=/ چون این نصب روی ریشهٔ دامنه سرو می‌شود.
  if ! run_as_build_user "$dir" "${extra_env[@]}" env APP_BASE=/ npm run build; then
    die 'ساخت برنامه شکست خورد. با اجرای دستی npm run build علت را ببینید.'
  fi
  BUILD_DIR="$dir/dist"
  ok 'ساخت با موفقیت انجام شد'
  return 0
}

use_prebuilt() {
  BUILD_DIR=$(readlink -f "$OPT_DIST")
  ok "استفاده از خروجی آماده: $BUILD_DIR"
  return 0
}

# بررسی خروجی پیش از هر تغییری روی سایت. وجود سه فایل کافی نیست: باید مطمئن
# شویم build با ریشهٔ درست انجام شده و سرویس‌ورکر با همین فایل‌ها ساخته شده است.
validate_build() {
  local dir=$1 f
  local required=(index.html manifest.webmanifest sw.js)
  for f in "${required[@]}"; do
    [[ -f $dir/$f ]] || die "فایل ضروری در خروجی ساخت نیست: $f"
  done

  if ! grep -q 'id="root"' "$dir/index.html"; then
    die 'index.html ساختار این برنامه را ندارد (id="root" پیدا نشد).'
  fi

  # اگر با APP_BASE اشتباه ساخته شده باشد، مسیرها زیرپوشه‌ای می‌شوند و روی
  # دامنهٔ ریشه همه‌چیز ۴۰۴ می‌شود.
  if grep -qE '(src|href)="[^"]*/fit-tracker-pwa/' "$dir/index.html"; then
    die 'این خروجی برای GitHub Pages ساخته شده (مسیرها زیر /fit-tracker-pwa/). دوباره با APP_BASE=/ بسازید.'
  fi

  local refs a
  local missing_assets=0 total_assets=0
  refs=$(grep -oE '(src|href)="[^"]*/assets/[^"]+"' "$dir/index.html" |
    sed -E 's/.*="([^"]*)".*/\1/' | sort -u || true)
  while IFS= read -r a; do
    [[ -n $a ]] || continue
    total_assets=$((total_assets + 1))
    [[ -f $dir${a} ]] || {
      bad "فایل ارجاع‌شده در index.html پیدا نشد: $a"
      missing_assets=$((missing_assets + 1))
    }
  done <<<"$refs"
  if [[ $total_assets -eq 0 ]]; then
    die 'هیچ فایل asset ای در index.html ارجاع نشده؛ خروجی ساخت ناقص است.'
  fi
  [[ $missing_assets -eq 0 ]] ||
    die "$(fa "$missing_assets") فایل ارجاع‌شده در خروجی ساخت وجود ندارد."

  if ! grep -q 'precacheAndRoute\|workbox' "$dir/sw.js"; then
    die 'sw.js سرویس‌ورکر این برنامه نیست (نشانهٔ workbox پیدا نشد).'
  fi
  ok "خروجی ساخت معتبر است ($(fa "$total_assets") فایل asset بررسی شد)"
  return 0
}

# ------------------------------------------------------------- استقرار -----
SITE_ROOT=''
RELEASES_DIR=''
CURRENT_LINK=''
PREVIOUS_MARK=''
SWAP_DONE=0
NEED_NGINX_RELOAD=0

init_paths() {
  SITE_ROOT=$OPT_WEBROOT
  RELEASES_DIR="$SITE_ROOT/releases"
  CURRENT_LINK="$SITE_ROOT/current"
  PREVIOUS_MARK="$SITE_ROOT/.previous"
}

write_if_changed() {
  # write_if_changed <مسیر>: محتوا از stdin خوانده می‌شود.
  # کد خروج ۰ یعنی فایل تغییر کرد، ۱ یعنی محتوا یکسان بود.
  local target=$1 tmp
  tmp=$(mktemp -t hamgam-wic.XXXXXX) || {
    warn "ساخت فایل موقت ناموفق بود؛ $target بدون مقایسه نوشته می‌شود."
    mkdir -p "$(dirname "$target")"
    cat >"$target"
    return 0
  }
  cat >"$tmp"
  if [[ -f $target ]] && cmp -s "$tmp" "$target"; then
    rm -f "$tmp"
    return 1
  fi
  mkdir -p "$(dirname "$target")"
  install -m 0644 "$tmp" "$target"
  rm -f "$tmp"
  return 0
}

current_release() {
  if [[ -L $CURRENT_LINK ]]; then
    readlink -f "$CURRENT_LINK"
  fi
  return 0
}

# نسخهٔ پیشین فایل‌های هش‌دار را در نسخهٔ تازه نگه می‌داریم تا تب‌هایی که هنوز
# نسخهٔ قدیمی را اجرا می‌کنند، هنگام بارگذاری یک chunk قدیمی ۴۰۴ نگیرند.
merge_previous_assets() {
  local new_dir=$1 prev_dir=$2
  [[ -n $prev_dir && -d $prev_dir/assets && -d $new_dir/assets ]] || return 0
  local f base kept=0
  for f in "$prev_dir"/assets/*; do
    [[ -e $f ]] || continue
    base=$(basename "$f")
    [[ -e $new_dir/assets/$base ]] && continue
    if cp -p "$f" "$new_dir/assets/$base" 2>>"$LOG_PATH"; then
      kept=$((kept + 1))
    else
      warn "نگه‌داشتن فایل قدیمی ناموفق بود: $base"
    fi
  done
  if [[ $kept -gt 0 ]]; then
    note "$(fa "$kept") فایل هش‌دار نسخهٔ پیشین نگه داشته شد"
  fi
  return 0
}

# پوشهٔ سایت در نسخه‌های قدیمی اسکریپت تخت بود؛ پیش از استقرار جدید، آن را
# به یک نسخهٔ مستقل تبدیل می‌کنیم تا چیزی گم نشود.
migrate_legacy_layout() {
  [[ -d $SITE_ROOT ]] || return 0
  [[ -e $CURRENT_LINK ]] && return 0
  [[ -f $SITE_ROOT/index.html ]] || return 0

  local legacy
  legacy="$RELEASES_DIR/legacy-$(date +%Y%m%d-%H%M%S)"
  note 'چیدمان قدیمی سایت پیدا شد؛ به ساختار نسخه‌دار منتقل می‌شود.'
  mkdir -p "$legacy"
  local entry
  for entry in "$SITE_ROOT"/* "$SITE_ROOT"/.[!.]*; do
    [[ -e $entry ]] || continue
    [[ $entry == "$RELEASES_DIR" ]] && continue
    [[ $entry == "$CURRENT_LINK" ]] && continue
    mv "$entry" "$legacy/" || die "انتقال $entry ناموفق بود."
  done
  if [[ -f $legacy/index.html ]]; then
    # فوراً پیوند را به همان نسخهٔ منتقل‌شده می‌دهیم؛ وگرنه بین این لحظه و
    # جابه‌جایی نسخهٔ تازه، ریشهٔ nginx به مسیری خالی اشاره می‌کند و سایت
    # ۴۰۴ می‌دهد.
    atomic_swap "$legacy" || die 'ساخت پیوند نسخه پس از مهاجرت ناموفق بود.'
    printf '%s\n' "$legacy" >"$PREVIOUS_MARK"
  fi
  ok "چیدمان قدیمی در $legacy حفظ شد"
  return 0
}

# جابه‌جایی اتمیک پیوند: ساخت پیوند موقت و سپس rename روی مسیر نهایی.
atomic_swap() {
  local target=$1
  ln -sfn "$target" "$SITE_ROOT/.current.tmp" || return 1
  mv -T "$SITE_ROOT/.current.tmp" "$CURRENT_LINK" || return 1
  return 0
}

rollback_deploy() {
  local prev=''
  [[ -r $PREVIOUS_MARK ]] && prev=$(cat "$PREVIOUS_MARK")
  if [[ -z $prev || ! -d $prev ]]; then
    warn 'نسخهٔ پیشینی برای بازگردانی موجود نیست.'
    return 0
  fi
  if atomic_swap "$prev"; then
    SWAP_DONE=0
    systemctl reload nginx 2>/dev/null || true
    note "سایت به نسخهٔ پیشین بازگردانده شد: $prev"
  else
    warn "بازگردانی خودکار ناموفق بود. دستی اجرا کنید: ln -sfn $prev $CURRENT_LINK && systemctl reload nginx"
  fi
  return 0
}

deploy_files() {
  step 'استقرار فایل‌های سایت'

  have rsync || die 'rsync نصب نیست.'
  init_paths
  guard_webroot "$SITE_ROOT"
  mkdir -p "$RELEASES_DIR"

  local stamp release
  stamp=$(date +%Y%m%d-%H%M%S)
  release="$RELEASES_DIR/${stamp}-${BUILD_ID}"
  if [[ -e $release ]]; then
    die "پوشهٔ نسخه از قبل وجود دارد: $release (یک دقیقه بعد دوباره تلاش کنید)"
  fi

  migrate_legacy_layout

  local prev_release
  prev_release=$(current_release)

  note "ساخت نسخهٔ تازه در $release"
  mkdir -p "$release"
  if ! run_logged rsync -a --chmod=D755,F644 "$BUILD_DIR/" "$release/"; then
    rm -rf "$release"
    die 'انتقال فایل‌ها به نسخهٔ تازه ناموفق بود.'
  fi

  merge_previous_assets "$release" "$prev_release"

  # نسخهٔ پیشین را برای بازگردانی ثبت می‌کنیم (پیش از جابه‌جایی). اگر نسخهٔ
  # پیشینی نیست (نصب تازه) نشانه را پاک نمی‌کنیم؛ ممکن است نشانهٔ مهاجرت از
  # چیدمان قدیمی باشد و باید برای بازگردانی بماند.
  if [[ -n $prev_release ]]; then
    printf '%s\n' "$prev_release" >"$PREVIOUS_MARK"
  fi

  chown -R www-data:www-data "$release"
  find "$release" -type d -exec chmod 755 {} +
  find "$release" -type f -exec chmod 644 {} +

  # از این نقطه به بعد اگر خطایی رخ دهد، خودکار بازگردانی می‌شود.
  SWAP_DONE=1
  atomic_swap "$release" || {
    SWAP_DONE=0
    die 'جابه‌جایی اتمیک نسخه ناموفق بود.'
  }
  NEED_NGINX_RELOAD=1
  ok "نسخهٔ تازه فعال شد: $(basename "$release")"

  systemctl reload nginx 2>/dev/null || true

  # نگه‌داشتن چند نسخهٔ آخر و پاک‌کردن بقیه. شکست در پاک‌سازی نباید نصب را
  # متوقف کند. نکتهٔ مهم: نسخهٔ فعال و نسخه‌ای که --rollback به آن برمی‌گردد
  # هرگز پاک نمی‌شوند، وگرنه بازگردانی به مسیر ناموجود اشاره می‌کند.
  local old keep_current keep_previous
  keep_current=$(current_release)
  keep_previous=''
  [[ -r $PREVIOUS_MARK ]] && keep_previous=$(cat "$PREVIOUS_MARK")
  while IFS= read -r old; do
    [[ -n $old ]] || continue
    [[ $old == "$RELEASES_DIR/"* ]] || continue
    [[ $old == "$keep_current" ]] && continue
    [[ $old == "$keep_previous" ]] && continue
    rm -rf "$old" 2>/dev/null || warn "پاک‌کردن نسخهٔ قدیمی ناموفق بود: $old"
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null |
    sort -rn | tail -n "+$((RELEASES_KEEP + 1))" | cut -d' ' -f2-)

  return 0
}

# ---------------------------------------------------------- کانفیگ nginx ---
write_headers_snippet() {
  local csp_line=''
  if [[ $OPT_ENABLE_CSP -eq 1 ]]; then
    # style-src نیاز به unsafe-inline دارد چون Recharts و Framer Motion
    # استایل را به‌صورت style attribute می‌نویسند. script-src امن می‌ماند.
    csp_line='add_header Content-Security-Policy "default-src '"'"'self'"'"'; script-src '"'"'self'"'"'; style-src '"'"'self'"'"' '"'"'unsafe-inline'"'"'; img-src '"'"'self'"'"' data: blob:; font-src '"'"'self'"'"'; connect-src '"'"'self'"'"'; manifest-src '"'"'self'"'"'; worker-src '"'"'self'"'"'; object-src '"'"'none'"'"'; base-uri '"'"'self'"'"'; form-action '"'"'none'"'"'; frame-ancestors '"'"'none'"'"'" always;'
  fi

  if write_if_changed "$HEADERS_SNIPPET" <<EOF
# تولیدشده توسط deploy/install.sh؛ دستی ویرایش نکنید.
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=()" always;
$csp_line
EOF
  then
    note 'هدرهای امنیتی نوشته شد'
  else
    note 'هدرهای امنیتی بی‌تغییر بودند'
  fi
  return 0
}

# سیاست کش با map ساخته می‌شود. مزیتش این است که هیچ location ای add_header
# محلی ندارد، پس همهٔ هدرهای امنیتی سطح server به ارث می‌رسند و لازم نیست
# snippet در هر location تکرار شود. (add_header_inherit merge فقط از nginx
# ۱٫۲۹٫۳ به بعد هست و روی اوبونتو ۲۲٫۰۴ موجود نیست.)
write_cache_map() {
  if write_if_changed "$CACHE_MAP" <<'EOF'
# تولیدشده توسط deploy/install.sh؛ دستی ویرایش نکنید.
# فایل‌های assets نام هش‌دار دارند و هرگز تغییر نمی‌کنند؛ پوستهٔ برنامه،
# سرویس‌ورکر و مانیفست هرگز نباید کش شوند وگرنه نسخهٔ تازه به کاربر نمی‌رسد.
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
  then
    note 'سیاست کش نوشته شد'
  else
    note 'سیاست کش بی‌تغییر بود'
  fi
  return 0
}

build_server_names() {
  local names=$OPT_DOMAIN
  if [[ -n $OPT_EXTRA_HOSTS ]]; then
    local extra
    extra=$(printf '%s' "$OPT_EXTRA_HOSTS" | tr ',' ' ' | xargs)
    names="$names $extra"
  fi
  names=$(printf '%s' "$names" | xargs)
  printf '%s' "$names"
}

site_config_has_certbot() {
  [[ -f $NGINX_SITE ]] && grep -q 'managed by Certbot' "$NGINX_SITE"
}

site_config_matches_domain() {
  [[ -f $NGINX_SITE ]] && grep -qE "^[[:space:]]*server_name[[:space:]].*\b${OPT_DOMAIN//./\\.}\b" "$NGINX_SITE"
}

write_site_config() {
  local server_names
  server_names=$(build_server_names)
  if write_if_changed "$NGINX_SITE" <<EOF
# تولیدشده توسط deploy/install.sh؛ برای تغییرات پایدار این فایل را مستقیم
# ویرایش نکنید؛ اسکریپت را دوباره اجرا کنید.
#
# هدرهای امنیتی و سیاست کش در سطح server تعریف می‌شوند و هیچ location ای
# add_header محلی ندارد تا ارث‌بری هدرها نشکند.
server {
    listen 80;
    listen [::]:80;
    server_name $server_names;

    root $CURRENT_LINK;
    index index.html;

    charset utf-8;
    server_tokens off;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml application/javascript application/json
               application/manifest+json image/svg+xml application/xml;

    include $HEADERS_SNIPPET;
    add_header Cache-Control \$hamgam_cache always;

    location = /manifest.webmanifest {
        default_type application/manifest+json;
    }

    # فایل ناموجود زیر /assets/ باید ۴۰۴ بدهد، نه اینکه به index.html بیفتد.
    # بقیهٔ مسیرها از location / رد می‌شوند و همان فایل را می‌گیرند.
    location /assets/ {
        access_log off;
        try_files \$uri =404;
    }

    # مسیر ریشه؛ HashRouter است پس fallback فقط برای اطمینان است.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # دسترسی به فایل‌های مخفی، به‌جز مسیر تمدید گواهی.
    location ~ /\.(?!well-known) {
        deny all;
    }

    access_log /var/log/nginx/hamgam.access.log;
    error_log /var/log/nginx/hamgam.error.log warn;
}
EOF
  then
    return 0
  fi
  return 1
}

handle_default_site() {
  [[ -e /etc/nginx/sites-enabled/default ]] || return 0
  if [[ $OPT_KEEP_DEFAULT_SITE -eq 1 ]]; then
    note 'کانفیگ پیش‌فرض nginx دست‌نخورده ماند (--keep-default-site)'
    return 0
  fi

  # کانفیگ پیش‌فرض واقعاً می‌تواند در استفاده باشد و حذف بی‌قید آن، سرویس
  # دیگری را روی همین سرور قطع می‌کند. پس فقط با تأیید صریح و با امکان
  # بازگردانی دست می‌زنیم.
  # توجه: این کانفیگ سرویس ما را نمی‌شکند، چون server_name ما دقیق‌تر است و
  # درخواست‌های دامنهٔ ما به آن می‌رسد؛ فقط درخواست‌های بدون Host به آن می‌رود.
  note 'کانفیگ پیش‌فرض nginx روی پورت ۸۰ فعال است.'
  note 'سرویس ما با آن کار می‌کند، اما اگر سرور فقط برای همین سایت است بهتر است غیرفعال شود.'
  if ask_yes_no 'کانفیگ پیش‌فرض nginx غیرفعال شود؟ (بازگردانی: sudo ln -s ../sites-available/default /etc/nginx/sites-enabled/default)' n; then
    rm -f /etc/nginx/sites-enabled/default
    note 'کانفیگ پیش‌فرض غیرفعال شد'
  else
    note 'کانفیگ پیش‌فرض دست‌نخورده ماند'
  fi
  return 0
}

resolve_domain_conflicts() {
  local conflicts
  conflicts=$(grep -rlE "^[[:space:]]*server_name[[:space:]]+.*\b${OPT_DOMAIN//./\\.}\b" \
    /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | grep -v "$NGINX_SITE" || true)
  [[ -n $conflicts ]] || return 0

  warn 'این دامنه از قبل در کانفیگ دیگری nginx تعریف شده است:'
  local c
  while IFS= read -r c; do note "$c"; done <<<"$conflicts"
  if [[ $NON_INTERACTIVE -eq 0 ]]; then
    ask_yes_no 'آن کانفیگ غیرفعال شود تا تداخل پیش نیاید؟' y ||
      die 'برای جلوگیری از تداخل، نصب متوقف شد.'
  fi
  while IFS= read -r c; do
    if [[ -L $c ]]; then
      rm -f "$c"
      note "غیرفعال شد: $c (بازگردانی: sudo ln -s /etc/nginx/sites-available/$(basename "$c") $c)"
    fi
  done <<<"$conflicts"
  return 0
}

configure_nginx() {
  step 'تنظیم nginx'
  init_paths

  write_headers_snippet
  write_cache_map

  resolve_domain_conflicts

  local changed=0
  if site_config_has_certbot && site_config_matches_domain; then
    # certbot این فایل را برای HTTPS بازنویسی کرده است؛ با قالب HTTP
    # جایگزینش نمی‌کنیم وگرنه گواهی بی‌اثر می‌شود.
    ok 'کانفیگ فعلی توسط certbot مدیریت می‌شود؛ دست‌نخورده می‌ماند'
  else
    if write_site_config; then
      changed=1
    fi
  fi

  if [[ ! -e $NGINX_LINK ]]; then
    ln -s "$NGINX_SITE" "$NGINX_LINK"
    changed=1
  fi

  handle_default_site

  # صحت کانفیگ باید پیش از هر reload تأیید شود.
  if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
    bad 'کانفیگ nginx معتبر نیست:'
    nginx -t 2>&1 | while IFS= read -r line; do note "$line"; done
    die 'نصب متوقف شد و nginx دوباره بارگذاری نشد؛ نسخهٔ قبلی همچنان فعال است.'
  fi
  ok 'صحت کانفیگ nginx تأیید شد'

  if [[ $changed -eq 1 || $NEED_NGINX_RELOAD -eq 1 ]]; then
    run_logged systemctl reload nginx || run_logged systemctl restart nginx ||
      die 'بارگذاری دوبارهٔ nginx ناموفق بود.'
    ok 'nginx بارگذاری شد'
  else
    ok 'کانفیگ nginx بی‌تغییر بود'
  fi

  run_logged systemctl enable nginx >/dev/null 2>&1 || true
  systemctl is-active --quiet nginx || die 'سرویس nginx فعال نیست.'
  ok 'سرویس nginx فعال است و در بوت بالا می‌آید'
  return 0
}

# ------------------------------------------------------------ فایروال -----
configure_firewall() {
  step 'بررسی فایروال'

  if ! have ufw; then
    note 'ufw نصب نیست؛ نکته‌ای برای تنظیم لازم نیست.'
    return 0
  fi
  if ! ufw status 2>/dev/null | grep -q '^Status: active'; then
    # فعال‌کردن خودکار ufw می‌تواند دسترسی SSH را قطع کند؛ هرگز این کار را
    # بدون درخواست صریح انجام نمی‌دهیم.
    note 'ufw غیرفعال است؛ دست نمی‌زنیم. اگر فعالش کردید، پورت‌های ۸۰ و ۴۴۳ را باز بگذارید.'
    return 0
  fi
  if ufw status | grep -qE '^(Nginx Full|80/tcp|443/tcp)'; then
    ok 'پورت‌های ۸۰ و ۴۴۳ در فایروال باز هستند'
    return 0
  fi
  note 'باز کردن پورت‌های ۸۰ و ۴۴۳ در ufw…'
  if ! run_logged ufw allow 'Nginx Full'; then
    warn 'باز کردن پورت در ufw ناموفق بود؛ دستی بررسی کنید.'
    return 0
  fi
  ok 'فایروال به‌روز شد'
  return 0
}

# ---------------------------------------------------------------- TLS -----
TLS_STATE='none'

# این بررسی فقط تشخیصی است. پشت Cloudflare یا NAT، DNS عمداً به آدرس دیگری
# اشاره می‌کند و نباید مانع گرفتن گواهی شود.
dns_report() {
  local host=$1
  local v4 v6 public_ip ns
  v4=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  v6=$(getent ahostsv6 "$host" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  public_ip=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)
  ns=$( (getent hosts "$host" >/dev/null 2>&1 && dig +short NS "$host" 2>/dev/null | tr '\n' ' ') || true)

  log "dns: $host A=[${v4}] AAAA=[${v6}] public=${public_ip} ns=[${ns}]"

  if [[ -z $v4 && -z $v6 ]]; then
    warn "دامنهٔ $host در DNS پیدا نشد."
    note 'اگر DNS را تازه تنظیم کرده‌اید، چند دقیقه صبر کنید.'
  elif [[ -n $public_ip && " $v4 " == *" $public_ip "* ]]; then
    ok "دامنه به این سرور اشاره می‌کند ($public_ip)"
  else
    note "DNS دامنه: IPv4=${v4:-ندارد} IPv6=${v6:-ندارد}"
    if [[ -n $public_ip ]]; then note "IP عمومی این سرور: $public_ip"; fi
    if [[ ${ns,,} == *cloudflare* ]]; then
      note 'دامنه از Cloudflare استفاده می‌کند؛ اگر ابر نارنجی روشن باشد، آدرس لبهٔ Cloudflare دیده می‌شود'
      note 'و این طبیعی است. در آن حالت حالت SSL را روی Full (strict) بگذارید، نه Flexible.'
    else
      note 'ممکن است سرور پشت NAT باشد یا رکورد A به سرور دیگری اشاره کند.'
    fi
    note 'certbot خودش این را قطعی تشخیص می‌دهد؛ بنابراین ادامه می‌دهیم.'
  fi
  return 0
}

# آیا HTTPS روی همین سرور (با SNI درست و بدون نادیده‌گرفتن خطای گواهی) کار می‌کند؟
https_works() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    --resolve "${OPT_DOMAIN}:443:127.0.0.1" "https://${OPT_DOMAIN}/") || return 1
  [[ $code == 200 ]]
}

enable_certbot_timer() {
  if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    if run_logged systemctl enable --now certbot.timer; then
      ok 'تمدید خودکار گواهی فعال است (certbot.timer)'
    else
      warn 'فعال‌کردن certbot.timer ناموفق بود؛ تمدید خودکار را بررسی کنید.'
    fi
  else
    warn 'certbot.timer پیدا نشد؛ تمدید خودکار گواهی تنظیم نشد.'
  fi
  return 0
}

tls_troubleshooting() {
  ui_out ''
  bad 'گواهی SSL گرفته نشد.'
  note 'بدون HTTPS، سرویس‌ورکر و نصب آفلاین کار نمی‌کند؛ پس نصب کامل نیست.'
  note 'راه‌های رفع:'
  note "  • اگر دامنه پشت Cloudflare است، حالت SSL را روی Full (strict) بگذارید یا با DNS-01 گواهی بگیرید:"
  note "      sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials <file> -d $OPT_DOMAIN"
  note '  • اگر سرور پشت NAT است، پورت ۸۰ باید از بیرون به این سرور برسد.'
  note "  • رکورد A/AAAA دامنه را به IP این سرور تغییر دهید، سپس: sudo certbot --nginx -d $OPT_DOMAIN"
  note "  • جزئیات خطا: grep -i 'certbot\\|acme' $LOG_FILE"
  ui_out ''
  return 0
}

setup_tls() {
  step 'نصب گواهی SSL'

  if [[ $OPT_SKIP_TLS -eq 1 ]]; then
    warn 'به‌درخواست شما نصب گواهی انجام نشد (--skip-tls). سایت روی HTTP می‌ماند.'
    note 'توجه: بدون HTTPS، سرویس‌ورکر و قابلیت آفلاین و نصب روی گوشی کار نمی‌کند.'
    TLS_STATE='skipped'
    return 0
  fi

  if ! have certbot; then
    bad 'certbot نصب نشد؛ HTTPS برقرار نشد.'
    tls_troubleshooting
    TLS_STATE='missing'
    return 0
  fi

  dns_report "$OPT_DOMAIN"

  local hosts_args=(-d "$OPT_DOMAIN")
  if [[ -n $OPT_EXTRA_HOSTS ]]; then
    local extra h
    IFS=',' read -ra extra <<<"$OPT_EXTRA_HOSTS"
    for h in "${extra[@]}"; do
      h=$(printf '%s' "$h" | xargs)
      [[ -n $h ]] && hosts_args+=(-d "$h")
    done
  fi

  if [[ -d /etc/letsencrypt/live/$OPT_DOMAIN ]]; then
    note 'گواهی موجود است؛ تمدید بررسی می‌شود.'
    if https_works; then
      ok 'HTTPS با گواهی موجود کار می‌کند'
      TLS_STATE='existing'
      enable_certbot_timer
      return 0
    fi
    warn 'گواهی موجود است اما HTTPS پاسخ درست نمی‌دهد؛ دوباره درخواست می‌شود.'
  fi

  if [[ $NON_INTERACTIVE -eq 0 ]]; then
    if ! ask_yes_no "گواهی رایگان Let's Encrypt برای $OPT_DOMAIN نصب شود؟" y; then
      warn 'نصب گواهی رد شد؛ سایت روی HTTP می‌ماند و قابلیت آفلاین کار نمی‌کند.'
      TLS_STATE='declined'
      return 0
    fi
  fi

  note "درخواست گواهی از Let's Encrypt…"
  local certbot_args=(--non-interactive --agree-tos --no-eff-email -m "$OPT_EMAIL")
  if [[ -n $OPT_CF_CREDENTIALS ]]; then
    certbot_args+=(certonly --dns-cloudflare --dns-cloudflare-credentials "$OPT_CF_CREDENTIALS")
    local h
    for h in "${hosts_args[@]}"; do
      [[ $h == -d ]] && continue
      certbot_args+=(-d "$h")
    done
  else
    certbot_args+=(--nginx --redirect "${hosts_args[@]}")
  fi

  if certbot "${certbot_args[@]}" >>"$LOG_PATH" 2>&1; then
    ok 'گواهی صادر شد'
  else
    tls_troubleshooting
    TLS_STATE='failed'
    # کانفیگ ممکن است نیمه‌کاره تغییر کرده باشد؛ صحت را می‌سنجیم.
    if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
      warn 'کانفیگ nginx پس از تلاش ناکام certbot معتبر نیست.'
      write_site_config || true
      if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
        die 'کانفیگ nginx نیاز به بررسی دستی دارد. nginx بارگذاری نشد.'
      fi
      note 'کانفیگ به قالب HTTP بازگردانده شد'
    fi
    run_logged systemctl reload nginx || true
    return 0
  fi

  if [[ -n $OPT_CF_CREDENTIALS ]]; then
    # در حالت DNS-01، certbot فایل گواهی را می‌سازد اما کانفیگ nginx را
    # دست نمی‌زند؛ خودمان قالب HTTPS را با --nginx می‌سازیم.
    if certbot install --nginx --non-interactive --redirect "${hosts_args[@]}" >>"$LOG_PATH" 2>&1; then
      ok 'کانفیگ nginx برای HTTPS به‌روز شد'
    else
      warn 'نصب گواهی در nginx ناموفق بود.'
    fi
  fi

  # کانفیگ ممکن است توسط certbot بازنویسی شده باشد؛ صحت را دوباره می‌سنجیم.
  if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
    warn 'certbot کانفیگ را تغییر داد و اکنون معتبر نیست؛ کانفیگ ما بازنویسی می‌شود.'
    write_site_config || true
    if ! nginx -t >/dev/null 2>>"$LOG_PATH"; then
      die 'کانفیگ nginx پس از certbot نیاز به بررسی دستی دارد. nginx بارگذاری نشد.'
    fi
    warn 'کانفیگ به قالب HTTP بازگشت؛ HTTPS باید دستی تنظیم شود.'
  fi
  run_logged systemctl reload nginx || true

  if https_works; then
    ok 'HTTPS با گواهی تازه کار می‌کند'
    TLS_STATE='issued'
    enable_certbot_timer
  else
    tls_troubleshooting
    TLS_STATE='failed'
  fi
  return 0
}

# ------------------------------------------------------- تست سلامت --------
HEALTH_FAILED=0
HEALTH_WARNED=0
SCHEME='http'

health_pass() { ok "$1"; }
health_fail() { bad "$1"; HEALTH_FAILED=$((HEALTH_FAILED + 1)); }

# آدرس‌ها را با SNI و Host درست و بدون نادیده‌گرفتن خطای گواهی می‌سنجیم تا
# اشتباهاً پاسخ سرور پیش‌فرض یا لبهٔ Cloudflare سنجیده نشود.
curl_here() {
  curl -sS --max-time 15 \
    --resolve "${OPT_DOMAIN}:80:127.0.0.1" \
    --resolve "${OPT_DOMAIN}:443:127.0.0.1" "$@"
}

check_path() {
  # check_path <مسیر> <کد انتظار> <الگوی هدر اختیاری>
  local path=$1 expect=$2 header=${3:-}
  local url="${SCHEME}://${OPT_DOMAIN}${path}"
  local code
  code=$(curl_here -o /tmp/hamgam-health-body -w '%{http_code}' "$url" 2>/dev/null) || code=000
  if [[ $code != "$expect" ]]; then
    health_fail "$path پاسخ $code داد (انتظار $expect)"
    return 1
  fi
  if [[ -n $header ]]; then
    if ! curl_here -sI "$url" 2>/dev/null | grep -qi "$header"; then
      health_fail "هدر «$header» برای $path تنظیم نشده"
      return 1
    fi
  fi
  return 0
}

health_check() {
  step 'تست سلامت سرویس'
  init_paths

  SCHEME='http'
  if https_works; then SCHEME='https'; fi

  # ۱) صحت کانفیگ و وضعیت سرویس
  if nginx -t >/dev/null 2>>"$LOG_PATH"; then
    health_pass 'کانفیگ nginx معتبر است'
  else
    health_fail 'کانفیگ nginx معتبر نیست'
  fi
  if systemctl is-active --quiet nginx; then
    health_pass 'سرویس nginx در حال اجراست'
  else
    health_fail 'سرویس nginx اجرا نمی‌شود'
  fi

  if [[ ! -L $CURRENT_LINK ]]; then
    health_fail "پیوند نسخهٔ فعال وجود ندارد: $CURRENT_LINK"
  else
    local cur
    cur=$(current_release)
    if [[ -f $cur/index.html && -f $cur/sw.js ]]; then
      health_pass "نسخهٔ فعال سالم است: $(basename "$cur")"
    else
      health_fail "نسخهٔ فعال ناقص است: $cur"
    fi
  fi

  # ۲) فایل‌های کلیدی و هدرها
  if check_path / 200; then health_pass 'صفحهٔ اصلی پاسخ ۲۰۰ می‌دهد'; fi

  if curl_here "${SCHEME}://${OPT_DOMAIN}/" 2>/dev/null | grep -q 'id="root"'; then
    health_pass 'صفحهٔ اصلی ساختار درست دارد'
  else
    health_fail 'صفحهٔ اصلی محتوای مورد انتظار را ندارد'
  fi

  if check_path /index.html 200 'Cache-Control: *no-cache'; then
    health_pass 'index.html با no-cache سرو می‌شود'
  fi
  if check_path /sw.js 200 'Cache-Control: *no-cache'; then
    health_pass 'sw.js با no-cache سرو می‌شود'
  fi
  if check_path /manifest.webmanifest 200 'application/manifest+json'; then
    health_pass 'مانیفست با نوع درست سرو می‌شود'
  fi

  # ۳) همهٔ asset هایی که صفحهٔ اصلی ارجاع می‌دهد باید موجود باشند.
  local refs missing_assets=0 total_assets=0 a
  refs=$(grep -oE '(src|href)="[^"]*/assets/[^"]+"' "$CURRENT_LINK/index.html" 2>/dev/null |
    sed -E 's/.*="([^"]*)".*/\1/' | sort -u || true)
  while IFS= read -r a; do
    [[ -n $a ]] || continue
    total_assets=$((total_assets + 1))
    if ! check_path "$a" 200; then missing_assets=$((missing_assets + 1)); fi
  done <<<"$refs"
  if [[ $total_assets -eq 0 ]]; then
    health_fail 'هیچ فایل asset ای در index.html پیدا نشد'
  elif [[ $missing_assets -eq 0 ]]; then
    health_pass "همهٔ $(fa "$total_assets") فایل asset سالم است"
  fi

  # ۴) هدر immutable روی assets
  local first_asset
  first_asset=$(printf '%s\n' "$refs" | head -1)
  if [[ -n $first_asset ]]; then
    if curl_here -sI "${SCHEME}://${OPT_DOMAIN}${first_asset}" 2>/dev/null | grep -qi 'immutable'; then
      health_pass 'فایل‌های assets با کش طولانی سرو می‌شوند'
    else
      warn 'هدر immutable روی assets دیده نشد؛ بارگذاری کمی کندتر می‌شود.'
      HEALTH_WARNED=$((HEALTH_WARNED + 1))
    fi
  fi

  # ۵) سرویس‌ورکر واقعاً ساخته شده باشد
  if grep -q 'precacheAndRoute\|workbox' "$CURRENT_LINK/sw.js" 2>/dev/null; then
    health_pass 'سرویس‌ورکر آفلاین ساخته شده است'
  else
    health_fail 'سرویس‌ورکر معتبر به نظر نمی‌رسد'
  fi

  # ۶) HTTPS برای یک PWA ضروری است، نه تزئینی.
  if [[ $OPT_SKIP_TLS -eq 0 ]]; then
    if https_works; then
      health_pass 'HTTPS با گواهی معتبر کار می‌کند'
      local code
      code=$(curl_here -o /dev/null -w '%{http_code}' "http://${OPT_DOMAIN}/" 2>/dev/null || true)
      if [[ $code =~ ^30[0-9]$ ]]; then
        health_pass 'HTTP به HTTPS هدایت می‌شود'
      else
        health_fail "هدایت HTTP به HTTPS برقرار نیست (پاسخ $code)"
      fi

      local expiry days
      expiry=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$OPT_DOMAIN/cert.pem" 2>/dev/null |
        cut -d= -f2 || true)
      if [[ -n $expiry ]]; then
        days=$((($(date -d "$expiry" +%s) - $(date +%s)) / 86400))
        if [[ $days -gt 20 ]]; then
          health_pass "گواهی SSL تا $(fa "$days") روز دیگر معتبر است"
        else
          health_fail "گواهی SSL فقط $(fa "$days") روز اعتبار دارد؛ تمدید را بررسی کنید."
        fi
      fi
    else
      health_fail 'HTTPS برقرار نیست؛ بدون آن سرویس‌ورکر و نصب آفلاین کار نمی‌کند.'
    fi
  fi
  return 0
}

# ----------------------------------------------------------- جمع‌بندی ------
summary() {
  step 'جمع‌بندی'

  local https_now=0
  if https_works; then https_now=1; fi
  local url="http://$OPT_DOMAIN"
  if [[ $https_now -eq 1 ]]; then url="https://$OPT_DOMAIN"; fi

  # HTTPS برای یک PWA الزامی است؛ فقط --skip-tls صریح آن را معاف می‌کند.
  local tls_ok=0
  if [[ $OPT_SKIP_TLS -eq 1 || $https_now -eq 1 ]]; then tls_ok=1; fi

  local tls_note=''
  case $TLS_STATE in
    skipped) tls_note='گواهی به‌درخواست شما نصب نشد (--skip-tls).' ;;
    missing) tls_note='certbot نصب نشد؛ نمی‌توانستیم گواهی بگیریم.' ;;
    declined) tls_note='نصب گواهی را رد کردید.' ;;
    failed) tls_note='تلاش برای گرفتن گواهی ناموفق بود.' ;;
  esac

  ui_out ''
  if [[ $HEALTH_FAILED -eq 0 && $tls_ok -eq 1 ]]; then
    ui_out "${C_GREEN}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
    ui_out "${C_GREEN}${C_BOLD}   │${C_RESET}  ${C_GREEN}${C_BOLD}✓ نصب با موفقیت کامل شد${C_RESET}                                 ${C_GREEN}${C_BOLD}│${C_RESET}"
    ui_out "${C_GREEN}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
  elif [[ $HEALTH_FAILED -eq 0 ]]; then
    ui_out "${C_YELLOW}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
    ui_out "${C_YELLOW}${C_BOLD}   │${C_RESET}  ${C_YELLOW}${C_BOLD}▲ نصب انجام شد، اما HTTPS برقرار نیست${C_RESET}                ${C_YELLOW}${C_BOLD}│${C_RESET}"
    ui_out "${C_YELLOW}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
    if [[ -n $tls_note ]]; then note "$tls_note"; fi
    note 'سایت روی HTTP باز می‌شود، اما سرویس‌ورکر، حالت آفلاین و نصب روی گوشی کار نمی‌کند.'
    note 'این نصب کامل نیست؛ خطوط بالا را برای گرفتن گواهی دنبال کنید.'
  else
    ui_out "${C_YELLOW}${C_BOLD}   ╭──────────────────────────────────────────────────────────╮${C_RESET}"
    ui_out "${C_YELLOW}${C_BOLD}   │${C_RESET}  ${C_YELLOW}${C_BOLD}▲ نصب انجام شد، اما $(fa "$HEALTH_FAILED") بررسی هشدار داد${C_RESET}          ${C_YELLOW}${C_BOLD}│${C_RESET}"
    ui_out "${C_YELLOW}${C_BOLD}   ╰──────────────────────────────────────────────────────────╯${C_RESET}"
    note 'موارد بالا را بررسی کنید.'
  fi

  ui_out ''
  plain "  ${C_BOLD}نشانی سایت${C_RESET}"
  plain "    ${C_TEAL}${C_BOLD}$url${C_RESET}"
  ui_out ''
  plain "  ${C_BOLD}جزئیات${C_RESET}"
  plain "    دامنه                $OPT_DOMAIN"
  plain "    نسخهٔ فعال            $(basename "$(current_release 2>/dev/null || printf 'unknown')")"
  plain "    مسیر نسخه‌ها           $RELEASES_DIR"
  plain "    پیوند نسخهٔ فعال       $CURRENT_LINK"
  plain "    کانفیگ nginx         $NGINX_SITE"
  plain "    فایل تنظیمات          $CONF_FILE"
  plain "    لاگ نصب               $LOG_FILE"
  ui_out ''

  plain "  ${C_BOLD}نصب روی گوشی${C_RESET}"
  note 'آیفون: سایت را در Safari باز کنید ← دکمهٔ Share ← Add to Home Screen ← Add'
  note 'اندروید: سایت را در Chrome باز کنید ← منوی سه‌نقطه ← Install app ← Install'
  ui_out ''

  plain "  ${C_BOLD}کارهای بعدی${C_RESET}"
  note "به‌روزرسانی نسخه: sudo bash $0 --update"
  note "بازگردانی به نسخهٔ پیشین: sudo bash $0 --rollback"
  if [[ $OPT_SKIP_TLS -eq 1 || $tls_ok -eq 0 ]]; then
    note "گرفتن گواهی SSL: sudo certbot --nginx -d $OPT_DOMAIN"
  fi
  note 'تست نهایی: سایت را در مرورگر باز کنید و پس از بار اول، اینترنت را قطع کنید.'
  ui_out ''

  plain "  ${C_YELLOW}${C_BOLD}نکتهٔ مهم دربارهٔ دادهٔ کاربران${C_RESET}"
  note 'دادهٔ هر کاربر فقط در مرورگر خودش (IndexedDB) ذخیره می‌شود؛ روی سرور هیچ نسخه‌ای نیست.'
  note 'بکاپ این اسکریپت فقط فایل‌های برنامه است، نه دادهٔ کاربران. تغییر دامنه یا سوئیچ'
  note 'HTTP به HTTPS هم دادهٔ مرورگر را منتقل نمی‌کند.'
  ui_out ''

  if [[ $HEALTH_FAILED -gt 0 ]]; then
    plain "  ${C_YELLOW}تعداد بررسی‌های ناموفق: $(fa "$HEALTH_FAILED")${C_RESET}"
    plain "  ${C_DIM}خط لاگ مرتبط: grep -iE 'fail|error' $LOG_FILE${C_RESET}"
    ui_out ''
    if [[ $SWAP_DONE -eq 1 ]]; then
      warn 'نسخهٔ تازه فعال مانده است. اگر سایت ناسالم است، همین حالا بازگردانی کنید:'
      note "  sudo bash $0 --rollback"
    fi
  fi

  if [[ $HEALTH_FAILED -gt 0 || $tls_ok -eq 0 ]]; then
    return 1
  fi
  return 0
}

# -------------------------------------------------------------- اجرا ------
run_rollback() {
  init_paths
  guard_webroot "$SITE_ROOT"
  if ! systemctl is-active --quiet nginx; then
    warn 'nginx اجرا نمی‌شود؛ فقط پیوند نسخه جابه‌جا می‌شود.'
  fi
  rollback_deploy
  ok 'بازگردانی انجام شد'
  return 0
}

main() {
  parse_args "$@"
  init_log "$@"
  need_root "$@"
  acquire_lock
  init_paths
  banner

  if [[ $ROLLBACK_ONLY -eq 1 ]]; then
    collect_config
    run_rollback
    return 0
  fi

  preflight
  collect_config
  save_config

  if [[ $UPDATE_ONLY -eq 1 ]]; then
    # در حالت به‌روزرسانی هم قفل، اعتبارسنجی، بازگردانی و تست سلامت حفظ
    # می‌شوند؛ فقط بسته‌های سیستمی و کانفیگ nginx دست نمی‌خورند.
    fetch_and_build
    deploy_files
    configure_nginx
    health_check
    summary
    return $?
  fi

  install_packages
  fetch_and_build
  deploy_files
  configure_nginx
  configure_firewall
  setup_tls
  health_check
  summary
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
