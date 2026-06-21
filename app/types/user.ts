export interface AuthStatus {
  success: boolean;
  user: AuthUser | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  canEdit: boolean;
  role: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refreshAuth: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
}
