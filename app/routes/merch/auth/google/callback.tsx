// app/routes/merch/auth/google/callback.tsx
import { useEffect } from "react";

export default function GoogleCallback() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    const redirectParam =
      new URLSearchParams(window.location.search).get("redirect") ||
      "/merch/inventory";

    if (code) {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
      fetch(
        `${API_URL}/api/auth/google/callback?code=${code}&redirect=${redirectParam}`,
      )
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            window.location.href = redirectParam;
          } else {
            window.location.href = `/merch?error=${data.error}`;
          }
        });
    }
  }, []);

  return <div>Logging in...</div>;
}
