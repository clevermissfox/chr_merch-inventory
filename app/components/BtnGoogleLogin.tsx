import { useState } from "react";

export default function BtnGoogleLogin() {
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    try {
      const redirectUrl = encodeURIComponent(window.location.pathname);

      const res = await fetch(`/api/auth/google?redirect=${redirectUrl}`);
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

      <button
        className="google-login-btn gsi-material-button"
        onClick={handleLogin}
      >
        <div className="gsi-material-button-content-wrapper">
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google logo"
          />
          <span className="gsi-material-button-contents">
            Sign in with Google
          </span>
        </div>
      </button>
    </>
  );
}
