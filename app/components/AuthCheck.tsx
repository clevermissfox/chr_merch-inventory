import { useState, useEffect } from "react";
import BtnGoogleLogin from "./BtnGoogleLogin";

interface User {
  email: string;
  canEdit: boolean;
  role: string;
}

interface AuthStatus {
  success: boolean;
  user: User | null;
  canEdit: boolean;
}

export default function AuthCheck({
  children,
  requireAuth = true,
}: {
  children: (user: User | null) => React.ReactNode;
  requireAuth?: boolean;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data: AuthStatus) => {
        if (data.success) {
          setUser(data.user);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to check auth:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <section className="card">
        <div className="auth-loading wrapper ta-cen">
          <h2>Loading...</h2>
        </div>
      </section>
    );
  }

  if (requireAuth && !user) {
    return (
      <section className="card">
        <div className="auth-page wrapper">
          <h1>Please sign in</h1>
          <BtnGoogleLogin />
        </div>
      </section>
    );
  }

  if (user && user.role === "none") {
    return (
      <section className="card">
        <div className="auth-page wrapper">
          <h1>Access Denied</h1>
          <p>
            Your account does not have permission to access this application.
          </p>
        </div>
      </section>
    );
  }

  return <>{children(user)}</>;
}
