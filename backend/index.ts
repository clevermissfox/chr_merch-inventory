import express from "express";
import { type Request, type Response } from "express";
import { google } from "googleapis";
import * as dotenv from "dotenv";
import path from "path";
import session from "express-session";
import cors from "cors";
import type {
  CatalogGroup,
  CatalogPayload,
  ProductSheetRow,
  VariantSheetRow,
} from "~/types/catalog";
import type { AuthUser } from "~/types/user";
import {
  appendCategoryEntry,
  appendRefEntry,
  buildConflictGroups,
  buildVariantCombos,
  CODED_REF_TYPES,
  computeProductSyncHash,
  createProductRow,
  createVariantRows,
  createWooCategory,
  deleteProduct,
  deleteVariant,
  ensureCategoryWooId,
  ensureDescriptionRowsExist,
  ensureDimensionExists,
  parseCreateVariantsBody,
  parseNewProductFields,
  parseUpdateProductFields,
  parseUpdateVariantFields,
  updateDescriptionFields,
  pollForProductSku,
  readRefData,
  rowsToObjects,
  shapeToCatalogPayload,
  updateProduct,
  updateVariant,
  VALID_REF_TYPES,
  writeProductSyncHashes,
  writeProductWooId,
  writeVariantImageUrl,
  writeSheetLog,
} from "./catalogManager";
import type { RefAddType, UpdateProductFields } from "./catalogManager";
import { DupeSkuError } from "./catalogManager";
import { syncCatalogGroupsToWoo, deleteProductFromWoo, deleteVariationFromWoo, convertWooProductToSimple } from "./wooSyncManager";
import { sendImageNotification } from "./mailer";

import {
  applyWooStockMapToCatalogGroups,
  buildCatalogNameBySku,
  buildStockSyncChangesFromCatalog,
  buildStockSyncPlan,
  ensureInventoryIndexRowsExist,
  ensureSkuInInventoryIndex,
  loadInventoryIndexState,
  refreshWooStockForCatalog,
  syncStockSyncPlanToWoo,
  upsertInventoryIndexFields,
} from "./inventoryManager";

dotenv.config({ path: "./backend/.env" });

declare module "express-session" {
  interface SessionData {
    user: AuthUser;
    redirect?: string | null;
  }
}

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const API_URL = process.env.VITE_API_URL || `http://localhost:${PORT}`;
const TARGET_ENV = process.env.TARGET_ENV || "unknown";
const manualGuardProducts = false;
const guardProducts = TARGET_ENV === "production" ? true : manualGuardProducts;

// Add CORS middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(
  session({
    name: "chr-merch-session",
    secret: process.env.SESSION_SECRET || "not_a_session_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

// Helper to get spreadsheet ID
// staging uses staging sheet; production and development both use production sheet
function getSpreadsheetId(): string {
  return TARGET_ENV === "staging"
    ? process.env.STAGING_SPREADSHEET_ID || ""
    : process.env.PRODUCTION_SPREADSHEET_ID || "";
}

function getSheets() {
  const sheets = google.sheets({ version: "v4", auth: serviceAuth });
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error("Missing spreadsheet ID env var");
  return { sheets, spreadsheetId };
}

// Check spreadsheet access
async function checkSpreadsheetAccess(
  userEmail: string,
): Promise<{ canEdit: boolean; role: string }> {
  try {
    const drive = google.drive({ version: "v3", auth: serviceAuth });
    const spreadsheetId = getSpreadsheetId();

    const permissions = await drive.permissions.list({
      fileId: spreadsheetId,
      supportsAllDrives: true, // 👈 CRITICAL: Allows reading emails and Shared Drive permissions
      useDomainAdminAccess: false,
      fields: "nextPageToken, permissions(id, type, emailAddress, role)", // 👈 Added standard list tokens
    });

    //  Log the whole array to see exactly what Google is sending back
    // console.log(
    //   "All retrieved permissions:",
    //   JSON.stringify(permissions.data.permissions, null, 2),
    // );

    const userPermission = permissions.data.permissions?.find(
      (p) => p.emailAddress?.toLowerCase() === userEmail.toLowerCase(),
    );

    console.log("user email", userEmail, "has role", userPermission?.role);

    if (!userPermission) {
      return { canEdit: false, role: "none" };
    }

    const canEdit =
      userPermission.role === "writer" || userPermission.role === "owner";

    return { canEdit, role: canEdit ? "editor" : "reader" };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error checking spreadsheet access:", errorMessage);
    return { canEdit: false, role: "none" };
  }
}

// Auth middleware - cast req to have session
function requireAuth(req: Request, res: Response, next: any) {
  if (!req.session || !req.session.user) {
    return res.json({ success: false, error: "AUTH_REQUIRED", canEdit: false });
  }
  next();
}

function requireCanEdit(req: Request, res: Response, next: any) {
  if (!req.session?.user?.canEdit) {
    return res
      .status(403)
      .json({ ok: false, error: "Edit permission required" });
  }
  next();
}

// Best-effort error logger — wraps getSheets() so it won't throw if sheets are unavailable
function tryLogError(req: Request, action: string, error: any) {
  try {
    const { sheets, spreadsheetId } = getSheets();
    writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
      new Date().toISOString(),
      req.session?.user?.email ?? "",
      `error_${action}`,
      String(error?.message ?? "unknown"),
      TARGET_ENV,
    ]).catch(() => {});
  } catch {}
}

// Load service account
const serviceAccountKeyPath = path.join(
  process.cwd(),
  process.env.GCC_SERVICE_ACCOUNT_KEY_PATH ||
    "./backend/credentials/merch-gcc-service-account_key.json",
);

const serviceAuth = new google.auth.GoogleAuth({
  keyFile: serviceAccountKeyPath,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
});

// OAuth login endpoint
app.get("/api/auth/google", async (req: Request, res: Response) => {
  try {
    // console.log("Full query from login:", req.query);
    console.log("redirect param from login:", req.query.redirect);

    if (!req.session) {
      return res.json({ success: false, error: "SESSION_NOT_AVAILABLE" });
    }

    const redirectUrl = (req.query.redirect as string) || "/";

    if (req.session.redirect) {
      delete req.session.redirect;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENT_ID,
      process.env.OAUTH_CLIENT_SECRET,
      process.env.NODE_ENV === "production"
        ? `${process.env.PRODUCTION_APP_URL}/api/auth/google/callback`
        : `${API_URL}/api/auth/google/callback`,
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["email", "profile"],
      state: redirectUrl,
    });

    res.json({ success: true, authUrl });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.json({ success: false, error: errorMessage });
  }
});

// OAuth callback endpoint
app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
  try {
    // console.log("Full query from callback:", req.query);

    if (!req.session) {
      return res.json({ success: false, error: "SESSION_NOT_AVAILABLE" });
    }

    const redirectUrl = req.query.state || "/";

    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENT_ID,
      process.env.OAUTH_CLIENT_SECRET,
      process.env.NODE_ENV === "production"
        ? `${process.env.PRODUCTION_APP_URL}/api/auth/google/callback`
        : `${API_URL}/api/auth/google/callback`,
    );

    const { tokens } = await oauth2Client.getToken(req.query.code as string);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const email = userInfo.data.email;
    if (!email) {
      return res.json({ success: false, error: "EMAIL_NOT_FOUND" });
    }
    const access = await checkSpreadsheetAccess(email);

    if (!req.session) {
      return res.json({ success: false, error: "SESSION_NOT_AVAILABLE" });
    }

    req.session.user = {
      id: userInfo.data.id || "",
      name: userInfo.data.name || "Guest",
      givenName: userInfo.data.given_name || "Guest",
      familyName: userInfo.data.family_name || "",
      picture: userInfo.data.picture ?? undefined,
      email: email,
      canEdit: access.canEdit,
      role: access.role,
    };

    req.session.save((err) => {
      if (err) {
        return res.json({ success: false, error: "SESSION_SAVE_FAILED" });
      }

      const { sheets, spreadsheetId } = getSheets();
      const user = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "sessions", [
        new Date().toISOString(),
        user.email,
        user.name ?? "",
        user.role ?? "",
        "login",
        TARGET_ENV,
      ]).catch((e) => console.error("session log failed:", e));

      res.redirect(
        TARGET_ENV === "production"
          ? `${process.env.PRODUCTION_APP_URL}${redirectUrl}`
          : `${FRONTEND_URL}${redirectUrl}`,
      );
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.json({ success: false, error: errorMessage });
  }
});

// Logout
app.post("/api/auth/logout", (req: Request, res: Response) => {
  const user = req.session?.user;
  req.session.destroy(() => {
    if (user) {
      const { sheets, spreadsheetId } = getSheets();
      writeSheetLog(sheets, spreadsheetId, "sessions", [
        new Date().toISOString(),
        user.email,
        user.name ?? "",
        user.role ?? "",
        "logout",
        TARGET_ENV,
      ]).catch((e) => console.error("session log failed:", e));
    }
    res.json({ success: true });
  });
});

// Check auth status
app.get("/api/auth/status", (req: Request, res: Response) => {
  if (!req.session || !req.session.user) {
    return res.json({ success: true, user: null, canEdit: false });
  }
  res.json({
    success: true,
    user: req.session.user,
  });
});

// Lightweight catalog load — sheets only, no Woo calls
// products_values/variants_values derive stock_qty via a formula reading
// inventory_index — Sheets doesn't guarantee that formula has recalculated
// by the time a request reads it, especially moments after another request
// just wrote a new value there (the read-after-write race isn't even limited
// to formula recalculation — a fresh read immediately following a separate
// request's write isn't guaranteed visible at all). Patches every row's
// stockQty from a direct inventory_index read instead of trusting any
// formula-derived or previously-cached value, and recomputes contentUnsynced
// from that, so the result can't disagree with what's actually on the sheet.
async function patchGroupsWithConfirmedStock(
  sheets: any,
  spreadsheetId: string,
  groups: CatalogGroup[],
): Promise<CatalogGroup[]> {
  const invIndexState = await loadInventoryIndexState(sheets, spreadsheetId);
  const stockQtyCol = invIndexState.headerIndex["stock_qty"];
  const confirmedStockBySku = new Map<string, number | null>();
  if (stockQtyCol != null) {
    for (let i = 1; i < invIndexState.rawValues.length; i++) {
      const row = invIndexState.rawValues[i];
      const sku = String(row[invIndexState.headerIndex.sku] ?? "").trim();
      if (!sku) continue;
      const raw = row[stockQtyCol];
      const qty = raw === "" || raw == null ? null : Number(raw);
      confirmedStockBySku.set(sku, Number.isNaN(qty as number) ? null : qty);
    }
  }

  return groups.map((group) => {
    const patchedGroup = confirmedStockBySku.has(group.sku)
      ? { ...group, stockQty: confirmedStockBySku.get(group.sku) ?? null }
      : group;
    const patchedRows = patchedGroup.rows.map((row) =>
      confirmedStockBySku.has(row.sku)
        ? { ...row, stockQty: confirmedStockBySku.get(row.sku) ?? null }
        : row,
    );
    return { ...patchedGroup, rows: patchedRows };
  });
}

// Pure (no I/O) — recomputes each group's contentUnsynced flag from its
// current in-memory state. Callers that just wrote a new last_hash should
// patch group.lastHash in memory first (no need to re-read it back).
function computeContentUnsyncedFlags(groups: CatalogGroup[]): {
  groups: CatalogGroup[];
  contentUnsyncedCount: number;
} {
  let contentUnsyncedCount = 0;
  for (const group of groups) {
    const unsynced =
      !!group.wooId &&
      !!group.lastHash &&
      computeProductSyncHash(group) !== group.lastHash;
    group.contentUnsynced = unsynced;
    if (unsynced) contentUnsyncedCount++;
  }
  return { groups, contentUnsyncedCount };
}

async function reconcileGroupsWithInventoryIndex(
  sheets: any,
  spreadsheetId: string,
  groups: CatalogGroup[],
): Promise<{ groups: CatalogGroup[]; contentUnsyncedCount: number }> {
  const patched = await patchGroupsWithConfirmedStock(sheets, spreadsheetId, groups);
  return computeContentUnsyncedFlags(patched);
}

app.get("/api/catalog", async (req: Request, res: Response) => {
  try {
    const { sheets, spreadsheetId } = getSheets();

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: ["products_values", "variants_values"],
    });

    const valueRanges = response.data.valueRanges ?? [];
    const productRows = rowsToObjects<ProductSheetRow>(
      valueRanges[0]?.values ?? [],
    );
    const variantRows = rowsToObjects<VariantSheetRow>(
      valueRanges[1]?.values ?? [],
    );

    const wooSiteUrl =
      TARGET_ENV === "production"
        ? process.env.WOO_PRODUCTION_URL
        : process.env.WOO_STAGING_URL;

    const shaped = shapeToCatalogPayload(productRows, variantRows);
    const { groups: confirmedGroups, contentUnsyncedCount } =
      await reconcileGroupsWithInventoryIndex(
        sheets,
        spreadsheetId,
        shaped.groups,
      );

    const payload: CatalogPayload = {
      ...shaped,
      generatedAt: new Date().toISOString(),
      groups: confirmedGroups,
      summary: {
        ...shaped.summary,
        contentUnsyncedCount,
        wooSiteUrl: wooSiteUrl ?? undefined,
        devEmail: process.env.DEV_EMAIL ?? undefined,
      },
    };

    return res.json(payload);
  } catch (error: any) {
    console.error("GET /api/catalog failed:", error);
    return res
      .status(500)
      .json({ ok: false, error: error?.message || "Failed to load catalog" });
  }
});

// Get all products/variants, shape to catalog, call woo for current website stock values, write those to inventory_index, patch update catalogs woo_stock
app.get(
  "/api/catalog/inventory/get_stock",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { sheets, spreadsheetId } = getSheets();

      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["products_values", "variants_values"],
      });

      const valueRanges = response.data.valueRanges ?? [];

      const productRows = rowsToObjects<ProductSheetRow>(
        valueRanges[0]?.values ?? [],
      );

      const variantRows = rowsToObjects<VariantSheetRow>(
        valueRanges[1]?.values ?? [],
      );

      let payload: CatalogPayload = shapeToCatalogPayload(
        productRows,
        variantRows,
      );

      // Self-heal: make sure every known SKU (product + variant) has a row
      // in descriptions and inventory_index, regardless of how it might
      // have gone missing (e.g. a create_product request that wrote its
      // product row but died before reaching the rest of the chain). Runs
      // on every inventory page load — cheap when nothing's actually
      // missing, since each is one read + a batched append only for gaps.
      const allCatalogSkus = payload.groups.flatMap((g) => [
        g.sku,
        ...g.rows.map((r) => r.sku),
      ]);
      await ensureDescriptionRowsExist(sheets, spreadsheetId, allCatalogSkus).catch(
        (e) => tryLogError(req, "get_stock_description_audit", e),
      );
      await loadInventoryIndexState(sheets, spreadsheetId)
        .then(async (invAuditState) => {
          const catalogNameBySku = buildCatalogNameBySku(payload.groups);
          const ensuredState = await ensureInventoryIndexRowsExist(
            sheets,
            spreadsheetId,
            invAuditState,
            allCatalogSkus.map((sku) => ({ sku, fields: {} })),
            catalogNameBySku,
          );

          // Repair pass: ensureInventoryIndexRowsExist only names rows it
          // creates — it never touches rows that already existed with a
          // blank product_name (e.g. from before this self-heal name
          // plumbing existed, or a row created by another path that didn't
          // pass a real name). Backfill those now that we know real names.
          const nameCol = ensuredState.headerIndex["product_name"];
          if (nameCol != null) {
            const blankNameUpdates = allCatalogSkus.flatMap((sku) => {
              const rowNumber = ensuredState.skuToRowNumber.get(sku);
              if (rowNumber == null) return [];
              const row = ensuredState.rawValues[rowNumber - 1];
              const currentName = String(row?.[nameCol] ?? "").trim();
              const knownName = catalogNameBySku.get(sku);
              if (currentName || !knownName) return [];
              return [{ sku, fields: { product_name: knownName } }];
            });
            if (blankNameUpdates.length) {
              await upsertInventoryIndexFields(
                sheets,
                spreadsheetId,
                blankNameUpdates,
                catalogNameBySku,
              );
            }
          }
        })
        .catch((e) => tryLogError(req, "get_stock_inventory_index_audit", e));

      const refreshResult = await refreshWooStockForCatalog(
        sheets,
        spreadsheetId,
        payload.groups,
      );

      const wooPatched = applyWooStockMapToCatalogGroups(
        payload.groups,
        refreshResult.wooQtyBySku,
      );

      // contentUnsynced was computed inside shapeToCatalogPayload's initial
      // call above, using that request's very first (possibly-stale) sheet
      // read — reconcile against inventory_index directly so it can't
      // disagree with what's actually on screen.
      const { groups: updatedGroups, contentUnsyncedCount } =
        await reconcileGroupsWithInventoryIndex(
          sheets,
          spreadsheetId,
          wooPatched,
        );

      const wooSiteUrl =
        TARGET_ENV === "production"
          ? process.env.WOO_PRODUCTION_URL
          : process.env.WOO_STAGING_URL;

      payload = {
        ...payload,
        generatedAt: new Date().toISOString(),
        groups: updatedGroups,
        summary: {
          ...payload.summary,
          contentUnsyncedCount,
          conflictGroups: buildConflictGroups(updatedGroups),
          wooSiteUrl: wooSiteUrl ?? undefined,
          devEmail: process.env.DEV_EMAIL ?? undefined,
          unsyncedCount: updatedGroups.reduce(
            (total, group) =>
              total +
              group.rows.filter((row) => row.stockQty !== row.wooStock).length,
            0,
          ),
        },
      };

      const actor = req.session?.user;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor?.email ?? "",
        "inventory_get_stock",
        `groups=${payload.groups.length} skus=${payload.summary.rowCount} unsynced=${payload.summary.unsyncedCount}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json(payload);
    } catch (error: any) {
      console.error("GET /api/catalog/inventory/get_stock failed:", error);
      tryLogError(req, "inventory_get_stock", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to refresh catalog inventory",
      });
    }
  },
);

/**
 * Syncs stock to WooCommerce using the client-provided catalog snapshot.
 * Confirms current Woo stock for touched SKUs, writes inventory_index updates,
 * and returns sync details for testing the new stock workflow.
 */
app.post(
  "/api/catalog/inventory/sync_stock",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    try {
      const { sheets, spreadsheetId } = getSheets();

      const catalog = req.body?.catalog as CatalogPayload | undefined;
      const mode = String(req.body?.mode || "standard_sync") as
        | "standard_sync"
        | "resolve_conflicts"
        | "sync_all";
      const dirtyBySku = (req.body?.dirtyBySku || {}) as Record<
        string,
        { sku: string; stockQty: number | ""; originalStockQty?: number | null }
      >;

      if (!catalog || !Array.isArray(catalog.groups)) {
        return res.status(400).json({
          ok: false,
          error: "Missing catalog.groups in request body",
        });
      }

      const changes = buildStockSyncChangesFromCatalog(
        catalog,
        dirtyBySku,
        mode,
      );

      if (!changes.length) {
        return res.status(200).json({
          ok: true,
          updatedProducts: 0,
          updatedSkus: [],
          skipped: [],
          inventoryIndexUpdated: 0,
        });
      }

      const plan = buildStockSyncPlan(catalog.groups, changes);
      const wooResult = await syncStockSyncPlanToWoo(plan);

      const refreshResult = await refreshWooStockForCatalog(
        sheets,
        spreadsheetId,
        catalog.groups,
        {
          // Use all dirty SKUs (not just Woo-pushed) so draft/unpublished products
          // still get their stock_qty written to the sheet even if Woo was skipped.
          touchedSkus: new Set(plan.changeMap.keys()),
          stockQtyBySku: plan.changeMap,
        },
      );

      // computeProductSyncHash includes stock_qty, so it must be recomputed
      // from the post-sync catalog state (inventory_index already updated
      // above) or contentUnsynced will falsely trip on next load. Reshape
      // fresh from the sheet rather than reuse the client-submitted
      // `catalog.groups` (a snapshot from whenever the frontend last
      // loaded), and patch stock from a direct inventory_index read rather
      // than the formula-derived stock_qty column, which isn't guaranteed
      // to have recalculated yet.
      const freshResponse = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["products_values", "variants_values"],
      });
      const freshValueRanges = freshResponse.data.valueRanges ?? [];
      const freshProductRows = rowsToObjects<ProductSheetRow>(
        freshValueRanges[0]?.values ?? [],
      );
      const freshVariantRows = rowsToObjects<VariantSheetRow>(
        freshValueRanges[1]?.values ?? [],
      );
      const { groups: freshGroups, summary: freshSummary } = shapeToCatalogPayload(
        freshProductRows,
        freshVariantRows,
      );
      const stockPatchedGroups = await patchGroupsWithConfirmedStock(
        sheets,
        spreadsheetId,
        freshGroups,
      );

      const pushedSkuSet = new Set(wooResult.updatedSkus);
      const hashEntries = stockPatchedGroups
        .filter(
          (g) =>
            (g.sku && pushedSkuSet.has(g.sku)) ||
            g.rows.some((r) => pushedSkuSet.has(r.sku)),
        )
        .map((g) => ({ sku: g.sku, hash: computeProductSyncHash(g) }));

      const actor = req.session?.user;

      if (hashEntries.length) {
        // Must be awaited, not fire-and-forget — the frontend uses this
        // request's own response as the confirmed catalog state (see below),
        // so the hash has to actually be on the sheet before we read
        // last_hash back into that response.
        try {
          await writeProductSyncHashes(sheets, spreadsheetId, hashEntries);
        } catch (e: any) {
          console.error("hash write failed:", e);
          writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
            new Date().toISOString(),
            actor?.email ?? "",
            "inventory_sync_hash_write_failed",
            `skus=${hashEntries.map((h) => h.sku).join(",")} error=${String(e?.message ?? "unknown")}`,
            TARGET_ENV,
          ]).catch(() => {});
        }
      }

      // Patch the just-written hash into the in-memory groups directly
      // rather than reading last_hash back from the sheet — same principle
      // as the stock patch above, applied to the value we just confirmed.
      const hashBySku = new Map(hashEntries.map((h) => [h.sku, h.hash]));
      for (const group of stockPatchedGroups) {
        const newHash = hashBySku.get(group.sku);
        if (newHash) group.lastHash = newHash;
      }
      const { groups: confirmedGroups, contentUnsyncedCount } =
        computeContentUnsyncedFlags(stockPatchedGroups);

      const skuQtyLog = wooResult.updatedSkus
        .map((sku) => {
          const reqQty = plan.changeMap.get(sku);
          const wooQty = refreshResult.wooQtyBySku.get(sku);
          return `${sku}(req=${String(reqQty ?? "?")},woo=${String(wooQty ?? "?")})`;
        })
        .join("|");

      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor?.email ?? "",
        `inventory_sync_stock_${mode}`,
        `pushed=${wooResult.updatedProducts} skus=${skuQtyLog || wooResult.updatedSkus.join(",")} skipped=${wooResult.skipped.length} index_updated=${refreshResult.updated}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      const wooSiteUrl =
        TARGET_ENV === "production"
          ? process.env.WOO_PRODUCTION_URL
          : process.env.WOO_STAGING_URL;

      // Return the fully-confirmed catalog directly in this response — the
      // frontend uses it to update state instead of issuing a separate
      // follow-up GET, which would otherwise race this same read-after-write
      // problem all over again from a different request.
      const confirmedCatalog: CatalogPayload = {
        generatedAt: new Date().toISOString(),
        ok: true,
        groups: confirmedGroups,
        summary: {
          ...freshSummary,
          contentUnsyncedCount,
          wooSiteUrl: wooSiteUrl ?? undefined,
          devEmail: process.env.DEV_EMAIL ?? undefined,
        },
      };

      return res.status(200).json({
        ok: true,
        updatedProducts: wooResult.updatedProducts,
        updatedSkus: wooResult.updatedSkus,
        skipped: wooResult.skipped,
        inventoryIndexUpdated: refreshResult.updated,
        simpleCount: refreshResult.simpleCount,
        variationCount: refreshResult.variationCount,
        catalog: confirmedCatalog,
      });
    } catch (error: any) {
      console.error("POST /api/catalog/inventory/sync_stock failed:", error);
      tryLogError(req, "inventory_sync_stock", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to sync stock",
      });
    }
  },
);
app.get("/api/catalog/get_meta", async (req: Request, res: Response) => {
  try {
    const { sheets, spreadsheetId } = getSheets();
    const refData = await readRefData(sheets, spreadsheetId);
    return res.status(200).json({ ok: true, ...refData });
  } catch (error: any) {
    console.error("GET /api/catalog/get_meta failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Failed to load reference data",
    });
  }
});

app.post(
  "/api/catalog/ref/add",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    try {
      const { type, value, code, label, parentWooId, parentCode } = req.body as {
        type?: string;
        value?: string;
        code?: string;
        label?: string;
        parentWooId?: number;
        parentCode?: string;
      };

      if (!value?.trim()) {
        return res.status(400).json({ ok: false, error: "Value is required" });
      }

      if (CODED_REF_TYPES.has(type ?? "") && !code?.trim()) {
        return res.status(400).json({ ok: false, error: "Code is required" });
      }
      const safeCode = code?.trim() ?? "";

      const { sheets, spreadsheetId } = getSheets();

      const actor = req.session?.user;
      const actorEmail = actor?.email ?? "unknown";

      if (type === "category" || type === "subcategory") {
        if (type === "subcategory" && !parentCode?.trim()) {
          return res.status(400).json({
            ok: false,
            error: "parentCode is required for subcategory",
          });
        }
        // value is the slug-like internal identifier — symbols stripped entirely
        // (no space substitution, e.g. "S-Shirt" -> "sshirt"); the human-readable
        // form with symbols/casing lives in `label` (subcategory only) or is
        // reconstructed for display elsewhere.
        const normalizedValue = value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "");
        // label is the sheet display name for subcategories (user-provided, may include capitals/symbols)
        // Woo name + slug are always the lowercase normalizedValue
        const sheetLabel = label?.trim() || normalizedValue;
        const display = type === "category" ? "default" : "subcategories";

        // Parent category may not have a Woo ID yet (never synced, or stale
        // after a staging recopy) — create it in Woo and backfill the sheet
        // rather than blocking subcategory creation on it.
        const resolvedParentWooId =
          type === "subcategory"
            ? (parentWooId ??
              (await ensureCategoryWooId(
                sheets,
                spreadsheetId,
                parentCode!.trim(),
              )))
            : null;

        const wooId = await createWooCategory(
          normalizedValue,
          resolvedParentWooId,
          display,
        );
        await appendCategoryEntry(
          sheets,
          spreadsheetId,
          type,
          normalizedValue,
          safeCode,
          wooId,
          sheetLabel,
          type === "subcategory" ? parentCode!.trim() : undefined,
        );
        writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
          new Date().toISOString(),
          actorEmail,
          `ref_add_${type}`,
          `value=${normalizedValue} label=${sheetLabel} code=${safeCode.toUpperCase()} wooId=${wooId}${type === "subcategory" ? ` parentWooId=${resolvedParentWooId} parentCode=${parentCode!.trim().toUpperCase()}` : ""}`,
          TARGET_ENV,
        ]).catch((e) => console.error("log failed:", e));
        return res.status(200).json({
          ok: true,
          value: normalizedValue,
          code: safeCode.toUpperCase(),
          wooId,
          label: sheetLabel,
          parentCode: type === "subcategory" ? parentCode!.trim().toUpperCase() : undefined,
        });
      }

      if (!VALID_REF_TYPES.has(type as RefAddType)) {
        return res.status(400).json({ ok: false, error: "Invalid ref type" });
      }
      const entry = await appendRefEntry(
        sheets,
        spreadsheetId,
        type as RefAddType,
        value.trim().toLowerCase(),
        code?.trim(),
      );
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actorEmail,
        `ref_add_${type}`,
        `value=${entry.value} code=${entry.code ?? ""}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));
      return res.status(200).json({ ok: true, ...entry });
    } catch (error: any) {
      console.error("POST /api/catalog/ref/add failed:", error);
      return res.status(400).json({
        ok: false,
        error: error?.message || "Failed to add ref entry",
      });
    }
  },
);

app.post(
  "/api/catalog/create_product",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    if (guardProducts)
      return res.status(503).json({
        ok: false,
        error:
          "Product management is still in progress - inventory changes only for now",
      });
    try {
      const parsed = parseNewProductFields(req.body);
      if ("error" in parsed)
        return res.status(400).json({ ok: false, error: parsed.error });
      const fields = parsed;

      const { sheets, spreadsheetId } = getSheets();
      const { sheetRow, rowId } = await createProductRow(
        sheets,
        spreadsheetId,
        fields,
      );

      if (fields.dimensionsWidth && fields.dimensionsHeight) {
        const w = fields.dimensionsWidth.trim();
        const h = fields.dimensionsHeight.trim();
        await ensureDimensionExists(
          sheets,
          spreadsheetId,
          `${w}"x${h}"`,
          `${w}x${h}`,
        ).catch((e) =>
          console.warn(
            "create_product: could not ensure dimension:",
            e?.message,
          ),
        );
      }

      const { productId, sku } = await pollForProductSku(
        sheets,
        spreadsheetId,
        sheetRow,
      );
      await updateDescriptionFields(sheets, spreadsheetId, sku, {
        primaryDescription: fields.primaryDescription,
        shortDescription: fields.shortDescription,
      });

      // Add the new product to inventory_index immediately so it appears
      // without waiting for a stock sync (draft products never get a Woo row).
      await ensureSkuInInventoryIndex(
        sheets,
        spreadsheetId,
        sku,
        fields.displayName || sku,
      ).catch((e) =>
        console.warn(
          "create_product: could not add to inventory_index:",
          e?.message,
        ),
      );

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "create_product",
        `sku=${sku} product_id=${productId} row_id=${rowId}`,
        TARGET_ENV,
      ]).catch((e) => console.error("action log failed:", e));

      return res
        .status(200)
        .json({ ok: true, productId, sku, rowId, sheetRow });
    } catch (error: any) {
      console.error("POST /api/catalog/create_product failed:", error);
      tryLogError(req, "create_product", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to create product",
      });
    }
  },
);

app.put(
  "/api/catalog/product/:sku",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    if (guardProducts)
      return res.status(503).json({
        ok: false,
        error:
          "Product management is still in progress - inventory changes only for now",
      });
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const fields = parseUpdateProductFields(
        req.body as Partial<UpdateProductFields>,
      );

      if (!Object.keys(fields).length)
        return res
          .status(400)
          .json({ ok: false, error: "No updatable fields provided" });

      const { sheets, spreadsheetId } = getSheets();
      await updateProduct(sheets, spreadsheetId, sku, fields);

      if (fields.dimensionsWidth && fields.dimensionsHeight) {
        const w = fields.dimensionsWidth.trim();
        const h = fields.dimensionsHeight.trim();
        await ensureDimensionExists(
          sheets,
          spreadsheetId,
          `${w}"x${h}"`,
          `${w}x${h}`,
        ).catch((e) =>
          console.warn(
            "update_product: could not ensure dimension:",
            e?.message,
          ),
        );
      }

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "update_product",
        `sku=${sku} fields=${Object.keys(fields).join(",")}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({ ok: true, sku });
    } catch (error: any) {
      console.error("PUT /api/catalog/product/:sku failed:", error);
      tryLogError(req, "update_product", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to update product",
      });
    }
  },
);

app.delete(
  "/api/catalog/product/:sku",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    if (guardProducts)
      return res.status(503).json({
        ok: false,
        error:
          "Product management is still in progress - inventory changes only for now",
      });
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const { sheets, spreadsheetId } = getSheets();
      const result = await deleteProduct(sheets, spreadsheetId, sku);

      let wooDeleted = false;
      if (result.wooId) {
        try {
          await deleteProductFromWoo(result.wooId);
          wooDeleted = true;
        } catch (e: any) {
          console.error(`Woo product delete failed for ${sku}:`, e?.message);
        }
      }

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "delete_product",
        `sku=${sku} wooId=${result.wooId ?? "none"} variants=${result.variantsDeleted} descriptions=${result.descriptionsDeleted} inventory_index=${result.inventoryIndexDeleted} wooDeleted=${wooDeleted}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({ ok: true, sku, ...result, wooDeleted });
    } catch (error: any) {
      console.error("DELETE /api/catalog/product/:sku failed:", error);
      tryLogError(req, "delete_product", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to delete product",
      });
    }
  },
);

app.post(
  "/api/catalog/product/:sku/variants",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    if (guardProducts)
      return res.status(503).json({
        ok: false,
        error:
          "Product management is still in progress - inventory changes only for now",
      });
    try {
      const parentSku = req.params.sku?.trim();
      if (!parentSku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const parsedVariants = parseCreateVariantsBody(req.body);
      if ("error" in parsedVariants)
        return res.status(400).json({ ok: false, error: parsedVariants.error });
      const { productId, colors, sizes, dimensions, shared } = parsedVariants;
      const variants = buildVariantCombos(colors, sizes, dimensions, shared);

      const { sheets, spreadsheetId } = getSheets();
      const result = await createVariantRows(
        sheets,
        spreadsheetId,
        productId,
        variants,
      );

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "create_variants",
        `parentSku=${parentSku} count=${result.skus.length} skus=${result.skus.join(",")}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(201).json({ ok: true, skus: result.skus });
    } catch (error: any) {
      console.error("POST /api/catalog/product/:sku/variants failed:", error);
      if (error instanceof DupeSkuError) {
        return res.status(409).json({ ok: false, dupeSkus: error.dupes });
      }
      tryLogError(req, "create_variants", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to create variants",
      });
    }
  },
);

app.put(
  "/api/catalog/variant/:sku",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    if (guardProducts)
      return res.status(503).json({
        ok: false,
        error:
          "Product management is still in progress - inventory changes only for now",
      });
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const fields = parseUpdateVariantFields(req.body ?? {});

      if (!Object.keys(fields).length)
        return res
          .status(400)
          .json({ ok: false, error: "No updatable fields provided" });

      const { sheets, spreadsheetId } = getSheets();
      await updateVariant(sheets, spreadsheetId, sku, fields);

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "update_variant",
        `sku=${sku} fields=${Object.keys(fields).join(",")}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({ ok: true, sku });
    } catch (error: any) {
      console.error("PUT /api/catalog/variant/:sku failed:", error);
      tryLogError(req, "update_variant", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to update variant",
      });
    }
  },
);

app.delete(
  "/api/catalog/variant/:sku",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    if (guardProducts)
      return res.status(503).json({
        ok: false,
        error:
          "Product management is still in progress - inventory changes only for now",
      });
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const rawDataIndex = req.query.dataIndex;
      const dataIndex =
        rawDataIndex !== undefined ? parseInt(String(rawDataIndex), 10) : undefined;
      if (dataIndex !== undefined && isNaN(dataIndex))
        return res.status(400).json({ ok: false, error: "Invalid dataIndex" });

      const { sheets, spreadsheetId } = getSheets();
      const result = await deleteVariant(sheets, spreadsheetId, sku, dataIndex);

      let wooDeleted = false;
      if (result.wooVariantId && result.parentWooId) {
        try {
          await deleteVariationFromWoo(result.parentWooId, result.wooVariantId);
          wooDeleted = true;
          // If this was the last variant, convert the parent to a simple product
          if (result.wasLastVariant) {
            await convertWooProductToSimple(result.parentWooId).catch((e: any) =>
              console.error(`Convert-to-simple failed for parent ${result.parentWooId}:`, e?.message),
            );
          }
        } catch (e: any) {
          console.error(`Woo variation delete failed for ${sku}:`, e?.message);
        }
      }

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "delete_variant",
        `sku=${sku} wooVariantId=${result.wooVariantId ?? "none"} parentWooId=${result.parentWooId ?? "none"} wasLastVariant=${result.wasLastVariant} descriptions=${result.descriptionsDeleted} inventory_index=${result.inventoryIndexDeleted} wooDeleted=${wooDeleted}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({ ok: true, sku, ...result, wooDeleted });
    } catch (error: any) {
      console.error("DELETE /api/catalog/variant/:sku failed:", error);
      tryLogError(req, "delete_variant", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to delete variant",
      });
    }
  },
);

/**
 * Pushes product content (name, description, price, sale price, category,
 * attributes) to WooCommerce. Never touches stock — that's the
 * inventory_sync_stock route's job. Drafts are skipped unless `publish: true`
 * is sent, in which case they're created/published in Woo. Sheet edits are
 * always saved before this runs (separate endpoints), so a failure here only
 * means that product's last_hash/last_synced_at doesn't advance — nothing
 * the user already saved is at risk.
 *
 * mode: "selected" (default) syncs exactly the given productIds, always
 * pushing regardless of hash. mode: "sync_all" ignores productIds, runs
 * against every product in the sheet, and skips any whose content hash
 * hasn't changed since last_hash was written — same skip-unchanged pattern
 * inventory_sync_stock's mode flag already uses for its own modes.
 */
app.post(
  "/api/catalog/sync_to_site",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    if (guardProducts)
      return res.status(503).json({
        ok: false,
        error:
          "Product management is still in progress - inventory changes only for now",
      });
    try {
      const { productIds, publish, mode, stockOverrides } = req.body as {
        productIds?: string[];
        publish?: boolean;
        mode?: "selected" | "sync_all";
        stockOverrides?: Record<string, number>;
      };
      const syncMode = mode === "sync_all" ? "sync_all" : "selected";

      if (
        syncMode === "selected" &&
        (!Array.isArray(productIds) || !productIds.length)
      ) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing productIds" });
      }

      const { sheets, spreadsheetId } = getSheets();

      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["products_values", "variants_values"],
      });
      const valueRanges = response.data.valueRanges ?? [];
      const productRows = rowsToObjects<ProductSheetRow>(
        valueRanges[0]?.values ?? [],
      );
      const variantRows = rowsToObjects<VariantSheetRow>(
        valueRanges[1]?.values ?? [],
      );
      const { groups } = shapeToCatalogPayload(productRows, variantRows);

      let targetGroups = groups;
      let missing: string[] = [];

      if (syncMode === "selected") {
        const idSet = new Set(productIds);
        targetGroups = groups.filter((g) => idSet.has(g.productId));
        missing = productIds!.filter(
          (id) => !targetGroups.some((g) => g.productId === id),
        );
      }

      // Apply any user-supplied stock overrides in-memory so WooCommerce
      // receives the correct initial stock without waiting for sheet formula
      // recalculation. Also persists to inventory_index for consistency.
      if (stockOverrides && Object.keys(stockOverrides).length > 0) {
        targetGroups = targetGroups.map((group) => {
          if (group.rowCount === 0) {
            const qty = stockOverrides[group.sku];
            return qty !== undefined ? { ...group, stockQty: qty } : group;
          }
          const patchedRows = group.rows.map((row) => {
            const qty = stockOverrides[row.sku];
            return qty !== undefined ? { ...row, stockQty: qty } : row;
          });
          return { ...group, rows: patchedRows };
        });

        // Persist to inventory_index before the Woo sync runs — awaited so
        // it's confirmed written before the response returns (the frontend
        // reloads the catalog immediately after), and sequenced ahead of
        // syncCatalogGroupsToWoo's own inventory_index write (parent stock
        // clearing) to avoid two concurrent writers racing on the same sheet.
        // upsertInventoryIndexFields self-heals missing rows, so a variant
        // created since the last self-heal pass still gets its override.
        try {
          const overrideUpdates = Object.entries(stockOverrides).map(
            ([sku, qty]) => ({ sku, fields: { stock_qty: qty } }),
          );
          await upsertInventoryIndexFields(
            sheets,
            spreadsheetId,
            overrideUpdates,
            buildCatalogNameBySku(targetGroups),
          );
        } catch (e) {
          console.error("stock override write failed:", e);
        }
      }

      const forceStockSkus = stockOverrides
        ? new Set(Object.keys(stockOverrides))
        : undefined;

      const summary = await syncCatalogGroupsToWoo(
        sheets,
        spreadsheetId,
        targetGroups,
        Boolean(publish),
        { skipUnchanged: syncMode === "sync_all", forceStockSkus },
      );

      // Content sync never touches stock itself (see syncCatalogGroupsToWoo's
      // doc comment) — but any group that just got synced may have had Woo
      // set/confirm its own stock (new products/variants always get an
      // initial stock write at creation; forceStockSkus pushes one too).
      // Reuse the existing stock-sync confirm/write-back step so woo_stock
      // (and the unsynced-stock indicator derived from it) reflect what Woo
      // actually has, instead of drifting stale until the next inventory load.
      const syncedGroupSkus = new Set(
        summary.results.filter((r) => r.status === "synced").map((r) => r.sku),
      );
      const touchedStockSkus = new Set(
        targetGroups
          .filter((g) => syncedGroupSkus.has(g.sku))
          .flatMap((g) => [g.sku, ...g.rows.map((r) => r.sku)]),
      );
      if (touchedStockSkus.size) {
        await refreshWooStockForCatalog(sheets, spreadsheetId, targetGroups, {
          touchedSkus: touchedStockSkus,
        }).catch((e) =>
          console.error("post-sync woo_stock refresh failed:", e),
        );
      }

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "sync_to_site",
        `mode=${syncMode} publish=${Boolean(publish)} synced=${summary.syncedCount} skipped_draft=${summary.skippedDraftCount} skipped_unchanged=${summary.skippedUnchangedCount} failed=${summary.failedCount} missing=${missing.join(",")}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({ ok: true, ...summary, missing });
    } catch (error: any) {
      console.error("POST /api/catalog/sync_to_site failed:", error);
      tryLogError(req, "sync_to_site", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to sync to site",
      });
    }
  },
);

app.post(
  "/api/catalog/product/:sku/set_woo_id",
  async (req: Request, res: Response) => {
    if (!req.session?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    if (req.session.user.role !== "editor" && req.session.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "Not authorized" });
    }
    try {
      const sku = decodeURIComponent(req.params.sku);
      const { wooId } = req.body as { wooId?: number };
      if (!wooId || typeof wooId !== "number" || wooId <= 0) {
        return res.status(400).json({ ok: false, error: "Invalid wooId" });
      }
      const { sheets, spreadsheetId } = getSheets();
      await writeProductWooId(sheets, spreadsheetId, sku, wooId);
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        req.session.user.email,
        "set_woo_id",
        `sku=${sku} wooId=${wooId}`,
        TARGET_ENV,
      ]).catch(() => {});
      return res.json({ ok: true });
    } catch (error: unknown) {
      console.error("POST /api/catalog/product/:sku/set_woo_id failed:", error);
      tryLogError(req, "set_woo_id", error);
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to set woo_id",
      });
    }
  },
);

app.post(
  "/api/catalog/product/:sku/image",
  async (req: Request, res: Response) => {
    if (!req.session?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    if (req.session.user.role !== "editor" && req.session.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "Not authorized" });
    }
    try {
      const sku = decodeURIComponent(req.params.sku);
      const { productName, pastedUrl, files } = req.body as {
        productName?: string;
        pastedUrl?: string;
        files?: Array<{ fileName: string; fileData: string; mimeType: string }>;
      };
      if (!productName) {
        return res.status(400).json({ ok: false, error: "productName is required" });
      }
      if (!pastedUrl && (!files || files.length === 0)) {
        return res.status(400).json({ ok: false, error: "Provide an image URL or upload at least one file" });
      }

      const uploadedFiles: Array<{ name: string; link: string }> = [];

      if (files && files.length > 0) {
        const folderId = process.env.DRIVE_IMAGES_FOLDER_ID;
        if (!folderId) throw new Error("DRIVE_IMAGES_FOLDER_ID is not configured");

        const drive = google.drive({ version: "v3", auth: serviceAuth });
        const { Readable } = await import("stream");
        const ts = Date.now();

        for (let i = 0; i < files.length; i++) {
          const { fileName, fileData, mimeType } = files[i];
          const ext = fileName.split(".").pop() ?? "jpg";
          const uploadedName = `${sku}-${ts}${files.length > 1 ? `-${i + 1}` : ""}.${ext}`;

          const uploaded = await drive.files.create({
            supportsAllDrives: true,
            requestBody: { name: uploadedName, parents: [folderId] },
            media: { mimeType, body: Readable.from(Buffer.from(fileData, "base64")) },
            fields: "id,webViewLink",
          });
          uploadedFiles.push({
            name: uploadedName,
            link: uploaded.data.webViewLink ?? `https://drive.google.com/file/d/${uploaded.data.id}/view`,
          });
        }
      }

      await sendImageNotification({
        sku,
        productName,
        uploaderEmail: req.session.user.email,
        uploadedFiles,
        pastedUrl,
      });

      const { sheets, spreadsheetId } = getSheets();
      const logDetail = uploadedFiles.length
        ? `sku=${sku} drive:${uploadedFiles.map((f) => f.name).join(",")}`
        : `sku=${sku} url:${pastedUrl}`;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        req.session.user.email,
        "image_notification",
        logDetail,
        TARGET_ENV,
      ]).catch(() => {});
      return res.json({ ok: true });
    } catch (error: unknown) {
      console.error("POST /api/catalog/product/:sku/image failed:", error);
      tryLogError(req, "image_notification", error);
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to send image notification",
      });
    }
  },
);

app.post(
  "/api/catalog/variant/:sku/image",
  requireAuth,
  requireCanEdit,
  async (req: Request, res: Response) => {
    try {
      const sku = decodeURIComponent(req.params.sku);
      const { productName, pastedUrl, file } = req.body as {
        productName?: string;
        pastedUrl?: string;
        file?: { fileName: string; fileData: string; mimeType: string };
      };
      if (!productName) {
        return res.status(400).json({ ok: false, error: "productName is required" });
      }
      if (!pastedUrl && !file) {
        return res.status(400).json({ ok: false, error: "Provide an image URL or upload a file" });
      }

      const { sheets, spreadsheetId } = getSheets();
      let finalUrl: string;

      if (file) {
        const folderId = process.env.DRIVE_IMAGES_FOLDER_ID;
        if (!folderId) throw new Error("DRIVE_IMAGES_FOLDER_ID is not configured");

        const drive = google.drive({ version: "v3", auth: serviceAuth });
        const { Readable } = await import("stream");
        const ts = Date.now();
        const ext = file.fileName.split(".").pop() ?? "jpg";
        const uploadedName = `${sku}-${ts}.${ext}`;

        const uploaded = await drive.files.create({
          supportsAllDrives: true,
          requestBody: { name: uploadedName, parents: [folderId] },
          media: { mimeType: file.mimeType, body: Readable.from(Buffer.from(file.fileData, "base64")) },
          fields: "id,webViewLink",
        });
        finalUrl = uploaded.data.webViewLink ?? `https://drive.google.com/file/d/${uploaded.data.id}/view`;

        await sendImageNotification({
          sku,
          productName,
          uploaderEmail: req.session.user!.email,
          uploadedFiles: [{ name: uploadedName, link: finalUrl }],
        });
      } else {
        finalUrl = pastedUrl!;
        await sendImageNotification({
          sku,
          productName,
          uploaderEmail: req.session.user!.email,
          uploadedFiles: [],
          pastedUrl: finalUrl,
        });
      }

      await writeVariantImageUrl(sheets, spreadsheetId, sku, finalUrl);

      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        req.session.user!.email,
        "variant_image",
        `sku=${sku} url=${finalUrl}`,
        TARGET_ENV,
      ]).catch(() => {});

      return res.json({ ok: true, imageUrl: finalUrl });
    } catch (error: unknown) {
      console.error("POST /api/catalog/variant/:sku/image failed:", error);
      tryLogError(req, "variant_image", error);
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save variant image",
      });
    }
  },
);

// Test endpoint
app.get("/api/test", async (req: Request, res: Response) => {
  try {
    getSheets();
    res.json({ ok: true, message: "Sheets API connected!" });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.json({ ok: false, error: errorMessage });
  }
});

if (process.env.NODE_ENV === "production") {
  const { createRequestHandler } = await import("@react-router/express");
  const compression = (await import("compression")).default;
  const pathModule = await import("path");

  app.use(compression());
  app.use(
    express.static(pathModule.join(process.cwd(), "build/client"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  app.use(
    createRequestHandler({
      // @ts-ignore - build/server/index.js exists only after npm run build
      build: () => import("../build/server/index.js"),
    }),
  );
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "unknown"}`);
  console.log(`Target environment: ${TARGET_ENV || "unknown"}`);
});
