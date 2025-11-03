# BRF Svetsaren – Nyheter → RSS 2.0

Generates an RSS 2.0 feed from `https://www.hsb.se/stockholm/brf/svetsaren/nyheter/` and publishes it via GitHub Pages.

## Output

- Feed file: `docs/feed.xml`
- Published URL (after enabling Pages on `main`/`/docs`):
  - `https://<your-username>.github.io/<repo>/feed.xml`

## How it works

- `scripts/generate-rss.js` fetches and parses the news page using `cheerio`, then emits RSS using `rss`.
- A scheduled GitHub Actions workflow runs daily and on manual dispatch, committing changes to `docs/feed.xml` if the content changed.

## Local development

```bash
npm install
npm run generate
# open docs/feed.xml
```

## GitHub Actions

- Workflow: `.github/workflows/generate-rss.yml`
- Triggers:
  - `cron: 10 3 * * *` (daily)
  - `workflow_dispatch` (manual)

## Enable GitHub Pages

1. Go to repository Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `main` and folder: `/docs`
4. Save — your feed will be live at `https://<your-username>.github.io/<repo>/feed.xml`

## Notes

- The parser uses a resilient heuristic for titles and Swedish dates (e.g., `02 november 2025`). If HSB changes markup significantly, update `scripts/generate-rss.js` selectors/logic.
- Source: [`https://www.hsb.se/stockholm/brf/svetsaren/nyheter/`](https://www.hsb.se/stockholm/brf/svetsaren/nyheter/)


