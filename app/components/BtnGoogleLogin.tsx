import { useState } from "react";

export default function BtnGoogleLogin() {
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
      const redirectUrl = encodeURIComponent(window.location.pathname); // Store current path

      const res = await fetch(
        `${API_URL}/api/auth/google?redirect=${redirectUrl}`,
      );
      const data = await res.json();

      if (data.success && data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setError(data.error || "Failed to start login");
      }
    } catch (err) {
      setError("Failed to connect to server");
      console.error(err);
    }
  };

  return (
    <>
      {error && <div className="auth-error">{error}</div>}

      <button className="google-login-btn" onClick={handleLogin}>
        <img
          src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
          alt="Google logo"
        />
        Sign in with Google
      </button>
    </>
  );
}
