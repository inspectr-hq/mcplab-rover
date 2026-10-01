# Publishing MCPLab Rover for Firefox

Firefox extensions must be signed by Mozilla before they can be installed in release and beta versions of Firefox. The usual route is to submit the extension through [addons.mozilla.org (AMO)](https://addons.mozilla.org/developers/), either as a public listing or as an unlisted, self-distributed add-on.

Before publishing, test Rover in Firefox. This project currently uses a Chrome Manifest V3 manifest and `chrome.*` APIs, so Firefox compatibility should be verified before creating an AMO submission. Firefox-specific manifest settings may be needed as the port is completed.

## Build the submission package

From the repository root:

```bash
npm ci
npm run build
cd dist
zip -r ../mcplab-rover-firefox-v0.3.0.zip .
```

The ZIP must contain the extension files at its root, including `manifest.json`. Do not put the `dist/` directory itself inside the ZIP. The version in `dist/manifest.json` is set by the tag-driven build, so a release build from `v0.3.0` produces extension version `0.3.0`.

## Publish a public AMO listing

1. Create or sign in to a Mozilla account and open the [AMO Developer Hub](https://addons.mozilla.org/developers/).
2. Choose **Submit a new add-on** and select **On this site**.
3. Upload the ZIP produced from `dist/`.
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
  --source-dir dist \
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
