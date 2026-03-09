# searchmeds

A lightweight, **client‑side web app** for exploring the Philippine FDA drug list and for composing simple prescriptions (Rx). It remains a single static HTML page (`index.html`) with the dataset embedded so the whole experience works offline and can be hosted directly on GitHub Pages or any static-file server.

Below is a quick look at the current UI – search results on the left, prescription builder on the right:

<table border="0">
  <tr>
    <td><img src="images/medication_search.png" alt="Medication search" width="400"></td>
    <td><img src="images/prescription.png" alt="Prescription builder" width="400"></td>
  </tr>
</table>


## Quickstart

> **Status:** this repo is currently a simple, static demo. The CSV data may not reflect the latest FDA listings; you can swap in a new dataset by rerunning the helper script described below.



Open `index.html` in a browser — or publish the repository to GitHub Pages to serve the page at `<username>.github.io/<repo>`.

## What `index.html` does

- `index.html` is the single-page UI for browsing and searching the PH FDA drug list and for composing a small prescription (Rx builder).
- The CSV drug data is embedded in the HTML inside a `<script id="csv-data">` block (see the placeholder comment `/* CSV_INJECT_HERE */` used during build). Embedding the CSV makes the page self-contained so it can be opened locally or hosted as a static page without a separate server.
- The page contains client-side JavaScript and CSS to parse and render the CSV, perform search/filter operations, and present a simple Rx composition UI.

If you want to update the CSV that powers the page, replace the CSV content inside the `index.html` script block or run the helper script described below.

## Important files

- `index.html` — Main static app. Contains the injected CSV under a `<script id="csv-data">` node and the UI for searching and building Rx.
- `ALL_DrugProducts.csv` — Original/downloaded CSV (if present). Can be used as the source of truth to update the embedded CSV inside `index.html`.
- `inject-csv.ts` — Utility TypeScript script that injects CSV content into `index.html` (the `/* CSV_INJECT_HERE */` placeholder). Use this to rebuild `index.html` with a new CSV.
- `pnf-fetch.ts` and `pnf-playwright-fetch.ts` — Scripts related to fetching product information (PNF). See `PNF_API.md` for notes about the PNF API and how these scripts are intended to be used.
- `PNF_API.md` — Documentation and notes about the PNF API used by the fetch scripts.
- `searchmeds.html` — A secondary or alternate HTML view (kept for experimentation or alternate UI).
- `package.json` / `bun.lock` — Project manifest and lockfile for Bun. Check `package.json` for available Bun scripts.
- `tsconfig.json` — TypeScript configuration for the helper scripts.

## Development notes

- This repo is intentionally small and client-side-first. The main interaction is purely in the browser with the embedded CSV; that keeps hosting simple (GitHub Pages, Netlify, etc.).
- If you add or update dependencies, use `bun add <pkg>` (e.g., `bun add axios`) and commit the changes.
- To refresh the embedded CSV, run the `inject-csv.ts` script (or manually copy the CSV contents into the `index.html` `<script id="csv-data">` block). If you need help running the TypeScript helper, transpile or run it with Bun:

```powershell
# example: run a TS helper with bun
bun run tsx inject-csv.ts
```

(adjust the command to the scripts defined in `package.json`)

## GitHub Pages

- Because `index.html` is fully self-contained (CSV embedded), you can publish the `main` branch to GitHub Pages (or use the `gh-pages` branch) and the page will work as a static site.
- After publishing, the site will be reachable at `https://<github-username>.github.io/<repo-name>/` (or the custom URL configured for the repo).

## Contributing

PRs that improve data parsing, search UX, accessibility, or add a build step to automate CSV updates are welcome. When opening a PR, describe how you tested the page locally (which browser, command used).

## License

Include license information here if you want to open-source the project (MIT, Apache-2.0, etc.).
