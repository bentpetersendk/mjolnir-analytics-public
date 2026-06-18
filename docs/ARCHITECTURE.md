# Architecture

## Frontend architecture

- Plain HTML entry point.
- CSS design system in `css/styles.css`.
- ES module app shell in `js/app.js`.
- Single data access layer in `js/data-loader.js`.

## Data flow

1. The app starts in `js/app.js`.
2. `js/data-loader.js` loads the real export tree.
3. The loader falls back to `sample-data/` if needed.
4. The loader normalizes the data into one view model.
5. Pages render from that normalized object only.

## Chart architecture

- Charts are code-native SVG components.
- The same chart primitives are reused across pages.
- Future chart expansion should add helpers, not page-local one-offs.

## Future expansion strategy

- Keep raw JSON isolated from page code.
- Add new projections in the loader for project, group, and storage summaries.
- Preserve the current shell and extend the view model instead of redesigning the layout.
- Support the full historical archive by switching the loader source, not the page implementations.
