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
    secret: process.env.SESSION_SECRET || "chr-merch-dev-secret",
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
      fields: "permissions(id, type, emailAddress, role)",
    });

    const userPermission = permissions.data.permissions?.find(
      (p) => p.emailAddress === userEmail && p.role !== "owner",
    );

    if (!userPermission) {
      return { canEdit: false, role: "none" };
    }

    const canEdit = userPermission.role === "writer";
    return { canEdit, role: canEdit ? "editor" : "viewer" };
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
  process.env.SERVICE_ACCOUNT_KEY_PATH ||
    "./credentials/merch-gcc-service-account_key.json",
);

const serviceAuth = new google.auth.GoogleAuth({
  keyFile: serviceAccountKeyPath,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/oauth2",
  ],
});

// OAuth login endpoint
app.get("/api/auth/google", async (req: Request, res: Response) => {
  try {
    console.log("Full query from login:", req.query);
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
    console.log("Full query from callback:", req.query);

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
    canEdit: req.session.user.canEdit,
  });
});

// Test endpoint
app.get("/api/test", async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === "staging") {
      console.log("Running in staging environment");
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
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
