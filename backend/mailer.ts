import { Resend } from "resend";

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Email not configured — set RESEND_API_KEY environment variable.",
    );
  }
  return new Resend(apiKey);
}

export interface ImageNotificationParams {
  sku: string;
  productName: string;
  uploaderEmail: string;
  uploadedFiles?: Array<{ name: string; link: string }>;
  pastedUrl?: string;
  folderLink?: string;
  notes?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendImageNotification(
  params: ImageNotificationParams,
): Promise<void> {
  const {
    sku,
    productName,
    uploaderEmail,
    uploadedFiles = [],
    pastedUrl,
    folderLink,
    notes,
  } = params;

  const devEmail = process.env.DEV_EMAIL;
  if (!devEmail) {
    throw new Error(
      "Email not configured — set DEV_EMAIL environment variable.",
    );
  }

  const resend = getResend();

  const hasDriveFiles = uploadedFiles.length > 0;
  const fileCount = uploadedFiles.length;

  const driveLinksHtml = hasDriveFiles
    ? uploadedFiles
        .map(
          (f) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #f0ede6;">
              <a href="${f.link}" style="color:#282828;font-size:14px;font-weight:600;text-decoration:none;">${f.name}</a>
              <br><a href="${f.link}" style="color:#d3aa56;font-size:12px;">View in Drive →</a>
            </td></tr>`,
        )
        .join("")
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#282828;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#282828;border-radius:12px 12px 0 0;padding:24px 32px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#d3aa56;font-weight:600;">CHR Merch Hub</p>
          <h1 style="margin:8px 0 0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">
            ${hasDriveFiles ? `${fileCount} image${fileCount !== 1 ? "s" : ""} submitted for processing` : "Image link submitted"}
          </h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Product info -->
            <tr><td style="padding-bottom:20px;border-bottom:1px solid #e8e4dc;">
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;">Product</p>
              <p style="margin:0;font-size:18px;font-weight:700;color:#282828;">${productName}</p>
              <p style="margin:4px 0 0;font-size:13px;color:#666;font-family:monospace;">${sku}</p>
            </td></tr>

            <!-- Submitted by -->
            <tr><td style="padding:20px 0;border-bottom:1px solid #e8e4dc;">
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;">Submitted by</p>
              <p style="margin:0;font-size:14px;color:#282828;">${uploaderEmail}</p>
            </td></tr>

            <!-- Files or link -->
            <tr><td style="padding:20px 0 4px;">
              <p style="margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;">
                ${hasDriveFiles ? "Uploaded to Drive" : "Submitted link"}
              </p>
              ${
                hasDriveFiles && folderLink
                  ? `<a href="${folderLink}" style="display:inline-block;margin-bottom:14px;background:#282828;color:#d3aa56;text-decoration:none;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;">Open Drive folder →</a>`
                  : ""
              }
              ${
                hasDriveFiles
                  ? `<table width="100%" cellpadding="0" cellspacing="0">${driveLinksHtml}</table>`
                  : `<a href="${pastedUrl}" style="display:inline-block;background:#282828;color:#d3aa56;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">Open link →</a>
                   <p style="margin:12px 0 0;font-size:12px;color:#999;word-break:break-all;">${pastedUrl}</p>`
              }
            </td></tr>

            ${
              notes
                ? `<tr><td style="padding:20px 0 0;">
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;">Notes</p>
              <p style="margin:0;font-size:14px;color:#282828;white-space:pre-wrap;">${escapeHtml(notes)}</p>
            </td></tr>`
                : ""
            }

          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f7f4ef;border-radius:0 0 12px 12px;padding:16px 32px;border-top:1px solid #e8e4dc;">
          <p style="margin:0;font-size:12px;color:#999;line-height:1.5;">
            Please optimize and watermark before uploading to WooCommerce.<br>
            Sent from <strong style="color:#666;">CHR Merch Hub</strong>.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    `${uploaderEmail} submitted ${hasDriveFiles ? `${fileCount} image${fileCount !== 1 ? "s" : ""}` : "an image link"} for ${productName} (${sku}).`,
    `Please optimize and watermark before uploading to WooCommerce.`,
    hasDriveFiles && folderLink ? `Drive folder: ${folderLink}` : "",
    hasDriveFiles
      ? uploadedFiles.map((f) => `${f.name}: ${f.link}`).join("\n")
      : `Link: ${pastedUrl}`,
    notes ? `Notes: ${notes}` : "",
  ].filter(Boolean);

  const { error } = await resend.emails.send({
    from: "CHR Merch Hub <onboarding@resend.dev>",
    to: devEmail,
    subject: `[CHR Merch] ${fileCount > 1 ? `${fileCount} images` : "Image"} for ${sku} — ${productName}`,
    html,
    text: textLines.join("\n\n"),
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
}

export interface BugReportNotificationParams {
  reporterEmail: string;
  page: string;
  severity: string;
  whatDidYouExpect: string;
  whatHadYouDoneBefore: string;
  whatHappened: string;
  screenshotLink?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  low: "#82d6ab",
  medium: "#ffd293",
  high: "#ff9ca4",
  critical: "#ff9ca4",
};

export async function sendBugReportNotification(
  params: BugReportNotificationParams,
): Promise<void> {
  const {
    reporterEmail,
    page,
    severity,
    whatDidYouExpect,
    whatHadYouDoneBefore,
    whatHappened,
    screenshotLink,
  } = params;

  const devEmail = process.env.DEV_EMAIL;
  if (!devEmail) {
    throw new Error(
      "Email not configured — set DEV_EMAIL environment variable.",
    );
  }

  const resend = getResend();
  const severityColor = SEVERITY_COLOR[severity.toLowerCase()] ?? "#d3aae6";

  const field = (label: string, value: string) => `
    <tr><td style="padding:16px 0;border-bottom:1px solid #e8e4dc;">
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;">${label}</p>
      <p style="margin:0;font-size:14px;color:#282828;white-space:pre-wrap;">${escapeHtml(value) || "—"}</p>
    </td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#282828;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#282828;border-radius:12px 12px 0 0;padding:24px 32px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${severityColor};font-weight:600;">CHR Merch Hub · Bug report</p>
          <h1 style="margin:8px 0 0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">
            ${severity.toUpperCase()} severity
          </h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:20px 0;border-bottom:1px solid #e8e4dc;">
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;">Reported by</p>
              <p style="margin:0;font-size:14px;color:#282828;">${escapeHtml(reporterEmail)}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#999;font-family:monospace;">${escapeHtml(page)}</p>
            </td></tr>
            ${field("What happened", whatHappened)}
            ${field("What did you expect to happen", whatDidYouExpect)}
            ${field("What had you done previously", whatHadYouDoneBefore)}
            ${
              screenshotLink
                ? `<tr><td style="padding:20px 0;">
              <a href="${screenshotLink}" style="display:inline-block;background:#282828;color:#d3aae6;text-decoration:none;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;">View screenshot →</a>
            </td></tr>`
                : ""
            }
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f7f4ef;border-radius:0 0 12px 12px;padding:16px 32px;border-top:1px solid #e8e4dc;">
          <p style="margin:0;font-size:12px;color:#999;line-height:1.5;">
            Sent from <strong style="color:#666;">CHR Merch Hub</strong> bug report form.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    `${reporterEmail} filed a ${severity} severity bug report on ${page}.`,
    `What happened: ${whatHappened}`,
    `What did you expect to happen: ${whatDidYouExpect}`,
    `What had you done previously: ${whatHadYouDoneBefore}`,
    screenshotLink ? `Screenshot: ${screenshotLink}` : "",
  ].filter(Boolean);

  const { error } = await resend.emails.send({
    from: "CHR Merch Hub <onboarding@resend.dev>",
    to: devEmail,
    subject: `[CHR Merch] Bug report (${severity}) — ${reporterEmail}`,
    html,
    text: textLines.join("\n\n"),
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
}
