/* global gapi, google, marked, DOMPurify */
const config = window.DRIVE_MARKDOWN_CONFIG;
// `drive.install` only registers this app in Drive's “Open with” menu; it does not grant write access.
const scope = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.install";
const tokenStorageKey = "drive-markdown-reader.token.v2";
const recentStorageKey = "drive-markdown-reader.recent";
let tokenClient;
let accessToken;
let currentFile;
let currentMarkdown = "";
let editing = false;
let searchTimer;
const noteHistory = [];

const $ = (selector) => document.querySelector(selector);
const status = (text, error = false) => {
  const el = $("#connection-status");
  el.textContent = text;
  el.classList.toggle("error", error);
};

function rememberToken(response) {
  accessToken = response.access_token;
  // Preserve only the temporary, read-only access token. No refresh token or
  // Drive content is stored, and the cache expires one minute before the token.
  // GIS normally supplies expires_in. Use a conservative 55-minute fallback
  // when it does not, rather than discarding an otherwise usable token.
  const lifetimeSeconds = Number(response.expires_in || 3300);
  const expiresAt = Date.now() + Math.max(60, lifetimeSeconds - 60) * 1000;
  localStorage.setItem(tokenStorageKey, JSON.stringify({ accessToken, expiresAt }));
}

function forgetToken() {
  accessToken = undefined;
  localStorage.removeItem(tokenStorageKey);
  $("#connect").textContent = "Connect Google Drive";
}

function updateBackButton() {
  $("#back").disabled = noteHistory.length === 0;
}

function updateEditorButtons() {
  const canEdit = Boolean(currentFile?.capabilities?.canEdit);
  $("#edit").disabled = !currentFile || !canEdit || editing;
  $("#edit").hidden = editing;
  $("#discard").hidden = !editing;
  $("#save").hidden = !editing;
}

function recentNotes() {
  try { return JSON.parse(localStorage.getItem(recentStorageKey)) || []; }
  catch { return []; }
}

function renderRecent() {
  const container = $("#recent");
  container.replaceChildren();
  recentNotes().forEach((file) => {
    const item = $("#result-template").content.firstElementChild.cloneNode(true);
    item.querySelector(".result-name").textContent = file.name;
    item.querySelector(".result-path").textContent = "Markdown note";
    item.addEventListener("click", () => loadFile(file.id));
    container.append(item);
  });
  if (!container.childElementCount) container.textContent = "No notes opened yet.";
}

function addRecent(file) {
  const recent = recentNotes().filter((item) => item.id !== file.id);
  recent.unshift({ id: file.id, name: file.name });
  localStorage.setItem(recentStorageKey, JSON.stringify(recent.slice(0, 8)));
  renderRecent();
}

async function restoreToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(tokenStorageKey));
    if (!saved?.accessToken || saved.expiresAt <= Date.now()) return forgetToken();
    accessToken = saved.accessToken;
    $("#connect").textContent = "Drive connected";
    status("Restoring your Drive session…");
    const id = requestedFileId();
    if (id) await loadFile(id); else await searchNotes();
  } catch { forgetToken(); }
}

async function driveFetch(path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  if (response.status === 401) forgetToken();
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

async function loadFile(id, { addToHistory = true } = {}) {
  if (editing && !window.confirm("Discard unsaved edits and open another note?")) return false;
  try {
    status("Opening note…");
    const metadata = await (await driveFetch(`files/${id}?fields=id,name,mimeType,parents,webViewLink,version,modifiedTime,capabilities(canEdit)`)).json();
    if (!metadata.name.toLowerCase().endsWith(".md") && metadata.mimeType !== "text/markdown") {
      throw new Error("This reader can only open Markdown files.");
    }
    const markdown = await (await driveFetch(`files/${id}?alt=media`)).text();
    if (addToHistory && currentFile && currentFile.id !== metadata.id) {
      noteHistory.push({ id: currentFile.id, name: currentFile.name });
      updateBackButton();
    }
    currentFile = metadata;
    currentMarkdown = markdown;
    editing = false;
    addRecent(metadata);
    document.title = `${metadata.name} · Drive Markdown Reader`;
    render(markdown);
    history.replaceState({}, "", `?fileId=${encodeURIComponent(id)}`);
    status(`Viewing ${metadata.name}`);
    updateEditorButtons();
    return true;
  } catch (error) { status(error.message, true); return false; }
}

async function goBack() {
  const previous = noteHistory.at(-1);
  if (previous && await loadFile(previous.id, { addToHistory: false })) noteHistory.pop();
  updateBackButton();
}

function startEditing() {
  if (!currentFile?.capabilities?.canEdit) return;
  editing = true;
  $("#document").replaceChildren();
  const editor = document.createElement("textarea");
  editor.id = "editor";
  editor.className = "editor";
  editor.value = currentMarkdown;
  $("#document").append(editor);
  updateEditorButtons();
  editor.focus();
}

function discardEdits() {
  editing = false;
  render(currentMarkdown);
  updateEditorButtons();
  status(`Viewing ${currentFile.name}`);
}

async function saveEdits() {
  const editor = $("#editor");
  if (!editor || !currentFile) return;
  try {
    status("Checking for changes in Drive…");
    const latest = await (await driveFetch(`files/${currentFile.id}?fields=id,version,modifiedTime,capabilities(canEdit)`)).json();
    if (!latest.capabilities?.canEdit) throw new Error("You no longer have permission to edit this note.");
    if (latest.version !== currentFile.version) {
      throw new Error("This note changed in Drive while you were editing. Your changes were not saved—reload the note and merge them manually.");
    }
    status("Saving to Drive…");
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${currentFile.id}?uploadType=media&fields=id,name,mimeType,parents,version,modifiedTime,capabilities(canEdit)`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": currentFile.mimeType || "text/markdown" },
      body: editor.value,
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || response.statusText);
    currentFile = { ...currentFile, ...(await response.json()) };
    currentMarkdown = editor.value;
    editing = false;
    render(currentMarkdown);
    updateEditorButtons();
    status("Saved to Drive.");
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

function isMarkdownFile(file) {
  return file.mimeType === "text/markdown" || file.name.toLowerCase().endsWith(".md");
}

function searchRank(file, term) {
  if (!term) return 0;
  const name = file.name.toLowerCase();
  const bareName = name.endsWith(".md") ? name.slice(0, -3) : name;
  if (bareName === term) return 0;
  if (bareName.startsWith(term)) return 1;
  if (bareName.includes(term)) return 2;
  return 3;
}

async function searchNotes(term = "") {
  if (!accessToken) return;
  const base = "mimeType = 'text/markdown' or name contains '.md'";
  const normalizedTerm = term.trim().toLowerCase();
  const escapedTerm = term.trim().replace(/'/g, "\\'");
  // Filename search is intentional: it provides predictable note lookup and
  // avoids Drive's incompatible full-text relevance ordering.
  const text = escapedTerm ? ` and name contains '${escapedTerm}'` : "";
  try {
    const query = `(${base}) and trashed = false${text}`;
    const data = await (await driveFetch(`files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,parents,description)&orderBy=name&pageSize=100`)).json();
    const notes = data.files
      .filter(isMarkdownFile)
      .sort((a, b) => searchRank(a, normalizedTerm) - searchRank(b, normalizedTerm) || a.name.localeCompare(b.name))
      .slice(0, 30);
    const container = $("#results"); container.replaceChildren();
    notes.forEach((file) => {
      const item = $("#result-template").content.firstElementChild.cloneNode(true);
      item.querySelector(".result-name").textContent = file.name;
      item.querySelector(".result-path").textContent = file.description || "Markdown note";
      item.addEventListener("click", () => loadFile(file.id)); container.append(item);
    });
    if (!notes.length) container.textContent = "No Markdown notes found.";
  } catch (error) { status(error.message, true); }
}

function connect() {
  if (!config.clientId || config.clientId.startsWith("PASTE_")) { status("Add your Google OAuth client ID in config.js first.", true); return; }
  tokenClient ??= google.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope, callback: async (response) => {
    if (response.error) return status(response.error, true);
    rememberToken(response); $("#connect").textContent = "Drive connected"; status("Drive connected.");
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
$("#back").addEventListener("click", goBack);
$("#edit").addEventListener("click", startEditing);
$("#discard").addEventListener("click", discardEdits);
$("#save").addEventListener("click", saveEdits);
$("#open-file").addEventListener("click", openPicker);
$("#search").addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchNotes(event.target.value), 250); });
window.addEventListener("load", () => {
  updateBackButton();
  updateEditorButtons();
  renderRecent();
  if (localStorage.getItem(tokenStorageKey)) restoreToken();
  else if (requestedFileId()) status("Connect Drive to open the selected Markdown file.");
});
