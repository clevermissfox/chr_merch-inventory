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
  NewProductFields,
  ProductSheetRow,
  VariantSheetRow,
} from "~/types/catalog";
import type { AuthUser } from "~/types/user";
import {
  appendCategoryEntry,
  appendRefEntry,
  buildConflictGroups,
  computeProductSyncHash,
  createProductRow,
  createVariantRows,
  createWooCategory,
  deleteProduct,
  deleteVariant,
  ensureDescriptionsRow,
  pollForProductSku,
  readRefData,
  rowsToObjects,
  shapeToCatalogPayload,
  updateProduct,
  updateVariant,
  writeProductSyncHash,
  writeProductSyncHashes,
  writeSheetLog,
} from "./catalogManager";
import type {
  RefAddType,
  UpdateProductFields,
  UpdateVariantFields,
} from "./catalogManager";
import {
  applyWooStockMapToCatalogGroups,
  buildStockSyncChangesFromCatalog,
  buildStockSyncPlan,
  refreshWooStockForCatalog,
  syncStockSyncPlanToWoo,
} from "./inventoryManager";

// dotenv.config();
dotenv.config({ path: "./backend/.env" });
dotenv.config({ path: "./app/.env" });

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

// Add CORS middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

// Middleware
app.use(express.json());
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

    const payload: CatalogPayload = {
      ...shapeToCatalogPayload(productRows, variantRows),
      generatedAt: new Date().toISOString(),
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

      const refreshResult = await refreshWooStockForCatalog(
        sheets,
        spreadsheetId,
        payload.groups,
      );

      const updatedGroups = applyWooStockMapToCatalogGroups(
        payload.groups,
        refreshResult.wooQtyBySku,
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
          conflictGroups: buildConflictGroups(updatedGroups),
          wooSiteUrl: wooSiteUrl ?? undefined,
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

      // Write last_hash + last_synced_at for every product that had SKUs pushed
      const pushedSkuSet = new Set(wooResult.updatedSkus);
      const hashEntries = catalog.groups
        .filter(
          (g) =>
            (g.sku && pushedSkuSet.has(g.sku)) ||
            g.rows.some((r) => pushedSkuSet.has(r.sku)),
        )
        .map((g) => ({ sku: g.sku, hash: computeProductSyncHash(g) }));

      if (hashEntries.length) {
        writeProductSyncHashes(sheets, spreadsheetId, hashEntries).catch((e) =>
          console.error("hash write failed:", e),
        );
      }

      const actor = req.session?.user;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor?.email ?? "",
        `inventory_sync_stock_${mode}`,
        `pushed=${wooResult.updatedProducts} skus=${wooResult.updatedSkus.join(",")} skipped=${wooResult.skipped.length} index_updated=${refreshResult.updated}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({
        ok: true,
        updatedProducts: wooResult.updatedProducts,
        updatedSkus: wooResult.updatedSkus,
        skipped: wooResult.skipped,
        inventoryIndexUpdated: refreshResult.updated,
        simpleCount: refreshResult.simpleCount,
        variationCount: refreshResult.variationCount,
      });
    } catch (error: any) {
      console.error("POST /api/catalog/inventory/sync_stock failed:", error);

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

const VALID_REF_TYPES = new Set<RefAddType>([
  "color",
  "size",
  "dimension",
  "graphicsVariant",
  "graphic",
  "style",
]);

app.post(
  "/api/catalog/ref/add",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { type, value, code, label, parentWooId } = req.body as {
        type?: string;
        value?: string;
        code?: string;
        label?: string;
        parentWooId?: number;
      };

      if (!value?.trim()) {
        return res.status(400).json({ ok: false, error: "Value is required" });
      }

      const CODED_TYPES = new Set(["color","size","dimension","graphicsVariant","category","subcategory"]);
      if (CODED_TYPES.has(type ?? "") && !code?.trim()) {
        return res.status(400).json({ ok: false, error: "Code is required" });
      }
      const safeCode = code?.trim() ?? "";

      const { sheets, spreadsheetId } = getSheets();

      const actor = req.session?.user;
      const actorEmail = actor?.email ?? "unknown";

      if (type === "category" || type === "subcategory") {
        if (type === "subcategory" && parentWooId == null) {
          return res.status(400).json({
            ok: false,
            error: "parentWooId is required for subcategory",
          });
        }
        const normalizedValue = value.trim().toLowerCase();
        // label is the sheet display name for subcategories (user-provided, may include capitals/symbols)
        // Woo name + slug are always the lowercase normalizedValue
        const sheetLabel = label?.trim() || normalizedValue;
        const display = type === "category" ? "default" : "subcategories";
        const wooId = await createWooCategory(
          normalizedValue,
          type === "subcategory" ? (parentWooId ?? null) : null,
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
        );
        writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
          new Date().toISOString(),
          actorEmail,
          `ref_add_${type}`,
          `value=${normalizedValue} label=${sheetLabel} code=${safeCode.toUpperCase()} wooId=${wooId}${type === "subcategory" ? ` parentWooId=${parentWooId}` : ""}`,
          TARGET_ENV,
        ]).catch((e) => console.error("log failed:", e));
        return res.status(200).json({
          ok: true,
          value: normalizedValue,
          code: safeCode.toUpperCase(),
          wooId,
          label: sheetLabel,
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
  async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<NewProductFields>;
      const { category, subcategory, basePriceDollars, weightOz } = body;

      if (!category || !subcategory || !basePriceDollars || !weightOz) {
        return res.status(400).json({
          ok: false,
          error:
            "Missing required fields: category, subcategory, basePriceDollars, weightOz",
        });
      }

      const fields: NewProductFields = {
        category,
        subcategory,
        basePriceDollars,
        weightOz,
        displayName: body.displayName,
        design: body.design,
        styleModifier: body.styleModifier,
        dimensionsWidth: body.dimensionsWidth,
        dimensionsHeight: body.dimensionsHeight,
        dimensionsDepth: body.dimensionsDepth,
        primaryDescription: body.primaryDescription,
        shortDescription: body.shortDescription,
        salePriceDollars: body.salePriceDollars,
        publishedStatus: body.publishedStatus && ["draft","publish","private"].includes(body.publishedStatus)
          ? body.publishedStatus
          : "draft",
      };

      const { sheets, spreadsheetId } = getSheets();
      const { sheetRow, rowId } = await createProductRow(
        sheets,
        spreadsheetId,
        fields,
      );
      const { productId, sku } = await pollForProductSku(
        sheets,
        spreadsheetId,
        sheetRow,
      );
      await ensureDescriptionsRow(sheets, spreadsheetId, sku);

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
  async (req: Request, res: Response) => {
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const body = req.body as Partial<UpdateProductFields>;
      const fields: UpdateProductFields = {};

      if (typeof body.displayName === "string")
        fields.displayName = body.displayName.trim();
      if (typeof body.basePriceDollars === "string")
        fields.basePriceDollars = body.basePriceDollars.trim();
      if (typeof body.salePriceDollars === "string")
        fields.salePriceDollars = body.salePriceDollars.trim();
      if (typeof body.publishedStatus === "string" && ["draft","publish","private"].includes(body.publishedStatus))
        fields.publishedStatus = body.publishedStatus;
      if (typeof body.weightOz === "string")
        fields.weightOz = body.weightOz.trim();
      if (typeof body.primaryDescription === "string")
        fields.primaryDescription = body.primaryDescription.trim();
      if (typeof body.shortDescription === "string")
        fields.shortDescription = body.shortDescription.trim();
      if (typeof body.dimensionsWidth === "string")
        fields.dimensionsWidth = body.dimensionsWidth.trim();
      if (typeof body.dimensionsHeight === "string")
        fields.dimensionsHeight = body.dimensionsHeight.trim();
      if (typeof body.dimensionsDepth === "string")
        fields.dimensionsDepth = body.dimensionsDepth.trim();

      if (!Object.keys(fields).length)
        return res
          .status(400)
          .json({ ok: false, error: "No updatable fields provided" });

      const { sheets, spreadsheetId } = getSheets();
      await updateProduct(sheets, spreadsheetId, sku, fields);

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
  async (req: Request, res: Response) => {
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const { sheets, spreadsheetId } = getSheets();
      const result = await deleteProduct(sheets, spreadsheetId, sku);

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "delete_product",
        `sku=${sku} variants=${result.variantsDeleted} descriptions=${result.descriptionsDeleted} inventory_index=${result.inventoryIndexDeleted}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({ ok: true, sku, ...result });
    } catch (error: any) {
      console.error("DELETE /api/catalog/product/:sku failed:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to delete product",
      });
    }
  },
);

app.put(
  "/api/catalog/variant/:sku",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const body = req.body ?? {};
      const fields: UpdateVariantFields = {};
      if (body.priceVariant !== undefined)
        fields.priceVariant = String(body.priceVariant).trim();
      if (body.salePriceVariant !== undefined)
        fields.salePriceVariant = String(body.salePriceVariant).trim();
      if (body.weightOzVariant !== undefined)
        fields.weightOzVariant = String(body.weightOzVariant).trim();
      if (body.descriptionVariant !== undefined)
        fields.descriptionVariant = String(body.descriptionVariant).trim();

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
  async (req: Request, res: Response) => {
    try {
      const sku = req.params.sku?.trim();
      if (!sku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const { sheets, spreadsheetId } = getSheets();
      const result = await deleteVariant(sheets, spreadsheetId, sku);

      const actor = req.session.user!;
      writeSheetLog(sheets, spreadsheetId, "merch_app_logs", [
        new Date().toISOString(),
        actor.email,
        "delete_variant",
        `sku=${sku} descriptions=${result.descriptionsDeleted} inventory_index=${result.inventoryIndexDeleted}`,
        TARGET_ENV,
      ]).catch((e) => console.error("log failed:", e));

      return res.status(200).json({ ok: true, sku, ...result });
    } catch (error: any) {
      console.error("DELETE /api/catalog/variant/:sku failed:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to delete variant",
      });
    }
  },
);

app.post(
  "/api/catalog/product/:sku/variants",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const parentSku = req.params.sku?.trim();
      if (!parentSku)
        return res.status(400).json({ ok: false, error: "Missing sku" });

      const body = req.body as {
        productId?: string;
        colors?: string[];
        sizes?: string[];
        dimensions?: string[];
        design?: string;
        designVariant?: string;
        priceVariant?: string;
        weightOzVariant?: string;
        descriptionVariant?: string;
        stockQty?: number;
      };

      const productId = body.productId?.trim();
      if (!productId)
        return res.status(400).json({ ok: false, error: "Missing productId" });

      const colors = Array.isArray(body.colors) ? body.colors.filter(Boolean) : [];
      const sizes = Array.isArray(body.sizes) ? body.sizes.filter(Boolean) : [];
      const dimensions = Array.isArray(body.dimensions) ? body.dimensions.filter(Boolean) : [];

      if (!colors.length && !sizes.length && !dimensions.length) {
        return res.status(400).json({
          ok: false,
          error: "Must provide at least one color, size, or dimension",
        });
      }

      const shared = {
        design: body.design || undefined,
        designVariant: body.designVariant || undefined,
        priceVariant: body.priceVariant || undefined,
        weightOzVariant: body.weightOzVariant || undefined,
        descriptionVariant: body.descriptionVariant || undefined,
        stockQty: body.stockQty !== undefined ? Number(body.stockQty) : undefined,
      };

      // Build N-dimensional cartesian product across whichever axes are selected
      let combos: Array<{ color?: string; size?: string; dimension?: string }> = [{}];
      if (colors.length) combos = combos.flatMap((c) => colors.map((color) => ({ ...c, color })));
      if (sizes.length) combos = combos.flatMap((c) => sizes.map((size) => ({ ...c, size })));
      if (dimensions.length) combos = combos.flatMap((c) => dimensions.map((dimension) => ({ ...c, dimension })));
      const variants = combos.map((c) => ({ ...c, ...shared }));

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
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to create variants",
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
