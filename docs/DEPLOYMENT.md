# Deployment

## GitHub Pages

- Enabled through the same static site pipeline when the real export is published with the repo.
- If enabled later, build the site as a static artifact and publish from a branch or GitHub Actions workflow.

## Nginx deployment

- Serve the repository as a static site root.
- Set cache headers for CSS and JavaScript.
- Keep the JSON data tree on the same origin so `fetch()` continues to work.

## Static hosting deployment

- Any static host that supports same-origin assets will work.
- Preserve the directory structure so `js/data-loader.js` can fetch the mirrored export and fallback data.
- Avoid rewriting the JSON paths unless the loader is updated at the same time.

## Operational note

Do not publish automatically until privacy, performance, and UX reviews are accepted.

## Private Deployment Mode

- Internal deployments can inject `window.__MJOLNIR_PRIVATE_DATA_BASE__` before `js/app.js` loads.
- When set, the loader uses that private base instead of the public `data/efficiency_v3/site_data_90d_validation/` path.
- Keep the private export tree outside the public repository and point the base at a protected internal host or mount.
