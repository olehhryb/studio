# WP Theme Studio

Node.js + React studio for authorized customers. Upload a vertical config file or fill the form; the server asks AI to generate a WordPress theme, Contact Form 7 form, homepage / about / contact pages, then generates images, uploads everything to WordPress, and streams live result URLs and previews.

## How a job runs

1. Parse config (file or fields).
2. Ask AI for theme CSS and layout, then zip a valid WordPress theme.
3. Ask AI for a CF7 form plus an HTML email template; upload both to WordPress.
4. Ask AI for homepage, Contact Us (with CF7 shortcode), and About Us HTML using `[IMG ...]` placeholders.
5. Scan HTML, generate an image for every placeholder.
6. Upload images to the WP media library and replace placeholders.
7. Create the three pages, set the homepage, return live URLs.

## Setup

```bash
npm install
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:3001
- Default login: `admin` / `changeme` (override with `ADMIN_USERNAME` / `ADMIN_PASSWORD`)

Set `OPENAI_API_KEY` for real copy and DALL·E images. Without it, the studio runs in mock mode so you can still walk the full UI and result stream.

Sites and themes are stored as local files: `site_configs/*.conf` and `themes/<siteId>/`.

## Local cPanel-like hosting (Docker)

```bash
docker compose up -d --build
```

This starts MariaDB plus a hosting box with SSH, Apache, PHP 8.2, and WP-CLI — similar to a small cPanel account.

| Service | From the host |
| --- | --- |
| SSH | `127.0.0.1:2222` user `deploy`, key `docker/ssh/deploy_ed25519` |
| Site | http://localhost:8080 |
| Remote path | `/home/deploy/public_html` |
| MySQL (inside the hosting container) | host `db`, user `wpuser` / `wppass` |

`.env` is already pointed at this stack. Restart `npm run dev`, then in the studio use site URL `http://localhost:8080` and remote path `/home/deploy/public_html`. The SSH pill should appear.

```bash
docker compose down
```

## WordPress

**SSH install (preferred when `.env` has SSH settings):** the studio asks for the public site URL and the folder on the server. The job connects over SSH, creates the folder if needed, installs WordPress, creates an `editor` user with an application password, then uploads and activates the generated theme.

`.env` fields: `SSH_URL` (or `SSH_HOST`), `SSH_PORT`, `SSH_USERNAME`, `SSH_PRIVATE_KEY_PATH` (or `SSH_PRIVATE_KEY` / `SSH_PASSWORD`), and `WP_DB_HOST` (MySQL as WordPress sees it on the server). Database name, user, and password stay per-site in the studio (for this Docker stack the host from WordPress is `db`).

**REST-only:** if SSH is not configured, paste a WordPress application password (Users → Profile → Application Passwords). Install the included **WP Theme Studio Bridge** plugin once (`server/plugins/wtg-bridge`) so the studio can install the theme and create CF7 forms. Core REST still creates pages and media if the bridge is missing.

Contact Form 7 is installed automatically over SSH (or via the bridge).

## Debug logs

Turn on **Debug logs** in the studio header, or set `DEBUG_LOGS=true` in `.env`. Every inbound API call and every outbound WordPress / OpenAI request and response is appended to `logs/http-YYYY-MM-DD.jsonl` (passwords, tokens, and API keys are redacted). Use **Download log** to fetch today's file.

## Config file

Not CSV. One `KEY: value` per line. See `sample-config.txt`.
