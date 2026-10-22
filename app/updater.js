// 自动更新：源码运行用 git，安装版用 GitHub Releases / 公开 Release URL
const { app } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const OWNER = "B-LIPSTICK";
const REPO = "commlab-studio-public";
const API = "https://api.github.com/repos/" + OWNER + "/" + REPO;
const PUBLIC_URL_ENV = ["COMMLAB_RELEASE_URL", "GITHUB_RELEASE_URL"];
const TOKEN_ENV = ["GITHUB_TOKEN", "GH_TOKEN"];

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: ROOT, timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message || err)));
      else resolve(String(stdout || "").trim());
    });
  });
}

const hasGit = () => fs.existsSync(path.join(ROOT, ".git"));

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

const getToken = () => firstEnv(TOKEN_ENV);
const getPublicReleaseUrl = () => firstEnv(PUBLIC_URL_ENV);

function headers(token, accept) {
  const h = {
    "User-Agent": "CommLab-Studio",
    Accept: accept || "application/vnd.github+json",
  };
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

function httpError(status, url, token) {
  if (status === 401) return "更新凭据无效或已过期（HTTP 401）";
  if (status === 403) return "更新请求被拒绝（HTTP 403），可能是 token 权限不足或触发限流";
  if (status === 404) {
    if (/api\.github\.com/i.test(url)) {
      return token
        ? "GitHub Release 不存在（HTTP 404）；请确认仓库/Release 名称，并检查 token 是否有 repo 读取权限"
        : "GitHub Release 不存在或仓库为私有（HTTP 404）；请设置 GITHUB_TOKEN，或设置 COMMLAB_RELEASE_URL 指向公开 Release";
    }
    return "更新地址不存在（HTTP 404）：" + url;
  }
  return "更新服务器返回 HTTP " + status;
}

async function fetchJson(url, token) {
  let res;
  try {
    res = await fetch(url, { headers: headers(token), redirect: "follow" });
  } catch (e) {
    throw new Error("无法连接更新服务器：" + (e && e.message ? e.message : String(e)));
  }
  if (!res.ok) throw new Error(httpError(res.status, url, token));
  try {
    return await res.json();
  } catch {
    throw new Error("更新服务器返回的不是有效 JSON");
  }
}

function versionGt(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function versionFromUrl(url) {
  const clean = String(url || "").split(/[?#]/)[0];
  const name = decodeURIComponent(clean.split("/").pop() || "");
  const tagged = name.match(/(?:CommLabStudio|commlab-studio)[-_]?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)/i);
  const any = tagged || name.match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)/);
  return any ? any[1] : "";
}

function absoluteUrl(url, base) {
  try { return new URL(url, base).href; }
  catch { return url; }
}

function normalizeGithubRelease(rel) {
  const version = String(rel.tag_name || rel.version || rel.name || "").replace(/^v/i, "");
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const asset = assets.find((a) => /setup.*\.exe$/i.test(a.name || "")) ||
    assets.find((a) => /\.exe$/i.test(a.name || "")) ||
    assets[0];
  if (!asset) throw new Error("Release 中没有可下载的安装包（.exe）");
  const url = asset.browser_download_url || "";
  return {
    version: version || versionFromUrl(url),
    url,
    apiUrl: asset.url || "",
    notes: rel.body || "",
    source: "github-release",
  };
}

function normalizeManifest(data, baseUrl) {
  const version = String(data.version || data.tag_name || data.name || "").replace(/^v/i, "");
  let url = data.url || data.downloadUrl || data.download_url || data.path || "";
  if (!url && Array.isArray(data.files) && data.files[0]) {
    url = data.files[0].url || data.files[0].path || "";
  }
  if (!url) throw new Error("Release 清单缺少下载地址（version/url）");
  url = absoluteUrl(url, baseUrl);
  return {
    version: version || versionFromUrl(url),
    url,
    apiUrl: "",
    notes: data.notes || data.body || "",
    source: "manifest",
  };
}

function parseYamlManifest(text, baseUrl) {
  const versionMatch = text.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
  const urlMatch = text.match(/^\s*(?:-\s*)?url:\s*['"]?([^'"\s]+)['"]?\s*$/m) ||
    text.match(/^path:\s*['"]?([^'"\s]+)['"]?\s*$/m);
  if (!urlMatch) throw new Error("latest.yml 缺少 url/path");
  const url = absoluteUrl(urlMatch[1], baseUrl);
  return {
    version: (versionMatch ? versionMatch[1] : "") || versionFromUrl(url),
    url,
    apiUrl: "",
    notes: "",
    source: "latest.yml",
  };
}

async function resolvePublicRelease(url, token) {
  const clean = String(url).split(/[?#]/)[0];
  const lower = clean.toLowerCase();

  const latestPage = clean.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/?$/i);
  if (latestPage) {
    const apiUrl = "https://api.github.com/repos/" + latestPage[1] + "/" + latestPage[2] + "/releases/latest";
    return normalizeGithubRelease(await fetchJson(apiUrl, token));
  }
  const tagPage = clean.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/]+)\/?$/i);
  if (tagPage) {
    const apiUrl = "https://api.github.com/repos/" + tagPage[1] + "/" + tagPage[2] + "/releases/tags/" + encodeURIComponent(tagPage[3]);
    return normalizeGithubRelease(await fetchJson(apiUrl, token));
  }

  if (/\.(exe|msi|zip)$/i.test(lower)) {
    const version = versionFromUrl(clean);
    if (!version) throw new Error("无法从下载 URL 推断版本；请改用 latest.json 或 GitHub Release API");
    return { version, url: clean, apiUrl: "", notes: "", source: "direct" };
  }

  let res;
  try {
    res = await fetch(clean, { headers: headers(token), redirect: "follow" });
  } catch (e) {
    throw new Error("无法连接更新服务器：" + (e && e.message ? e.message : String(e)));
  }
  if (!res.ok) throw new Error(httpError(res.status, clean, token));

  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (type.includes("json") || /\.json$/i.test(lower) || /api\.github\.com/i.test(clean)) {
    let data;
    try { data = await res.json(); }
    catch { throw new Error("更新地址返回的不是有效 JSON"); }
    if (data && (data.tag_name || data.assets)) return normalizeGithubRelease(data);
    return normalizeManifest(data, clean);
  }
  if (type.includes("yaml") || type.includes("yml") || /\.ya?ml$/i.test(lower)) {
    return parseYamlManifest(await res.text(), clean);
  }

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data && (data.tag_name || data.assets)) return normalizeGithubRelease(data);
    return normalizeManifest(data, clean);
  } catch {}
  if (/^\s*version\s*:/m.test(text)) return parseYamlManifest(text, clean);
  throw new Error("公开 Release URL 返回了不支持的内容；请指向 GitHub API、latest.json、latest.yml 或安装包直链");
}

function getReleaseSource() {
  const publicUrl = getPublicReleaseUrl();
  const token = getToken();
  if (publicUrl) return { url: publicUrl, token, source: "public-url" };
  // 仓库已确定转公开：没有 token 时也先尝试公开 GitHub API。
  // 如果仓库仍是私有，404 会由 httpError 返回明确原因。
  return { url: API + "/releases/latest", token, source: token ? "github" : "github-public" };
}

async function resolveRelease() {
  const source = getReleaseSource();
  if (source.error) return { ok: false, error: source.error, code: source.code };
  try {
    const rel = await resolvePublicRelease(source.url, source.token);
    if (!rel.version) return { ok: false, error: "无法确定最新版本号；请检查 Release 标签或下载文件名" };
    if (!rel.url) return { ok: false, error: "Release 中没有可下载的安装包" };
    return { ok: true, ...rel };
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    const code = !source.token && /HTTP 404|私有/.test(message) ? "NO_UPDATE_CREDENTIALS" : undefined;
    return { ok: false, error: message, code };
  }
}

async function check() {
  if (hasGit()) {
    try {
      const local = await run("git", ["rev-parse", "HEAD"]);
      await run("git", ["fetch", "origin", "main", "--quiet"]);
      const remote = await run("git", ["rev-parse", "origin/main"]);
      if (local && remote && local !== remote) {
        let notes = "";
        try { notes = await run("git", ["log", "--oneline", local + ".." + remote]); } catch {}
        return { mode: "git", update: true, local, remote, notes };
      }
      return { mode: "git", update: false, local, remote };
    } catch (e) {
      return { mode: "git", update: false, error: e.message };
    }
  }

  const rel = await resolveRelease();
  if (!rel.ok) return { mode: "release", update: false, error: rel.error, code: rel.code };
  const current = app.getVersion();
  return {
    mode: "release",
    update: versionGt(rel.version, current),
    version: rel.version,
    current,
    latest: rel.version,
    url: rel.url,
    apiUrl: rel.apiUrl,
    notes: rel.notes,
    source: rel.source,
    auth: rel.source === "github-release" ? "github" : "",
  };
}

async function download(url, dest, opts) {
  const o = opts || {};
  let res;
  try {
    res = await fetch(url, {
      headers: headers(o.token, o.accept || "application/octet-stream"),
      redirect: "follow",
    });
  } catch (e) {
    throw new Error("下载更新失败：" + (e && e.message ? e.message : String(e)));
  }
  if (!res.ok) throw new Error(httpError(res.status, url, o.token));
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = dest + ".part";
  try {
    fs.writeFileSync(tmp, buf);
    try { fs.rmSync(dest, { force: true }); } catch {}
    fs.renameSync(tmp, dest);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
  return dest;
}

async function apply() {
  if (hasGit()) {
    try {
      const out = await run("git", ["pull", "--ff-only", "origin", "main"], 60000);
      setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
      return { ok: true, restart: true, log: out };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  const info = await check();
  if (info.error) return { ok: false, reason: info.error };
  if (!info.update || !info.url) {
    return { ok: false, reason: info.update === false ? "当前已是最新版本（" + info.current + "）" : "没有可用的更新包" };
  }
  if (!/\.exe$/i.test(String(info.url).split(/[?#]/)[0])) {
    return { ok: false, reason: "更新包不是 .exe 安装包，无法自动安装；请手动下载：" + info.url };
  }

  try {
    const dest = path.join(os.tmpdir(), "CommLabStudio-" + info.version + "-setup.exe");
    const token = info.auth === "github" ? getToken() : "";
    const url = info.auth === "github" && info.apiUrl && token ? info.apiUrl : info.url;
    await download(url, dest, { token });
    const child = require("child_process").spawn(dest, [], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    setTimeout(() => app.quit(), 800);
    return { ok: true, restart: true, installer: dest };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { check, apply };
