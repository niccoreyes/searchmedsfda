PNF API — notes and usage

Summary
- Discovered endpoints used by the PNF site (https://pnf.doh.gov.ph):
  - GET https://pnf-api.doh.gov.ph/api/home
    - Query params: pnfSections, pnfCategories, therapeuticCategories, subTherapeuticCategories, pnfCare, reservedAmr, globalSearch
    - Returns search/list results (properties observed: drugGenerics, totalDrugs, drugGenericsCount, filterCount, etc.)
  - GET https://pnf-api.doh.gov.ph/api/pnf
    - Returns sidebar/filter data: pnfSections, pnfCategories, therapeuticCategories, subTherapeuticCategories, etc.
  - GET https://pnf-api.doh.gov.ph/api/drug/{id}
    - Returns detailed drug information (fields seen: id, name, atc_code, section.name, category, therapeuticCategory, subTherapeuticCategory, dosages[], indication, dosing, contraindication, precautions, adverse_drug_reaction, drug_interaction, administration, mechanism_of_action, pregnancy_category, remarks, ...)

Important notes
- The public frontend calls these endpoints, but direct requests from a browser or other origin may be blocked (403) by Cloudflare/CAPTCHA or by CORS depending on how requests are made.
- Recommended approach: perform requests server-side (server-to-server). A backend can set headers like Referer and a standard User-Agent, and will not be subject to browser CORS restrictions.
- If you intend to fetch many records, paginate or throttle requests and respect the server (respectful rate limit).

Quick curl example (may still get blocked by Cloudflare):

curl -v "https://pnf-api.doh.gov.ph/api/home?globalSearch=paracetamol" \
  -H "Referer: https://pnf.doh.gov.ph/" \
  -H "User-Agent: Mozilla/5.0"

Server-side recommendations
- Use Node/TypeScript or any backend to proxy or harvest the data.
- Add simple retries and exponential backoff for transient 403/5xx responses.
- Store results in JSON/CSV or a DB for downstream usage.

Included script
- `pnf-fetch.ts` — a Node/TypeScript script that:
  - Fetches sidebar data from `/api/pnf` (optional)
  - Queries `/api/home` with a search term (or empty) to list generics
  - Optionally fetches `/api/drug/{id}` for detailed information
  - Writes results to a JSON file

How to run
1. Install dependencies (the script uses axios):
   - npm install axios
   - or: pnpm add axios
2. Compile/run with ts-node or compile with tsc then run with node:
   - npx ts-node pnf-fetch.ts --search "paracetamol" --limit 20 --details --out paracetamol.json
   - or: node dist/pnf-fetch.js --search "paracetamol"

Caveats
- If the API returns 403 frequently, consider adding a short delay between requests, or run from a server with stable IP. Avoid excessive scraping.
- This documentation is an operations-level summary — rely on the script for a straightforward server-side approach.

Contact
- Created automatically as part of project tooling. Use responsibly and respect the PNF site terms of use.