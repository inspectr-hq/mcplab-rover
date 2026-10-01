# Publishing MCPLab Rover for Firefox

Firefox extensions must be signed by Mozilla before they can be installed in release and beta versions of Firefox. The usual route is to submit the extension through [addons.mozilla.org (AMO)](https://addons.mozilla.org/developers/), either as a public listing or as an unlisted, self-distributed add-on.

Before publishing, test Rover in Firefox. The release workflow creates a Firefox-specific package with a background script and a stable Gecko add-on ID. The extension still uses `chrome.*` APIs, so Firefox compatibility should be verified before creating an AMO submission.

## Load a development build without publishing

Firefox supports temporary add-ons for local testing. This does not require an AMO account, publication, or a signed package. It is removed when Firefox restarts.

First, use the Firefox-compatible build. Firefox does not support `background.service_worker`, so the release workflow transforms the Chrome manifest to use the same compiled `background.js` as a background script:

```json
{
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  }
}
```

Then:

1. Build the Firefox variant and leave its files together in a directory such as `dist-firefox/`.
2. Open Firefox and navigate to `about:debugging`.
3. Select **This Firefox**.
4. Select **Load Temporary Add-on**.
5. Choose `dist-firefox/manifest.json`, any file inside `dist-firefox/`, or a ZIP containing the Firefox build.
6. Use **Reload** in `about:debugging` after rebuilding.

The temporary add-on is intended for development and debugging, not end-user distribution. It may receive a temporary ID, and it is removed when Firefox restarts. Mozilla documents this workflow in [Temporary installation in Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

For automatic reloads while developing, install `web-ext` and run it from the Firefox build directory:

```bash
npx web-ext run --source-dir dist-firefox
```

## Build the submission package

From the repository root:

```bash
npm ci
npm run build
npm run build:firefox
cd dist-firefox
zip -r ../mcplab-rover-firefox-v0.3.0.zip .
```

The ZIP must contain the extension files at its root, including `manifest.json`. Do not put the `dist-firefox/` directory itself inside the ZIP. The version in `dist-firefox/manifest.json` is copied from the tag-driven Chrome build, so a release build from `v0.3.0` produces Firefox extension version `0.3.0`.

The GitHub release workflow attaches both `mcplab-rover-v0.3.0.zip` for Chrome and `mcplab-rover-firefox-v0.3.0.zip` for Firefox.

## Publish a public AMO listing

1. Create or sign in to a Mozilla account and open the [AMO Developer Hub](https://addons.mozilla.org/developers/).
2. Choose **Submit a new add-on** and select **On this site**.
3. Upload the Firefox ZIP produced from `dist-firefox/`.
4. Complete the listing information, including the summary, categories, license, screenshots, and privacy details.
5. If AMO asks for source code, upload the repository source and include the build instructions above. Rover uses Vite to bundle the extension, so keep the source submission reproducible.
6. Submit the add-on for review.

Once a listed add-on is approved, Firefox handles updates for installed copies when a newer version is published on AMO. Upload each later release as a new version of the same AMO listing, using a higher extension version.

## Self-distribute a signed build

Use this path if the extension should not have a public AMO listing:

1. Submit the extension to AMO for signing, choosing the self-distribution or unlisted option.
2. Download the signed `.xpi` file.
3. Host the signed `.xpi` at a stable HTTPS URL for users.
4. If Firefox should discover updates automatically, add a Firefox-specific `update_url` in `manifest.json` and host the corresponding update manifest. Keep this update URL stable across releases.

Self-distributed copies still need to be signed by Mozilla. An unsigned ZIP is suitable for development builds and supported Firefox developer configurations, but not normal Firefox release installations.

## Optional command-line submission

Mozilla also supports signing through `web-ext`. After installing `web-ext` and creating AMO API credentials, the shape of the command is:

```bash
web-ext sign \
  --source-dir dist-firefox \
  --channel listed \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"
```

For a Manifest V3 submission, configure a stable Firefox add-on ID with `browser_specific_settings.gecko.id` before using the command-line workflow. Store the API credentials in GitHub Actions secrets or another secret manager, never in the repository.

## References

- [Submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
- [Signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [Getting started with web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
- [Add-on IDs](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/)
