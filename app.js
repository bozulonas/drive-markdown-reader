/* global gapi, google, marked, DOMPurify */
const config = window.DRIVE_MARKDOWN_CONFIG;
// `drive.install` only registers this app in Drive's “Open with” menu; it does not grant write access.
const scope = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.install";
let tokenClient;
let accessToken;
let currentFile;
let searchTimer;

const $ = (selector) => document.querySelector(selector);
const status = (text, error = false) => {
  const el = $("#connection-status");
  el.textContent = text;
  el.classList.toggle("error", error);
};

async function driveFetch(path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || response.statusText);
  return response;
}

function requestedFileId() {
  const params = new URLSearchParams(location.search);
  if (params.get("fileId")) return params.get("fileId");
  try {
    const state = JSON.parse(params.get("state"));
    return state.ids?.[0] || state.exportIds?.[0];
  } catch { return null; }
}

async function loadFile(id) {
  try {
    status("Opening note…");
    const metadata = await (await driveFetch(`files/${id}?fields=id,name,mimeType,parents,webViewLink`)).json();
    if (!metadata.name.toLowerCase().endsWith(".md") && metadata.mimeType !== "text/markdown") {
      throw new Error("This reader can only open Markdown files.");
    }
    const markdown = await (await driveFetch(`files/${id}?alt=media`)).text();
    currentFile = metadata;
    document.title = `${metadata.name} · Drive Markdown Reader`;
    render(markdown);
    history.replaceState({}, "", `?fileId=${encodeURIComponent(id)}`);
    status(`Viewing ${metadata.name}`);
  } catch (error) { status(error.message, true); }
}

function render(markdown) {
  // Keep embedded HTML disabled, then sanitize the generated Markdown HTML.
  marked.use({ breaks: true, gfm: true, renderer: { html: () => "" } });
  const wikiReady = markdown.replace(/!?(?:\[\[)([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (match, target, heading, label) => {
    const text = label || target;
    if (match.startsWith("!")) return `![${text}](${target})`;
    // Use an inert HTTPS URL through Markdown's parser, then turn it into an in-app link below.
    return `[${text}](https://drive-markdown-reader.invalid/wiki/${encodeURIComponent(target)}#${encodeURIComponent(heading || "")})`;
  });
  $("#document").innerHTML = DOMPurify.sanitize(marked.parse(wikiReady), { ADD_ATTR: ["data-target", "data-heading"] });
  $("#empty-state").hidden = true;
  $("#document").hidden = false;
  document.querySelectorAll('a[href^="https://drive-markdown-reader.invalid/wiki/"]').forEach((link) => {
    const url = new URL(link.href);
    link.classList.add("wiki-link");
    link.dataset.target = url.pathname.split("/").pop();
    link.dataset.heading = url.hash.slice(1);
    link.addEventListener("click", async (event) => {
    event.preventDefault();
    await openWikiLink(decodeURIComponent(link.dataset.target), decodeURIComponent(link.dataset.heading));
    });
  });
}

async function openWikiLink(target, heading) {
  const wanted = target.toLowerCase().endsWith(".md") ? target : `${target}.md`;
  const query = `name = '${wanted.replace(/'/g, "\\'")}' and trashed = false`;
  const result = await (await driveFetch(`files?q=${encodeURIComponent(query)}&fields=files(id,name,parents)&pageSize=20`)).json();
  const sameFolder = result.files.find((f) => f.parents?.some((p) => currentFile.parents?.includes(p)));
  const file = sameFolder || result.files[0];
  if (!file) { status(`Could not find linked note: ${wanted}`, true); return; }
  await loadFile(file.id);
  if (heading) location.hash = heading.toLowerCase().replace(/\s+/g, "-");
}

async function searchNotes(term = "") {
  if (!accessToken) return;
  const base = "mimeType = 'text/markdown' or name contains '.md'";
  const text = term.trim() ? ` and fullText contains '${term.trim().replace(/'/g, "\\'")}'` : "";
  try {
    const query = `(${base}) and trashed = false${text}`;
    const data = await (await driveFetch(`files?q=${encodeURIComponent(query)}&fields=files(id,name,parents,description)&orderBy=name&pageSize=50`)).json();
    const container = $("#results"); container.replaceChildren();
    data.files.forEach((file) => {
      const item = $("#result-template").content.firstElementChild.cloneNode(true);
      item.querySelector(".result-name").textContent = file.name;
      item.querySelector(".result-path").textContent = file.description || "Markdown note";
      item.addEventListener("click", () => loadFile(file.id)); container.append(item);
    });
    if (!data.files.length) container.textContent = "No Markdown notes found.";
  } catch (error) { status(error.message, true); }
}

function connect() {
  if (!config.clientId || config.clientId.startsWith("PASTE_")) { status("Add your Google OAuth client ID in config.js first.", true); return; }
  tokenClient ??= google.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope, callback: async (response) => {
    if (response.error) return status(response.error, true);
    accessToken = response.access_token; $("#connect").textContent = "Drive connected"; status("Drive connected — read-only access.");
    const id = requestedFileId(); if (id) await loadFile(id); else await searchNotes();
  }});
  tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
}

function openPicker() {
  if (!accessToken) return connect();
  if (!config.developerKey) return status("Use the note search, or add a Drive Picker developer key in config.js.", true);
  gapi.load("picker", () => {
    const view = new google.picker.DocsView().setMimeTypes("text/markdown,text/plain");
    new google.picker.PickerBuilder().setDeveloperKey(config.developerKey).setOAuthToken(accessToken).addView(view).setCallback((data) => {
      if (data.action === google.picker.Action.PICKED) loadFile(data.docs[0].id);
    }).build().setVisible(true);
  });
}

$("#connect").addEventListener("click", connect);
$("#open-file").addEventListener("click", openPicker);
$("#search").addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchNotes(event.target.value), 250); });
window.addEventListener("load", () => { if (requestedFileId()) status("Connect Drive to open the selected Markdown file."); });
