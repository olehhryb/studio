import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getWpDbConfig } from "../ssh/config.js";
import { shQuote, sshExec } from "../ssh/client.js";

function slugify(value) {
  return String(value || "site")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "site";
}

function randomPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function remotePathArg(remotePath) {
  const trimmed = String(remotePath || "").trim().replace(/\\/g, "/");
  if (trimmed === "~") return '"$HOME"';
  if (trimmed.startsWith("~/")) return `"$HOME/${trimmed.slice(2).replace(/"/g, "")}"`;
  return shQuote(trimmed);
}

function wpBin(cli, remotePath) {
  return `${cli} --path=${remotePathArg(remotePath)}`;
}

export async function ensureWpCli(ssh) {
  const php = await ssh.execCommand("command -v php");
  if (php.code !== 0) {
    throw new Error("PHP is not installed on the SSH server");
  }
  const which = await ssh.execCommand("command -v wp");
  if (which.code === 0) return "wp --allow-root";

  await sshExec(
    ssh,
    `mkdir -p "$HOME/.wp-theme-studio" && if [ ! -f "$HOME/.wp-theme-studio/wp-cli.phar" ]; then
      if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$HOME/.wp-theme-studio/wp-cli.phar" https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar;
      elif command -v wget >/dev/null 2>&1; then wget -qO "$HOME/.wp-theme-studio/wp-cli.phar" https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar;
      else echo "curl or wget is required to download WP-CLI" >&2; exit 1; fi;
    fi`
  );
  return 'php "$HOME/.wp-theme-studio/wp-cli.phar" --allow-root';
}

export async function ensureRemoteFolder(ssh, remotePath) {
  const quoted = remotePathArg(remotePath);
  const check = await ssh.execCommand(`if [ -d ${quoted} ]; then echo EXISTS; else echo MISSING; fi`);
  const exists = String(check.stdout || "").trim() === "EXISTS";
  if (!exists) {
    await sshExec(ssh, `mkdir -p ${quoted}`);
  }
  return { created: !exists };
}

export async function provisionWordPress(ssh, brief, { onLog } = {}) {
  const log = (message) => {
    if (typeof onLog === "function" && message) onLog(message);
  };

  const remotePath = brief.wpRemotePath;
  const siteUrl = brief.wpSiteUrl;
  const db = getWpDbConfig(remotePath, brief);
  const slug = slugify(brief.siteName || brief.companyName || path.posix.basename(remotePath));
  const dbName = db.name || `wtg_${slug}`;
  const dbPrefix = "wp_";
  const editorUser = db.editorUser || "editor";
  const editorPass = randomPassword();
  const adminUser = db.adminUser || "admin";
  const adminPass = brief.wpAdminPassword || db.adminPassword || randomPassword();
  const adminEmail = brief.wpAdminEmail || db.adminEmail || brief.email;
  const editorEmail = brief.wpEditorEmail || db.editorEmail || brief.email || adminEmail;
  const siteTitle = brief.siteName || brief.companyName || "WordPress";

  if (!db.user) {
    throw new Error("Database user is required to install WordPress over SSH");
  }
  if (!dbName) {
    throw new Error("Database name is required to install WordPress over SSH");
  }
  if (!adminEmail) {
    throw new Error("Admin email is required to install WordPress");
  }

  log(`Preparing WordPress in ${remotePath}`);
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const folder = await ensureRemoteFolder(ssh, remotePath);
  log(folder.created ? `Created folder ${remotePath}` : `Using existing folder ${remotePath}`);

  const siteRoot = remotePathArg(remotePath);
  const hasCore = await ssh.execCommand(`if [ -f ${siteRoot}/wp-load.php ]; then echo YES; else echo NO; fi`);
  if (String(hasCore.stdout || "").trim() !== "YES") {
    log("Downloading WordPress core");
    await sshExec(ssh, `${wp} core download --force`);
    log("WordPress core downloaded");
  } else {
    log("WordPress core is already in this folder");
  }

  const hasConfig = await ssh.execCommand(`if [ -f ${siteRoot}/wp-config.php ]; then echo YES; else echo NO; fi`);
  if (String(hasConfig.stdout || "").trim() !== "YES") {
    log(`Writing wp-config.php for database ${dbName} on ${db.host}`);
    await sshExec(
      ssh,
      `${wp} config create --dbname=${shQuote(dbName)} --dbuser=${shQuote(db.user)} --dbpass=${shQuote(db.password)} --dbhost=${shQuote(db.host)} --dbprefix=${shQuote(dbPrefix)} --skip-check --force`
    );
  } else {
    log("wp-config.php already exists");
  }

  await sshExec(ssh, `${wp} config set WP_ENVIRONMENT_TYPE local --type=constant`);
  log("WordPress environment set to local so REST application passwords work over HTTP");

  log(`Checking database ${dbName}`);
  const ping = await ssh.execCommand(`${wp} db query "SELECT 1"`);
  if (ping.code !== 0) {
    log(`Creating database ${dbName}`);
    const createdb = await ssh.execCommand(`${wp} db create`);
    if (createdb.code !== 0 && !/already exists/i.test(`${createdb.stderr} ${createdb.stdout}`)) {
      throw new Error(createdb.stderr || createdb.stdout || ping.stderr || "Could not use or create the WordPress database");
    }
  }
  log(`Database ${dbName} is ready`);

  const installed = await ssh.execCommand(`${wp} core is-installed`);
  let installedNow = false;
  if (installed.code !== 0) {
    log(`Running WordPress install for ${siteTitle} at ${siteUrl}`);
    await sshExec(
      ssh,
      `${wp} core install --url=${shQuote(siteUrl)} --title=${shQuote(siteTitle)} --admin_user=${shQuote(adminUser)} --admin_password=${shQuote(adminPass)} --admin_email=${shQuote(adminEmail)} --skip-email`
    );
    installedNow = true;
    log(`WordPress installed. Admin user: ${adminUser} (${adminEmail})`);
    await sshExec(ssh, `${wp} rewrite structure '/%postname%/' --hard`);
    await sshExec(ssh, `${wp} rewrite flush --hard`);
    log("Pretty permalinks enabled");
  } else {
    log("WordPress is already installed in this folder");
  }

  const editorExists = await ssh.execCommand(`${wp} user get ${shQuote(editorUser)} --field=ID`);
  if (editorExists.code !== 0) {
    log(`Creating editor user ${editorUser} (${editorEmail})`);
    await sshExec(
      ssh,
      `${wp} user create ${shQuote(editorUser)} ${shQuote(editorEmail)} --role=editor --user_pass=${shQuote(editorPass)} --display_name=${shQuote(editorUser)}`
    );
  } else {
    log(`Editor user ${editorUser} already exists`);
  }

  log("Creating an application password for the editor");
  const app = await sshExec(
    ssh,
    `${wp} user application-password create ${shQuote(editorUser)} ${shQuote("WP Theme Studio")} --porcelain`
  );
  const appPassword = String(app.stdout || "").trim();
  if (!appPassword) {
    throw new Error("WordPress did not return an application password for the editor user");
  }
  log("Application password created for the editor");

  return {
    folderCreated: folder.created,
    wpUsername: editorUser,
    wpAppPassword: appPassword,
    adminUser,
    adminPassword: installedNow ? adminPass : (brief.wpAdminPassword || db.adminPassword || ""),
    editorCreated: editorExists.code !== 0,
    siteUrl,
    dbName,
  };
}

function parseJsonOutput(text, fallback = []) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw || "null") ?? fallback;
  } catch {
    const start = Math.max(raw.lastIndexOf("{"), raw.lastIndexOf("["));
    const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function menuRank(page) {
  const slug = String(page.post_name || "").toLowerCase();
  if (slug === "home" || slug === "front-page") return 0;
  if (slug === "about" || slug === "about-us") return 1;
  if (slug === "contact" || slug === "contact-us") return 2;
  return 10;
}

export async function installThemeOverSsh(ssh, remotePath, zipPath, filename, slug = "") {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const remoteZip = `/tmp/${filename || path.basename(zipPath)}`;
  await ssh.putFile(zipPath, remoteZip);

  const listed = parseJsonOutput((await ssh.execCommand(`${wp} theme list --format=json`)).stdout, []);
  const names = (Array.isArray(listed) ? listed : [])
    .map((item) => String(item?.name || item?.stylesheet || "").trim())
    .filter(Boolean);
  const active = String((await ssh.execCommand(`${wp} theme list --status=active --field=name`)).stdout || "").trim();
  const target = String(slug || path.basename(zipPath, ".zip")).trim();
  const already = Boolean(target && names.includes(target));
  let replaced = false;

  if (already) {
    if (active === target) {
      const fallback = names.find((name) => name !== target && /^twenty/i.test(name)) || names.find((name) => name !== target);
      if (fallback) {
        await sshExec(ssh, `${wp} theme activate ${shQuote(fallback)}`);
      }
    }
    const deleted = await ssh.execCommand(`${wp} theme delete ${shQuote(target)}`);
    replaced = deleted.code === 0;
  }

  await sshExec(ssh, `${wp} theme install ${shQuote(remoteZip)} --activate --force`);
  await ssh.execCommand(`rm -f ${shQuote(remoteZip)}`);
  const installedName = String((await ssh.execCommand(`${wp} theme list --status=active --field=name`)).stdout || "").trim();
  return { name: installedName, replaced: replaced || already };
}

export async function setThemeLogoOverSsh(ssh, remotePath, logoPath, title = "Logo") {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const remote = `/tmp/wtg-logo-${Date.now()}.webp`;
  await ssh.putFile(logoPath, remote);
  const imported = await ssh.execCommand(
    `${wp} media import ${shQuote(remote)} --porcelain --title=${shQuote(title)} --alt=${shQuote(title)}`
  );
  await ssh.execCommand(`rm -f ${shQuote(remote)}`);
  const id = Number(String(imported.stdout || "").trim());
  if (!id) {
    throw new Error(String(imported.stderr || imported.stdout || "Could not import the logo into WordPress media").trim());
  }
  await sshExec(ssh, `${wp} theme mod set custom_logo ${id}`);
  return { id };
}

export async function ensurePrimaryMenuOverSsh(ssh, remotePath) {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const pagesRaw = await ssh.execCommand(
    `${wp} post list --post_type=page --post_status=publish --fields=ID,post_title,post_name --format=json`
  );
  const pages = parseJsonOutput(pagesRaw.stdout, [])
    .filter((page) => {
      const slug = String(page.post_name || "").toLowerCase();
      const title = String(page.post_title || "").toLowerCase();
      return slug !== "sample-page" && title !== "sample page";
    })
    .sort((a, b) => menuRank(a) - menuRank(b) || String(a.post_title).localeCompare(String(b.post_title)));

  if (!pages.length) return { name: "Primary", items: 0 };

  const menus = parseJsonOutput((await ssh.execCommand(`${wp} menu list --format=json`)).stdout, []);
  let menu = (Array.isArray(menus) ? menus : []).find(
    (item) => String(item.slug || "").toLowerCase() === "primary" || String(item.name || "").toLowerCase() === "primary"
  );
  if (!menu) {
    await sshExec(ssh, `${wp} menu create ${shQuote("Primary")}`);
    const created = parseJsonOutput((await ssh.execCommand(`${wp} menu list --format=json`)).stdout, []);
    menu = (Array.isArray(created) ? created : []).find(
      (item) => String(item.slug || "").toLowerCase() === "primary" || String(item.name || "").toLowerCase() === "primary"
    );
  }
  if (!menu) {
    throw new Error("WordPress did not create a Primary menu");
  }
  const menuId = menu.term_id || menu.slug || "Primary";
  await ssh.execCommand(`${wp} menu location assign ${shQuote(String(menuId))} primary`);

  const items = parseJsonOutput(
    (await ssh.execCommand(`${wp} menu item list ${shQuote(String(menuId))} --fields=type,object_id --format=json`)).stdout,
    []
  );
  const have = new Set(
    (Array.isArray(items) ? items : [])
      .filter((item) => String(item.type || "") === "post_type")
      .map((item) => String(item.object_id))
  );
  let added = 0;
  for (const page of pages) {
    if (have.has(String(page.ID))) continue;
    await sshExec(ssh, `${wp} menu item add-post ${shQuote(String(menuId))} ${Number(page.ID)}`);
    added += 1;
  }
  return { name: menu.name || "Primary", items: have.size + added };
}

export async function installPluginZipOverSsh(ssh, remotePath, zipPath, filename) {
  const cli = await ensureWpCli(ssh);
  const remoteZip = `/tmp/${filename || path.basename(zipPath)}`;
  await ssh.putFile(zipPath, remoteZip);
  const wp = wpBin(cli, remotePath);
  await sshExec(ssh, `${wp} plugin install ${shQuote(remoteZip)} --activate --force`);
  await ssh.execCommand(`rm -f ${shQuote(remoteZip)}`);
}

export async function ensureCf7PluginOverSsh(ssh, remotePath) {
  return ensureWpPluginOverSsh(ssh, remotePath, "contact-form-7");
}

export async function createCf7FormOverSsh(ssh, remotePath, spec) {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const stamp = Date.now();
  const localJson = path.join(os.tmpdir(), `wtg-cf7-${stamp}.json`);
  const localPhp = path.join(os.tmpdir(), `wtg-cf7-${stamp}.php`);
  const remoteJson = `/tmp/wtg-cf7-${stamp}.json`;
  const remotePhp = `/tmp/wtg-cf7-${stamp}.php`;
  const payload = {
    title: String(spec?.title || "Contact"),
    form: String(spec?.form || ""),
    mailSubject: String(spec?.mailSubject || ""),
    mailRecipient: String(spec?.mailRecipient || ""),
    mailBodyHtml: String(spec?.mailBodyHtml || ""),
  };
  const php = `<?php
$spec = json_decode((string) file_get_contents(${JSON.stringify(remoteJson)}), true);
if (!is_array($spec)) { fwrite(STDERR, 'Invalid CF7 payload'); exit(1); }
if (!class_exists('WPCF7_ContactForm')) { fwrite(STDERR, 'Contact Form 7 is not active'); exit(1); }
$contact_form = WPCF7_ContactForm::get_template(array('title' => $spec['title']));
$properties = $contact_form->get_properties();
$properties['form'] = (string) ($spec['form'] ?? '');
$properties['mail']['subject'] = (string) ($spec['mailSubject'] ?? '');
$properties['mail']['recipient'] = (string) ($spec['mailRecipient'] ?? '');
$properties['mail']['body'] = (string) ($spec['mailBodyHtml'] ?? '');
$properties['mail']['use_html'] = true;
$properties['mail']['sender'] = $spec['title'] . ' <[your-email]>';
$contact_form->set_properties($properties);
$contact_form->set_title($spec['title']);
$contact_form->save();
$id = $contact_form->id();
echo wp_json_encode(array(
  'id' => $id,
  'shortcode' => '[contact-form-7 id="' . $id . '" title="' . esc_attr($spec['title']) . '"]',
));
`;
  await fs.writeFile(localJson, JSON.stringify(payload));
  await fs.writeFile(localPhp, php);
  await ssh.putFile(localJson, remoteJson);
  await ssh.putFile(localPhp, remotePhp);
  try {
    const result = await sshExec(ssh, `${wp} eval-file ${shQuote(remotePhp)}`);
    const parsed = parseJsonOutput(result.stdout, null);
    if (!parsed?.id || !parsed?.shortcode) {
      throw new Error((result.stderr || result.stdout || "Could not create the Contact Form 7 form").trim());
    }
    return parsed;
  } finally {
    await ssh.execCommand(`rm -f ${shQuote(remoteJson)} ${shQuote(remotePhp)}`);
    await fs.unlink(localJson).catch(() => {});
    await fs.unlink(localPhp).catch(() => {});
  }
}

export async function uploadMediaOverSsh(ssh, remotePath, localPath, filename, meta = {}) {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const safeName = String(filename || path.basename(localPath) || "image.webp").replace(/[^a-zA-Z0-9._-]/g, "_");
  const remote = `/tmp/wtg-media-${Date.now()}-${safeName}`;
  await ssh.putFile(localPath, remote);
  try {
    const imported = await sshExec(
      ssh,
      `${wp} media import ${shQuote(remote)} --title=${shQuote(meta.title || safeName)} --alt=${shQuote(meta.alt || meta.title || safeName)} --porcelain`
    );
    const id = Number(String(imported.stdout || "").trim());
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error((imported.stderr || imported.stdout || "WordPress did not return a media ID").trim());
    }
    const urlRes = await sshExec(ssh, `${wp} eval ${shQuote(`echo wp_get_attachment_url(${id});`)}`);
    const source_url = String(urlRes.stdout || "").trim();
    if (!source_url) {
      throw new Error(`WordPress imported ${safeName} but did not return a public URL`);
    }
    return { id, source_url };
  } finally {
    await ssh.execCommand(`rm -f ${shQuote(remote)}`);
  }
}

export async function ensureWpPluginOverSsh(ssh, remotePath, pluginSlug) {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const active = await ssh.execCommand(`${wp} plugin is-active ${shQuote(pluginSlug)}`);
  if (active.code === 0) return { slug: pluginSlug, action: "active" };
  const installed = await ssh.execCommand(`${wp} plugin is-installed ${shQuote(pluginSlug)}`);
  if (installed.code === 0) {
    await sshExec(ssh, `${wp} plugin activate ${shQuote(pluginSlug)}`);
    return { slug: pluginSlug, action: "activated" };
  }
  await sshExec(ssh, `${wp} plugin install ${shQuote(pluginSlug)} --activate`);
  return { slug: pluginSlug, action: "installed" };
}

export async function applyElementorPageOverSsh(ssh, remotePath, pageId, data) {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const active = await ssh.execCommand(`${wp} plugin is-active elementor`);
  if (active.code !== 0) {
    throw new Error("Elementor is not installed or active on this WordPress site");
  }
  const json = typeof data === "string" ? data : JSON.stringify(data);
  const local = path.join(os.tmpdir(), `wtg-elementor-${pageId}.json`);
  const remote = `/tmp/wtg-elementor-${pageId}.json`;
  await fs.writeFile(local, json);
  await ssh.putFile(local, remote);
  await sshExec(ssh, `${wp} post meta update ${Number(pageId)} _elementor_edit_mode builder`);
  await sshExec(ssh, `${wp} post meta update ${Number(pageId)} _elementor_template_type wp-page`);
  await sshExec(ssh, `${wp} post meta update ${Number(pageId)} _elementor_data "$(cat ${shQuote(remote)})"`);
  await ssh.execCommand(`rm -f ${shQuote(remote)}`);
}

export async function detectActiveBuilders(ssh, remotePath) {
  const cli = await ensureWpCli(ssh);
  const wp = wpBin(cli, remotePath);
  const listed = await ssh.execCommand(`${wp} plugin list --status=active --format=json`);
  if (listed.code !== 0) {
    throw new Error((listed.stderr || listed.stdout || "Could not list WordPress plugins").trim());
  }
  let items = [];
  try {
    items = JSON.parse(String(listed.stdout || "[]"));
  } catch {
    items = String(listed.stdout || "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((name) => ({ name }));
  }
  const names = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.name || item || "").trim().toLowerCase())
    .filter(Boolean);
  return {
    html: true,
    gutenberg: true,
    wpbakery: names.some((name) => /js_composer|wpbakery/.test(name)),
    elementor: names.some((name) => name === "elementor" || name.startsWith("elementor")),
    cf7: names.some((name) => name === "contact-form-7"),
    yoast: names.some((name) => name === "wordpress-seo"),
    plugins: names,
  };
}
