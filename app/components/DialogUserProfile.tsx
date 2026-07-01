import { X, ShoppingBag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "~/context/AuthContext";
import { useCatalog } from "~/context/CatalogContext";

interface DialogUserProfileProps {
  onClose: () => void;
}

const roleLabel: Record<string, string> = {
  editor: "Editor",
  reader: "Viewer",
  none: "No Access",
};

export default function DialogUserProfile({ onClose }: DialogUserProfileProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { user } = useAuth();
  const { state } = useCatalog();
  const wooSiteUrl = state.catalog?.summary.wooSiteUrl;
  const devEmail = state.catalog?.summary.devEmail;
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  if (!user) return null;

  const userInitials =
    `${user.givenName?.slice(0, 1) ?? ""}${user.familyName?.slice(0, 1) ?? ""}` ||
    user.name?.slice(0, 1) ||
    "?";

  return (
    <dialog ref={ref} className="dialog dialog-profile card" onCancel={onClose}>
      <div className="grid gap-1half dialog-inner dialog-profile-inner">
        <div className="row jc-sb ai-cen">
          <h2>Profile</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="row ai-cen gap-1">
          <div className="dialog-profile-avatar">
            {user.picture && !imgError ? (
              <img
                src={user.picture}
                alt=""
                onError={() => setImgError(true)}
              />
            ) : (
              <span className="bold clr-inverse">{userInitials}</span>
            )}
          </div>
          <div className="grid gap-quarter">
            <strong>{user.name}</strong>
            <p className="badge">{roleLabel[user.role] ?? user.role}</p>
          </div>
        </div>

        <div className="grid gap-quarter">
          <label className="xsmall clr-muted" htmlFor="profile-email">
            Email
          </label>
          <input
            id="profile-email"
            className="profile-email"
            type="email"
            value={user.email}
            readOnly
            disabled
          />
        </div>

        {wooSiteUrl && (
          <a
            href={`${wooSiteUrl}/shop`}
            target="_blank"
            rel="noopener noreferrer"
            className="dialog-profile-shop-link"
          >
            <ShoppingBag aria-hidden="true" />
            <span>Visit Shop</span>
          </a>
        )}

        {devEmail && (
          <p className="small clr-muted">
            Need support?{" "}
            <a href={`mailto:${devEmail}`} className="underline">
              {devEmail}
            </a>
          </p>
        )}
      </div>
    </dialog>
  );
}
