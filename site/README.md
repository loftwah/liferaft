# Liferaft website

The public site is static HTML and CSS. Preview the assets locally with
`python3 -m http.server 8912 --directory site/public`. The Worker uses the
existing Loftwah Cloudflare account and owns the exact
`liferaft.loftwah.com` custom domain. Workers.dev and version preview URLs are
disabled. Only the canonical HTTPS origin serves public assets.

From reviewed main, using the authenticated Wrangler 4.158.0 CLI:

```sh
wrangler deploy --config site/wrangler.jsonc --message "Liferaft site $(git rev-parse --short HEAD)"
wrangler deployments list --config site/wrangler.jsonc
```

To restore the preceding published Worker version, use
`wrangler rollback <version-id> --config site/wrangler.jsonc` and verify the
canonical page and its assets.

Keep download copy and structured data in sync with GitHub Releases. Application
captures use only the fictional recovery fixture. Woodhouse reads the current
social image from the site’s Open Graph metadata.
