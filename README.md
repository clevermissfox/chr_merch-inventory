# CHR Merch Hub

Internal merch management tool for Cochise Harm Reduction. Manages product catalog, variants, inventory sync, and WooCommerce publishing from a Google Sheets source of truth.

---

## Stack

- **Frontend** — React Router v7 (SSR), TypeScript
- **Backend** — Express, Google Sheets API v4, Google Drive API v3, WooCommerce REST API
- **Auth** — Google OAuth2 + `express-session` (`chr-merch-session` cookie); Drive API checks the user's permission role on the spreadsheet to determine write access
- **Data** — Google Sheets (products_values, variants_values, inventory_index, merch_app_logs, bug_reports, ref tabs)
- **Legacy** — GAS (Google Apps Script) worker handles `action=inventory_sync_stock` webhook; the payload shape in this README reflects that contract

---

## Local Development

```bash
npm install

# Terminal 1 — backend (port 3001)
npm run backend

# Terminal 2 — frontend (port 5173)
npm run dev
```

Requires `backend/.env`:

```
SESSION_SECRET=
OAUTH_CLIENT_ID=
OAUTH_CLIENT_SECRET=
STAGING_SPREADSHEET_ID=
PRODUCTION_SPREADSHEET_ID=
VITE_API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
TARGET_ENV=staging          # or production
GCC_SERVICE_ACCOUNT_KEY_PATH=./backend/credentials/merch-gcc-service-account_key.json
WOO_STAGING_URL=
WOO_STAGING_KEY=
WOO_STAGING_SECRET=
WOO_PRODUCTION_URL=
WOO_PRODUCTION_KEY=
WOO_PRODUCTION_SECRET=
```

---

## Deployment

VPS — `staging.cochiseharmreduction.org` (staging) and `cochiseharmreduction.org` (production).

```bash
npm run build
# copy build/ + backend/ to server, restart PM2 process
```

`TARGET_ENV` controls which spreadsheet is used and which WooCommerce instance is hit.

**Before first deploy to a new sheet:** add the service account as an editor on the spreadsheet and set `SPREADSHEET_ID` to the correct sheet ID.

---

## Data Model

### Products sheet (`products_values`)

Top-level product row per SKU base. Key columns: `sku`, `product_id`, `category`, `subcategory`, `base_price_dollars`, `weight_oz`, `design`, `style_modifier`, `display_name`, `primary_description`, `short_description`, `dimensions_width`, `dimensions_height`, `dimensions_depth`, `published_status`, `woo_id`, `last_hash`, `last_synced_at`.

### Variants sheet (`variants_values`)

One row per variant SKU. Key columns: `select_product` (links to product_id), `sku`, `color`, `size`, `dimensions`, `design_variant`, `price_variant`, `weight_oz_variant`, `description_variant`, `row_id`.

### Ref tabs

- `colors_values`, `sizes_values`, `dimensions_values`, `graphics_variants_values`, `graphics_values`, `styles_values` — value + code pairs
- `categories_values`, `subcategories_values` — value + code + label + woo_id + `catLastProductNum` (persistent product-numbering counter, see below)

### Inventory index (`inventory_index`)

Tracks warehouse stock and WooCommerce stock per SKU. Updated by sync operations.

### Logging (`merch_app_logs`, `bug_reports`)

Every mutating endpoint writes a row to `merch_app_logs`: `[timestamp, actor_email, action, detail, TARGET_ENV]`. The in-app bug report form writes to `bug_reports`: `[timestamp, email, page, severity, what_happened, what_did_you_expect, what_had_you_done_before, screenshot_link, env]`.

---

## Inventory sync payload (for `action=inventory_sync_stock`)

```js
[
  { sku: "CHR-MER-0002-BLK-6X2", stock_qty: 50 }
]
```

---

## Publish state vocabulary

These four words get used precisely and shouldn't be mixed with synonyms ("live," "hidden," "offline," "take down") anywhere in code, UI copy, or docs:

| Term | Means |
|---|---|
| **Unpublished** | No `woo_id` at all — this product/variant has never been created in WooCommerce. Nothing to sync, nothing to conflict with. |
| **Draft** | Has a `woo_id` (it exists in WooCommerce) but its Woo status is currently `draft` — created/known there, but not visible to customers. |
| **Published** | Has a `woo_id` and its Woo status is `publish` — live and visible on the storefront. |
| **Sync** (verb) | Push current sheet content (name, description, price, sale price, category, subcategory, dimensions, variants) to WooCommerce. **Never** changes Published/Draft status by itself, regardless of which of the three states above currently applies. |
| **Publish / Unpublish** (verbs) | The explicit, deliberate action that flips Draft ⇄ Published. Always bundled with a content sync in the same action, but is a distinct decision from "sync" — see below. |

### Where each of these lives in the UI

- **Create Product** has no Published/Draft choice at all — every new product is created Unpublished (sheet-only, no WooCommerce call whatsoever), regardless of what content is filled in. There is no combined "create + publish" action anymore.
- **Edit Product** / **Edit Variant** have a single **"Sync changes"** button — always writes the sheet, then always pushes content to WooCommerce if a `woo_id` already exists (no-ops harmlessly if it doesn't). It **cannot** change Draft/Published status; there's no dropdown for it in either dialog. If there's no `woo_id` yet, "Sync changes" has nothing to push and is effectively sheet-only.
- **Add Variants** is likewise a single button — always saves, always also syncs if the parent already has a `woo_id`.
- **The product card's own button** — labeled **"Publish to site"** (no `woo_id` yet) or **"Publish status"** (`woo_id` exists) — is the *only* place Draft ⇄ Published actually changes. Clicking it always queries WooCommerce directly for the real current status first (never trusts the sheet's `published_status` alone, since that field can drift — e.g. someone manually unpublished in wp-admin). The resulting dialog then offers two explicit choices: **"Sync changes"** (push content, leave status exactly as it is) or the flip (**"Publish"**/**"Unpublish"**, push content and change status). Both choices always push content — the only difference is whether status also changes.
- **Sync All** checks every synced product's ground-truth Woo status in one batched call and separately warns about both drift directions before running: products the sheet says are Draft that Woo confirms are still Published (would be unpublished), and products the sheet says are Published that Woo confirms are actually Draft (would be republished, e.g. after a manual wp-admin unpublish).

### Why the sheet's `published_status` can't be trusted alone

`published_status` is only ever a *last known* value, not live truth — it can only be changed by Create (initial choice) or the card's own Publish/Unpublish action. Anyone editing directly in wp-admin, or a request that partially failed, can make it stale. That's why every status-changing action re-checks WooCommerce directly (`GET .../woo_status`) immediately before showing a confirm dialog, instead of ever assuming the sheet is correct.

---

## Key rules

- Every POST/DELETE endpoint and every sheet or WooCommerce write **must** call `writeSheetLog`.
- All ref values are lowercased and trimmed before writing to the sheet.
- Dimension codes use digits + X only (e.g. `6X2`); other ref codes are alpha only (A–Z).
- WooCommerce category `name` and `slug` are always lowercase.
- Category wooId `112` (CHR merch root) is the implicit parent for all categories — never shown as a user-selectable option.
- Variant dimension code is used for SKU building only. Physical dimensions (`dimensions_width`, `dimensions_height`, `dimensions_depth`) live on the parent product row.
- `product_id` is assigned from a persistent per-category counter (`catLastProductNum` named range, parallel to `catCode`) — read, incremented, and written back on every create. **Never** derived from currently-live rows and **never** touched by delete, so a number is never reused even after the product it belonged to is deleted. Any category with zero products yet can be left blank (reads as `0`).
- Deleting a product or variant **permanently deletes it from WooCommerce too** if it has a `woo_id` — true regardless of whether it's currently Draft or Published. No undo.

## Variant / WooCommerce attribute rules

Non-obvious, easy-to-forget behavior in how sheet variant data maps to WooCommerce attributes (`backend/wooSyncManager.ts`, mainly `computeGroupAttrPlan`/`buildVariantAttrs`/`buildWooParentPayload`):

- **Only Color, Size, and Design ever become WooCommerce variation attributes.** `dimensions` is **never** a selectable attribute/dropdown for any product — it only feeds (a) SKU generation and (b) the physical shipping `dimensions` field (length/width/height) on the product/variation payload. A product varying only by "3x5 vs 3x3" will never show a dimensions dropdown; that's expected, not a bug.
- **Sticker subcategory (`subcategoryCode === "STK"`) excludes Color and Size entirely**, unconditionally — only Design ever applies as an attribute for these products. This is intentional (confirmed present in the legacy GAS system too, not a regression) and needs to be deliberately chosen per-product via its subcategory.
- **SKU dimension/size precedence**: the sheet's SKU formula uses `dimensions` when set, falling back to `size` only when `dimensions` is empty — never both. The dupe-guard (`variantDupeKey` in `app/utils/variantKey.ts`) mirrors this exact precedence so two variants that would resolve to the same SKU get caught before submit.
- **Partial attribute** (some but not all variants have a value, e.g. only some colors have a Design set): gets an explicit `NO_ATTRIBUTE_VALUE` ("—") placeholder option so the variants without it still have something selectable, instead of Woo treating the omission as "matches any value" (which silently caused cross-variant attribute leakage before this was fixed).
- **Uniform attribute** (every variant shares the identical value, 2+ variants only): collapses to a non-selectable spec line (`variation: false`) instead of a pointless single-option dropdown. Explicitly **not** applied when there's only one variant total — collapsing there would strip `variation: true` from every attribute and break Add to Cart entirely (Woo can't generate the Variation object without at least one `variation: true` attribute).
- **`visible` is always sent as `true`**, regardless of `variation` — Woo defaults an omitted `visible` to `false`, which hides a collapsed (non-variation) attribute from the product page's spec/info section entirely instead of just removing its dropdown. In short: **"Visible on the product page"** = shows as a spec line; **"Used for variations"** = shows as a dropdown. Both can be true, or visible-only.
- **Single-variant products** get `default_attributes` set from that one variant's own values, so the storefront pre-selects instead of showing "Choose an option" dropdowns for a product that only ever has one real choice.
- **Deleting a variant does not automatically prune the parent's attribute list** — Woo's parent `attributes` are separate, explicit data that only get recomputed when a full parent sync runs. `delete_variant` now triggers exactly that (a fresh `syncProductGroupToWoo` call using the post-deletion rows) specifically to keep this from going stale, but any other code path that changes which rows exist needs to do the same or attributes will drift.
