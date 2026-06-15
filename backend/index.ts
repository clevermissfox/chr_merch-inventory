import express from "express";
import { type Request, type Response } from "express";
import { google } from "googleapis";
import * as dotenv from "dotenv";
import path from "path";
import session from "express-session";
import cors from "cors";

// dotenv.config();
dotenv.config({ path: "./backend/.env" });

declare module "express-session" {
  interface SessionData {
    user: {
      id: string;
      email: string;
      name?: string;
      role?: string;
      canEdit?: boolean;
    };
    redirect?: string | null;
  }
}

const app = express();
// const PORT = 3001;
// const FRONTEND_URL = "http://localhost:5173";
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

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
    secret: process.env.SESSION_SECRET || "harmredux",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

// Helper to get spreadsheet ID
function getSpreadsheetId(): string {
  const isProduction = process.env.NODE_ENV === "production";
  return isProduction
    ? process.env.PRODUCTION_SPREADSHEET_ID || ""
    : process.env.NODE_ENV === "development"
      ? process.env.PRODUCTION_SPREADSHEET_ID || ""
      : process.env.STAGING_SPREADSHEET_ID || "";
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

    const redirectUrl = (req.query.redirect as string) || "/merch";

    if (req.session.redirect) {
      delete req.session.redirect;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENT_ID,
      process.env.OAUTH_CLIENT_SECRET,
      process.env.NODE_ENV === "production"
        ? `https://cochiseharmreduction.org/merch/auth/google/callback`
        : process.env.NODE_ENV === "development"
          ? `http://localhost:3001/api/auth/google/callback`
          : `http://localhost:3001/api/auth/google/callback`,
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

    const redirectUrl = req.query.state || "/merch";

    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENT_ID,
      process.env.OAUTH_CLIENT_SECRET,
      process.env.NODE_ENV === "production"
        ? `https://cochiseharmreduction.org/merch/auth/google/callback`
        : `http://localhost:3001/api/auth/google/callback`,
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
      email: email,
      canEdit: access.canEdit,
      role: access.role,
    };

    res.redirect(
      process.env.NODE_ENV === "production"
        ? `https://cochiseharmreduction.org${redirectUrl}`
        : `http://localhost:5173${redirectUrl}`,
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.json({ success: false, error: errorMessage });
  }
});

// Logout
app.post("/api/auth/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
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

// Get stock_qty and woo_stock
app.get(
  "/api/catalog/inventory/get_stock",
  async (req: Request, res: Response) => {
    try {
      if (!req.session.user) {
        return res.status(401).json({ ok: false, error: "not_authenticated" });
      }

      const action = "inventory_rebuild_index_and_refresh_woo_stock";
      const url = new URL(process.env.WORKER_PROXY_URL!);
      url.searchParams.set("action", action);

      if (process.env.NODE_ENV !== "production") {
        url.searchParams.set("environment", process.env.NODE_ENV!);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      const workerJson: unknown = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(workerJson);
      }

      const payload =
        workerJson && typeof workerJson === "object" && "data" in workerJson
          ? (workerJson as { data: unknown }).data
          : workerJson;

      return res.status(200).json(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error calling GAS inventory route:", error);
      return res.status(500).json({ ok: false, error: message });
    }
  },
);

// push stock changes
app.post(
  "/api/catalog/inventory/sync_stock",
  async (req: Request, res: Response) => {
    try {
      if (!req.session.user) {
        return res.status(401).json({ ok: false, error: "not_authenticated" });
      }

      if (!req.session.user.canEdit) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const rawChanges = Array.isArray(req.body?.changes)
        ? req.body.changes
        : [];

      if (!rawChanges.length) {
        return res.status(400).json({ ok: false, error: "no_changes" });
      }

      const changes = rawChanges.map((item) => {
        const sku = String(item?.sku || "").trim();
        const stockQty = item?.stockQty;

        if (!sku) {
          throw new Error("invalid_sku");
        }

        if (stockQty === "" || stockQty == null) {
          return { sku, stock_qty: "" };
        }

        const parsedQty = Number(stockQty);

        if (!Number.isFinite(parsedQty) || parsedQty < 0) {
          throw new Error(`invalid_stock_qty_for_${sku}`);
        }

        return {
          sku,
          stock_qty: Math.round(parsedQty),
        };
      });

      const response = await fetch(process.env.WORKER_PROXY_URL!, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "inventory_sync_stock",
          secret: process.env.GAS_SECRET || "harmredux",
          changes,
          ...(process.env.NODE_ENV !== "production"
            ? { environment: process.env.NODE_ENV }
            : {}),
        }),
      });

      const workerJson: unknown = await response.json();

      if (
        !response.ok ||
        (workerJson &&
          typeof workerJson === "object" &&
          "ok" in workerJson &&
          (workerJson as { ok?: boolean }).ok === false)
      ) {
        return res.status(response.ok ? 500 : response.status).json(workerJson);
      }

      return res.status(200).json(workerJson);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error calling GAS inventory route:", error);
      return res.status(500).json({ ok: false, error: message });
    }
  },
);

// Test endpoint
app.get("/api/test", async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === "staging") {
      console.log("Running in staging environment");
    } else if (process.env.NODE_ENV === "development") {
      console.log("Running in development environment");
    } else {
      console.log("Running in non-staging environment");
    }
    const sheets = google.sheets({ version: "v4", auth: serviceAuth });
    res.json({ success: true, message: "Sheets API connected!" });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.json({ success: false, error: errorMessage });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "unknown"}`);
});
