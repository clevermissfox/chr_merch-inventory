import { useEffect, useRef, useState } from "react";
import { useAuth } from "~/context/AuthContext";
import { useCatalog } from "~/context/CatalogContext";

interface UserProfileDialogProps {
  onClose: () => void;
}

const roleLabel: Record<string, string> = {
  editor: "Editor",
  reader: "Viewer",
  none: "No Access",
};

export default function UserProfileDialog({ onClose }: UserProfileDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { user } = useAuth();
  const { state } = useCatalog();
  const wooSiteUrl = state.catalog?.summary.wooSiteUrl;
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
    <dialog ref={ref} className="dialog dialog-profile" onCancel={onClose}>
      <div className="card grid gap-1half dialog-profile-inner">
        <div className="row jc-sb ai-cen">
          <h2>Profile</h2>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <div className="row ai-cen gap-1">
          <div className="dialog-profile-avatar">
            {user.picture && !imgError ? (
              <img src={user.picture} alt="" onError={() => setImgError(true)} />
            ) : (
              <span className="bold clr-inverse">{userInitials}</span>
            )}
          </div>
          <div className="grid gap-quarter">
            <strong>{user.name}</strong>
            <span className="badge">{roleLabel[user.role] ?? user.role}</span>
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
            <i className="bi bi-bag" aria-hidden="true" />
            <span>Visit Shop</span>
          </a>
        )}

        <p className="small clr-muted">
          Need support?{" "}
          <a href="mailto:dev@cochiseharmreduction.org" className="underline">
            dev@cochiseharmreduction.org
          </a>
        </p>
      </div>
    </dialog>
  );
}
