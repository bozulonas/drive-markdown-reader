# Drive Markdown Reader

A deliberately small, browser-only Markdown reader for an Obsidian vault stored in Google Drive. Reading uses `drive.readonly`; optional manual editing uses `drive.file` only for files opened with this app.

It supports:

- Reading `.md` / `text/markdown` files from Google Drive
- Drive handoff URLs (`?fileId=…` and Drive's `state={"ids":[…]}` format)
- Obsidian-style `[[Wiki Links]]`, aliases (`[[Note|label]]`), and heading links (`[[Note#Heading]]`)
- Safe Markdown rendering (Markdown embedded HTML is disabled and output is sanitized)
- Manual editing with a Drive-version check that blocks a save when the note changed since it was opened

## Run it locally

This is a static site, but OAuth needs a real origin. From this folder run:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Google setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project, enable the **Google Drive API** and **Google Picker API**.
2. Configure the OAuth consent screen as **External** (test users are fine for personal use), add your Google account as a test user if required, and declare `drive.readonly`, `drive.file`, plus `drive.install`. The first searches and reads your vault, `drive.file` permits manual saves only for files opened with this app, and `drive.install` allows the app to appear in Drive’s **Open with** menu.
3. Create an **OAuth client ID → Web application**. Add your local and deployed origins (for example `http://localhost:8000`) to **Authorized JavaScript origins**.
4. Paste the client ID into `config.js`. Optionally create a browser API key restricted to Google Picker API and add it as `developerKey` for the picker button.
5. Host this folder on HTTPS (GitHub Pages, Cloudflare Pages, etc.) and add that exact origin to OAuth.

## Make it appear under “Open with” in Drive

Google Drive's native search results can hand a selected file to a web application registered as a Drive **Open URL** integration. In Google Cloud Console, open **APIs & Services → Google Drive API → Drive UI integration**, set the Open URL to your deployed `index.html`, and add `md` under **Default file extensions** (plus `text/markdown` / `text/plain` MIME types as appropriate). Drive will call it with a `state` query parameter containing the selected file ID; this app already understands that parameter.

This registration is usually the only non-code setup needed for the desired “click in Drive → reader” experience. If Drive does not offer custom Open-with registration for a personal-only unpublished integration in your Workspace/account, the fallback is a bookmark to the deployed reader and its built-in note search; the code remains the same.

## Caveats

- Wiki links match Drive filenames. If names collide, the reader prefers a note in the current note's folder, then uses the first result.
- Attachments, embeds, backlinks, Obsidian plugins, and full Obsidian query syntax are intentionally out of scope.
- Use `[[Folder/Note]]` only if the Drive filename itself is `Folder/Note.md`; folder-path resolution is not implemented.
