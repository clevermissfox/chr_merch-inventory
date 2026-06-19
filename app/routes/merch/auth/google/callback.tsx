// This component is not currently registered in routes.ts.
// Google OAuth redirects go directly to /api/auth/google/callback (Express endpoint),
// which sets the session and redirects the browser to the app.
// Keep this file if you ever want to switch back to frontend-handled code exchange.

export default function GoogleCallback() {
  return <div>Logging in...</div>;
}
