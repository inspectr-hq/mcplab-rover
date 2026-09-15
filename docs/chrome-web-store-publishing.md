# Publishing to the Chrome Web Store via GitHub Actions

`.github/workflows/release.yml` builds the extension, zips `dist/`, creates a GitHub release, and uploads/publishes the zip to the Chrome Web Store whenever a tag matching `v*.*.*` is pushed.

The Chrome Web Store step only works for **updates** to an existing listing and requires four repo secrets. One-time setup:

## 1. Publish once manually (required)

The Chrome Web Store API only handles updates — the first submission of a new extension must go through the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) by hand:

1. Upload the built zip and fill in the listing details.
2. Pay the one-time $5 developer registration fee if you haven't already.
3. Once approved, note the **Extension ID** shown in the dashboard URL / item page.

## 2. Create a Google Cloud OAuth client

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Chrome Web Store API** (APIs & Services → Library).
3. APIs & Services → Credentials → **Create Credentials → OAuth client ID** → Application type: **Desktop app**. This gives you a `CLIENT_ID` and `CLIENT_SECRET`.
4. If prompted, configure the OAuth consent screen (Internal or External, "Testing" mode is fine) and add the Google account that owns the Chrome Web Store item as a test user.

## 3. Get a refresh token

Run once locally (nothing needs to be committed):

```bash
npx chrome-webstore-upload-keys
```

This opens a browser OAuth flow using your `CLIENT_ID`/`CLIENT_SECRET` and prints a `REFRESH_TOKEN`.

## 4. Add repo secrets

In GitHub → Settings → Secrets and variables → Actions, add:

| Secret name          | Value                                      |
|-----------------------|---------------------------------------------|
| `CWS_EXTENSION_ID`    | Extension ID from step 1                    |
| `CWS_CLIENT_ID`       | OAuth client ID from step 2                 |
| `CWS_CLIENT_SECRET`   | OAuth client secret from step 2             |
| `CWS_REFRESH_TOKEN`   | Refresh token from step 3                   |

## 5. Cut a release

```bash
git tag v0.2.0
git push origin v0.2.0
```

This triggers `release.yml`, which builds, tests, zips, creates the GitHub release, and submits the update to the Chrome Web Store for review. `publish: true` in the workflow means the update goes live automatically once Google approves it — there's no separate manual "publish" click after review.

Until the four `CWS_*` secrets are set, the Chrome Web Store step will fail, but the GitHub release step before it still succeeds.
