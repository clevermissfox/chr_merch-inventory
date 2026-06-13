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
      <div className="auth-loading">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (requireAuth && !user) {
    return (
      <div className="auth-page">
        <h1>Please sign in</h1>
        <BtnGoogleLogin />
      </div>
    );
  }

  return <>{children(user)}</>;
}
