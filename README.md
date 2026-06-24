# CHR Merch Hub

Internal merch management tool for Cochise Harm Reduction. Manages product catalog, variants, inventory sync, and WooCommerce publishing from a Google Sheets source of truth.

---

## Stack

- **Frontend** — React Router v7 (SSR), TypeScript
- **Backend** — Express, Google Sheets API v4, Google Drive API v3, WooCommerce REST API
- **Auth** — Google OAuth2 + `express-session` (`chr-merch-session` cookie); Drive API checks the user's permission role on the spreadsheet to determine write access
- **Data** — Google Sheets (products_values, variants_values, inventory_index, merch_app_logs, ref tabs)
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

Top-level product row per SKU base. Key columns: `sku`, `product_id`, `category`, `subcategory`, `base_price_dollars`, `weight_oz`, `design`, `style_modifier`, `display_name`, `primary_description`, `short_description`, `dimensions_width`, `dimensions_height`, `dimensions_depth`, `woo_id`, `last_hash`, `last_synced_at`.

### Variants sheet (`variants_values`)

One row per variant SKU. Key columns: `select_product` (links to product_id), `sku`, `color`, `size`, `dimensions`, `design_variant`, `price_variant`, `weight_oz_variant`, `description_variant`, `row_id`.

### Ref tabs

- `colors_values`, `sizes_values`, `dimensions_values`, `graphics_variants_values`, `graphics_values`, `styles_values` — value + code pairs
- `categories_values`, `subcategories_values` — value + code + label + woo_id

### Inventory index (`inventory_index`)

Tracks warehouse stock and WooCommerce stock per SKU. Updated by sync operations.

### Logging (`merch_app_logs`)

Every mutating endpoint writes a row: `[timestamp, actor_email, action, detail, TARGET_ENV]`.

---

## Inventory sync payload (for `action=inventory_sync_stock`)

```js
[
  { sku: "CHR-MER-0002-BLK-6X2", stock_qty: 50 }
]
```

---

## Key rules

- Every POST/DELETE endpoint and every sheet or WooCommerce write **must** call `writeSheetLog`.
- All ref values are lowercased and trimmed before writing to the sheet.
- Dimension codes use digits + X only (e.g. `6X2`); other ref codes are alpha only (A–Z).
- WooCommerce category `name` and `slug` are always lowercase.
- Category wooId `112` (CHR merch root) is the implicit parent for all categories — never shown as a user-selectable option.
- Variant dimension code is used for SKU building only. Physical dimensions (`dimensions_width`, `dimensions_height`, `dimensions_depth`) live on the parent product row.
