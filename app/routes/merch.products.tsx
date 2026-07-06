import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { Route } from "./+types/merch.products";
import { useCatalog } from "~/context/CatalogContext";
import { useAuth } from "~/context/AuthContext";
import { useToast } from "~/context/ToastContext";
import DialogCreateProduct from "~/components/DialogCreateProduct";
import type { FormState as CreateProductFormState } from "~/components/DialogCreateProduct";
import DialogConfirm from "~/components/DialogConfirm";
import type { DialogConfirmStatus } from "~/components/DialogConfirm";
import DialogCreateVariant from "~/components/DialogCreateVariant";
import DialogDeleteVariant from "~/components/DialogDeleteVariant";
import DialogEditProduct from "~/components/DialogEditProduct";
import DialogEditVariant from "~/components/DialogEditVariant";
import SearchComponent from "~/components/SearchComponent";
import type { SearchResult } from "~/components/SearchComponent";
import type { CatalogGroup, CatalogPayload, CatalogRow } from "~/types/catalog";
import {
  ExternalLink,
  Globe,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch Hub | Products" },
    {
      name: "description",
      content:
        "Product-level merch management with nested descriptions and variants.",
    },
  ];
}

export const handle = {
  page: "products",
  title: "Catalog",
  eyebrow: "Manage products",
};

// The sheet's published_status is only what we last wrote there — it's
// allowed to drift from Woo's actual current status any time someone edits
// without also syncing (e.g. "Save" vs "Save & Sync"), so "has a wooId" is
// not the same as "currently live", and the sheet saying "draft" doesn't
// tell us whether Woo is still published. wooLiveStatus is the ground
// truth, fetched directly from Woo right before the confirm dialog opens —
// null means either there's no wooId yet, or the check itself failed
// (network error), in which case we fall back to asking the user
// explicitly rather than guessing wrong in either direction.
function getSyncMode(
  group: CatalogGroup,
  wooLiveStatus: string | null | "loading",
): "publish" | "confirmed" | "ambiguous-draft" | "loading" {
  // No Woo product exists at all yet — the only button available for this
  // case is literally labeled "Publish to site" (see getSyncButtonLabel), so
  // clicking it is unambiguous: it always means "make this live now,"
  // regardless of what the sheet's published_status currently says. It must
  // NOT resolve to "sync" here — that used to silently push a still-hidden
  // Woo copy without ever asking, which is exactly the bug where clicking
  // "Publish to site" on a never-synced draft left it a draft on Woo too.
  if (!group.wooId) return "publish";
  if (wooLiveStatus === "loading") return "loading";
  // Ground truth check itself failed — we genuinely don't know the current
  // status, so ask explicitly rather than assume either way.
  if (wooLiveStatus === null) return "ambiguous-draft";
  // Ground truth is known. Draft/published is purely a card-level decision
  // now (Edit Product never writes published_status), so the sheet's stored
  // value can't be trusted as "the" current state either — always resolve to
  // "confirmed" and let the dialog offer both "stay as-is, just sync" and
  // "flip to the opposite state," driven entirely by what Woo just reported.
  return "confirmed";
}

// Products Sync All would newly create in Woo for the first time if the
// "also publish unpublished products" checkbox is checked — the exact same
// isNew condition wooSyncManager.ts's buildWooParentPayload/
// buildWooVariationPayload use to decide whether to set stock at all.
// These are the ones that need a stock decision before going live, since
// Sync All (unlike the single-product publish flow) has never asked for
// one — it would otherwise silently default to 0/out-of-stock.
function getFirstPublishCandidates(catalog: CatalogPayload): CatalogGroup[] {
  return catalog.groups.filter(
    (g) => g.publishedStatus === "draft" && !g.wooId,
  );
}

function getSyncButtonLabel(group: CatalogGroup): string {
  // "Status" once a Woo product exists — this button doesn't always publish
  // or unpublish, it just as often reaffirms the current status or pushes
  // unsynced content, so "Publish status" overpromised what clicking it
  // does. "Publish to site" stays for the one case where that's literally
  // true: nothing exists in Woo yet.
  return group.wooId ? "Status" : "Publish to site";
}

// Ground truth fetch — null on no wooId, not-found, or a failed request
// (network error), all of which fall back to getSyncMode's safe
// "ambiguous-draft" path rather than assuming a status we don't actually
// know.
async function fetchWooLiveStatus(group: CatalogGroup): Promise<string | null> {
  if (!group.wooId) return null;
  try {
    const res = await fetch(
      `/api/catalog/product/${encodeURIComponent(group.sku)}/woo_status`,
      { credentials: "include" },
    );
    const data = await res.json();
    return data.ok ? (data.status ?? null) : null;
  } catch {
    return null;
  }
}

function PriceDisplay({
  price,
  sale,
}: {
  price: string | null;
  sale: string | null;
}) {
  if (!price) return <>—</>;
  if (!sale) return <>{price}</>;
  return (
    <>
      <s className="clr-muted">{price}</s>{" "}
      <span className="clr-info">{sale}</span>
    </>
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(str: string | null | undefined, len: number): string | null {
  if (!str) return null;
  const plain = stripHtml(str);
  return plain.length > len ? plain.slice(0, len) + "…" : plain || null;
}

interface ProductGroupProps {
  group: CatalogGroup;
  canEdit: boolean;
  wooSiteUrl?: string;
  onDeleteRequest: (group: CatalogGroup) => void;
  onAddVariantsRequest: (group: CatalogGroup) => void;
  onDeleteVariantRequest: (row: CatalogRow, group: CatalogGroup) => void;
  onEditVariantRequest: (row: CatalogRow, group: CatalogGroup) => void;
  onPublishRequest: (group: CatalogGroup) => void;
  onEditRequest: (group: CatalogGroup) => void;
}

function ProductGroup({
  group,
  canEdit,
  wooSiteUrl,
  onDeleteRequest,
  onAddVariantsRequest,
  onDeleteVariantRequest,
  onEditVariantRequest,
  onPublishRequest,
  onEditRequest,
}: ProductGroupProps) {
  const isSimple = group.rowCount === 0;

  return (
    <details
      id={`product-${group.productId}`}
      className="toggle-group product-group card"
    >
      <summary data-unsynced={group.contentUnsynced || undefined}>
        <div className="summary-title">
          <p className="row gap-half ai-cen fw-wrap">
            <strong>{group.displayName}</strong>
            <span className="summary-count">
              {isSimple
                ? "Simple product"
                : `${group.rowCount} SKU${group.rowCount !== 1 ? "s" : ""}`}
            </span>
            {!group.wooId || !group.lastHash ? (
              <span className="published-status-badge">Unpublished</span>
            ) : group.publishedStatus === "draft" ? (
              <span className="published-status-badge">Draft</span>
            ) : null}
            {group.contentUnsynced && (
              <span className="published-status-badge" data-tone="warning">
                Content unsynced
              </span>
            )}
          </p>
        </div>
        <span className="toggle-label">Toggle</span>
      </summary>

      <div className="product-body row fw-wrap-reverse gap-1 padding-b-three-fourths padding-i-1quarter">
        <div className="product-info flex-1 grid gap-1">
          <dl className="meta product-meta row fw-wrap">
            <div>
              <dt>SKU</dt>
              <dd>{group.sku}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>
                {group.category} · {group.subcategory}
              </dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>
                <PriceDisplay
                  price={group.basePriceDollars}
                  sale={group.salePriceDollars}
                />
              </dd>
            </div>
            {group.weightOz && (
              <div>
                <dt>Weight</dt>
                <dd>{group.weightOz}oz</dd>
              </div>
            )}
            {group.design && (
              <div>
                <dt>Design</dt>
                <dd>{group.design}</dd>
              </div>
            )}
            {group.dimensionsWidth && group.dimensionsHeight && (
              <div>
                <dt>Dimensions</dt>
                <dd>{group.dimensionsWidth + "x" + group.dimensionsHeight}</dd>
              </div>
            )}
            <div>
              <dt>Last synced</dt>
              <dd>
                {group.lastSyncedAt
                  ? new Date(group.lastSyncedAt).toLocaleString()
                  : "Never"}
              </dd>
            </div>
          </dl>

          {(group.primaryDescription || group.shortDescription) && (
            <dl className="meta product-meta product-desc col">
              {group.primaryDescription && (
                <div>
                  <dt>Description</dt>
                  <dd>{truncate(group.primaryDescription, 120)}</dd>
                </div>
              )}
              {group.shortDescription && (
                <div>
                  <dt>Short Description</dt>
                  <dd>{truncate(group.shortDescription, 120)}</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        <div className="product-actions-wrapper">
          <button
            type="button"
            className="btn-ghost padding-i-half"
            aria-label="Product actions"
            popoverTarget={`product-actions-${group.productId}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          <menu
            className="product-actions"
            popover="auto"
            id={`product-actions-${group.productId}`}
          >
            <button
              type="button"
              className={`btn-secondary row gap-half ai-cen ${group.contentUnsynced ? "btn-warning" : ""}`}
              onClick={() => onPublishRequest(group)}
              disabled={!canEdit}
            >
              <Globe aria-hidden="true" />
              <span>{getSyncButtonLabel(group)}</span>
            </button>
            {wooSiteUrl &&
              group.wooId &&
              group.publishedStatus === "publish" && (
                <a
                  className="pseudo-btn-secondary row gap-half ai-cen"
                  href={`${wooSiteUrl}/?post_type=product&p=${group.wooId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden="true" />
                  <span>View Product</span>
                </a>
              )}
            <button
              type="button"
              className="btn-secondary row gap-half ai-cen"
              onClick={() => onAddVariantsRequest(group)}
              disabled={!canEdit}
            >
              <Plus aria-hidden="true" />
              <span>Add Variants</span>
            </button>
            <button
              type="button"
              className="btn-secondary row gap-half ai-cen"
              onClick={() => onEditRequest(group)}
              disabled={!canEdit}
            >
              <Pencil aria-hidden="true" />
              <span>Edit</span>
            </button>
            <button
              type="button"
              className="btn-secondary btn-danger row gap-half ai-cen"
              onClick={() => onDeleteRequest(group)}
              disabled={!canEdit}
            >
              <Trash2 aria-hidden="true" />
              <span>Delete</span>
            </button>
          </menu>
        </div>
      </div>

      {!isSimple && (
        <details className="variants-group">
          <summary className="row ai-cen jc-sb gap-1 padding-b-three-fourths padding-i-1quarter">
            <span className="small">
              {group.rowCount} variant{group.rowCount !== 1 ? "s" : ""}
            </span>
            <span className="toggle-label small">Toggle</span>
          </summary>

          <div className="table-wrapper">
            <table className="data-table variants-table surface-tertiary">
              <colgroup>
                <col style={{ width: "fit-content" }}></col>
                <col style={{ width: "max(50%, 30ch)" }}></col>
                <col style={{ width: "fit-content" }}></col>
                <col style={{ width: "fit-content" }}></col>
                <col style={{ width: "max(50%, 30ch)" }}></col>
                <col style={{ width: "min-content" }}></col>
              </colgroup>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Details</th>
                  <th>Price</th>
                  <th>Weight (oz)</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.sku}>
                    <td className="sku-cell">{row.sku}</td>
                    <td>{row.label}</td>
                    <td>
                      <PriceDisplay
                        price={row.priceVariant || group.basePriceDollars}
                        sale={row.salePriceVariant || group.salePriceDollars}
                      />
                    </td>
                    <td className="ta-cen">
                      {row.weightOzVariant ?? row.baseWeightOz ?? "—"}
                    </td>
                    <td className="clr-muted">
                      {truncate(row.descriptionVariant, 30) ?? "—"}
                    </td>
                    <td className="variant-actions padding-i-half ">
                      <div className="grid gap-1 pc-cen">
                        <button
                          className="small"
                          type="button"
                          aria-label="Edit variant"
                          onClick={() =>
                            canEdit && onEditVariantRequest(row, group)
                          }
                          disabled={!canEdit}
                        >
                          <Pencil aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="small"
                          aria-label="Delete variant"
                          onClick={() =>
                            canEdit && onDeleteVariantRequest(row, group)
                          }
                          disabled={!canEdit}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </details>
  );
}

export default function ProductsPage() {
  const { state, loadCatalog } = useCatalog();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { catalog, loading, error } = state;
  const canEdit = user?.canEdit ?? false;
  const [searchParams] = useSearchParams();

  const [showCreate, setShowCreate] = useState(false);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [failedCreateFields, setFailedCreateFields] =
    useState<CreateProductFormState | null>(null);
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogGroup | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<DialogConfirmStatus>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingAddVariants, setPendingAddVariants] =
    useState<CatalogGroup | null>(null);
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<{
    row: CatalogRow;
    group: CatalogGroup;
  } | null>(null);
  const [pendingEditVariant, setPendingEditVariant] = useState<{
    row: CatalogRow;
    group: CatalogGroup;
  } | null>(null);
  type SyncRequest =
    | {
        type: "single";
        group: CatalogGroup;
        wooLiveStatus: string | null | "loading";
        // Set only by the convert-to-simple trigger below — always show the
        // stock form regardless of whether wooStock looks "already set,"
        // since a simple product's stock is meaningless until confirmed
        // fresh, but pre-fill (rather than blank) when a value already
        // exists so the ask is "keep this?" not "type something."
        forceStockPrompt?: boolean;
      }
    | { type: "all"; wooStatuses: Record<number, string> | "loading" };
  const [syncRequest, setSyncRequest] = useState<SyncRequest | null>(null);
  const [pendingSyncProductId, setPendingSyncProductId] = useState<
    string | null
  >(null);
  const [pendingConvertToSimpleId, setPendingConvertToSimpleId] = useState<
    string | null
  >(null);
  const [publishDrafts, setPublishDrafts] = useState(false);
  const [publishStatus, setPublishStatus] =
    useState<DialogConfirmStatus>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState<CatalogGroup | null>(null);
  const [lastEdited, setLastEdited] = useState<string | null>(null);
  // Mirrors pendingCreate's pattern: the edit dialog closes as soon as the
  // save+sync request is fired (not when it resolves), so a slow Woo call
  // doesn't leave the user staring at a blocked modal — this holds the SKU
  // for the page-level "Saving…" status while that request finishes in the
  // background. Unlike create, a failure here doesn't need to reopen the
  // dialog pre-filled: saveToSheet() always completes before the Woo sync
  // call, so a failure only ever means "saved, but the site push hiccuped,"
  // not "nothing happened, retype it."
  const [pendingEditSku, setPendingEditSku] = useState<string | null>(null);
  const [stockOverrides, setStockOverrides] = useState<Record<string, string>>(
    {},
  );
  const [pendingRelink, setPendingRelink] = useState<{
    group: CatalogGroup;
    trashedWooId: number;
  } | null>(null);
  const [relinkStatus, setRelinkStatus] = useState<DialogConfirmStatus>("idle");
  const [relinkError, setRelinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog && !loading) {
      loadCatalog();
    }
  }, []);

  // Deep-link support for arriving from elsewhere (e.g. the Inventory
  // page's "not synced to site" list) via ?highlight=<productId> — scrolls
  // to and expands that product's card so the user can review name, price,
  // image, and variants before deciding to publish, rather than acting
  // blind. Doesn't auto-open any dialog — just brings the card into view.
  useEffect(() => {
    const productId = searchParams.get("highlight");
    if (!productId || !catalog) return;
    const el = document.getElementById(`product-${productId}`);
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("product-group--highlighted");
      setTimeout(() => el.classList.remove("product-group--highlighted"), 2500);
    }
    // Strip the param via raw history, not setSearchParams — the latter is
    // a React Router navigation, and <ScrollRestoration /> in root.tsx
    // resets scroll to top on every RR navigation, which snapped the page
    // straight back up right as the scrollIntoView animation above started.
    const url = new URL(window.location.href);
    url.searchParams.delete("highlight");
    window.history.replaceState(null, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  // Opens the zero-stock sync-confirm dialog for a product once the catalog
  // reflects its post-write state (fresh row data, correct stock). Dialogs
  // that create/edit and then want to sync (Add & Sync, Save & Sync,
  // publish-on-create) request this instead of calling sync_to_site
  // themselves, so they all go through the same force-stock prompt as the
  // Products page's own sync button.
  useEffect(() => {
    // Wait for the in-flight reload to actually finish — loadCatalog() and
    // setPendingSyncProductId() are called back-to-back, so acting the
    // instant pendingSyncProductId is set would search the catalog from
    // before the write (missing the new/edited row entirely).
    if (!pendingSyncProductId || loading || !catalog) return;
    const freshGroup = catalog.groups.find(
      (g) => g.productId === pendingSyncProductId,
    );
    setPendingSyncProductId(null);
    if (freshGroup) {
      // Clear any stock values left over from a previous sync dialog in this
      // session — this path (delete-last-variant conversion, Add & Sync,
      // publish-on-create) opens a fresh force-stock prompt for a specific
      // product, and it must start blank rather than inheriting stale input
      // from whatever was last typed elsewhere.
      setStockOverrides({});
      setSyncRequest({
        type: "single",
        group: freshGroup,
        wooLiveStatus: "loading",
      });
      void fetchWooLiveStatus(freshGroup).then((wooLiveStatus) => {
        setSyncRequest((prev) =>
          prev?.type === "single" && prev.group.sku === freshGroup.sku
            ? { ...prev, wooLiveStatus }
            : prev,
        );
      });
    }
  }, [catalog, loading, pendingSyncProductId]);

  // Converting a product's last variant away (variable → simple) has its
  // own, stricter rule than the generic force-stock flow above:
  //   - no wooId at all (never published) — nothing exists in Woo to
  //     reconcile, so don't ask for stock or show any dialog at all; it's a
  //     sheet-only change and stays that way until the user chooses to sync.
  //   - has a wooId — always show the stock prompt before syncing, since a
  //     simple product's stock was tracked per-variation before and is not
  //     trustworthy now, but pre-fill whatever value already happens to be
  //     there (wooStock, else the sheet's stockQty) instead of blanking it,
  //     so the ask is "keep this?" rather than nagging for a number that
  //     might already be correct.
  useEffect(() => {
    if (!pendingConvertToSimpleId || loading || !catalog) return;
    const freshGroup = catalog.groups.find(
      (g) => g.productId === pendingConvertToSimpleId,
    );
    setPendingConvertToSimpleId(null);
    if (!freshGroup || !freshGroup.wooId) return;

    const existing = freshGroup.wooStock ?? freshGroup.stockQty;
    setStockOverrides({
      [freshGroup.sku]: existing != null ? String(existing) : "0",
    });
    setSyncRequest({
      type: "single",
      group: freshGroup,
      wooLiveStatus: "loading",
      forceStockPrompt: true,
    });
    void fetchWooLiveStatus(freshGroup).then((wooLiveStatus) => {
      setSyncRequest((prev) =>
        prev?.type === "single" && prev.group.sku === freshGroup.sku
          ? { ...prev, wooLiveStatus }
          : prev,
      );
    });
  }, [catalog, loading, pendingConvertToSimpleId]);

  const handlePending = () => {
    setShowCreate(false);
    setPendingCreate(true);
    setCreateError(null);
    setLastCreated(null);
    setLastDeleted(null);
    setLastEdited(null);
  };

  const handleFailed = (error: string, failedForm: CreateProductFormState) => {
    setPendingCreate(false);
    setCreateError(error);
    showToast(`Create failed — ${error}`, "error");
    // The backend rolls back the incomplete row on failure — reopen the
    // dialog pre-filled with exactly what was submitted so the user can
    // review/adjust and retry without retyping everything from scratch.
    setFailedCreateFields(failedForm);
    setShowCreate(true);
  };

  const handleCreated = (sku: string) => {
    setPendingCreate(false);
    setCreateError(null);
    setFailedCreateFields(null);
    setLastCreated(`Created — new SKU: ${sku}`);
    setLastDeleted(null);
    setLastEdited(null);
    showToast(`Created — new SKU: ${sku}`, "success");
    loadCatalog();
  };

  const performDeleteProduct = async (group: CatalogGroup): Promise<void> => {
    const res = await fetch(
      `/api/catalog/product/${encodeURIComponent(group.sku)}`,
      { method: "DELETE", credentials: "include" },
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Delete failed");
    setLastDeleted(group.sku);
    setLastCreated(null);
    setLastEdited(null);
    showToast(`Deleted — SKU: ${group.sku}`, "success");
    await loadCatalog();
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setDeleteStatus("confirming");
    setDeleteError(null);
    try {
      await performDeleteProduct(pendingDelete);
      setPendingDelete(null);
      setDeleteStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setDeleteError(message);
      showToast(`Delete failed — ${message}`, "error");
      setDeleteStatus("idle");
    }
  };

  // publishTarget is the decided end state for this sync, always driven by
  // ground truth (Woo's real status), never the sheet's stored value:
  //   - mode "publish" (no wooId yet): always true, no choice involved.
  //   - mode "confirmed" (wooId exists, Woo status known): the dialog's
  //     primary button passes the CURRENT known status (stay as-is, just
  //     sync content); the secondary button passes the opposite (the
  //     explicit "Unpublish"/"Publish" flip).
  //   - mode "ambiguous-draft" (ground truth check failed): "Publish"
  //     passes true, "Keep as Draft, sync changes" passes false.
  // Sync All doesn't use this at all (undefined) — it has its own
  // publishDrafts checkbox.
  const handlePublishConfirm = async (publishTarget?: boolean) => {
    if (!syncRequest) return;
    setPublishStatus("confirming");
    setPublishError(null);
    try {
      // Always reaffirm the sheet's published_status to match the decided
      // target before syncing — the sheet's stored value can't be trusted
      // (Edit Product never writes it after creation), so every sync is a
      // chance to self-heal it to whatever was actually just decided/known.
      if (syncRequest.type === "single" && publishTarget !== undefined) {
        const desired = publishTarget ? "publish" : "draft";
        if (syncRequest.group.publishedStatus !== desired) {
          const updateRes = await fetch(
            `/api/catalog/product/${encodeURIComponent(syncRequest.group.sku)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ publishedStatus: desired }),
            },
          );
          const updateData = await updateRes.json();
          if (!updateData.ok)
            throw new Error(
              updateData.error || "Failed to update published status",
            );
        }
      }

      // Sync All's "publish drafts" checkbox only ever gated whether these
      // never-published products get skipped entirely — it never actually
      // flipped their published_status to "publish", so they synced as
      // still-draft. Reaffirm status for each candidate first, same as the
      // single-product flow above.
      if (syncRequest.type === "all" && publishDrafts && catalog) {
        const candidates = getFirstPublishCandidates(catalog);
        await Promise.all(
          candidates.map(async (g) => {
            const updateRes = await fetch(
              `/api/catalog/product/${encodeURIComponent(g.sku)}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ publishedStatus: "publish" }),
              },
            );
            const updateData = await updateRes.json();
            if (!updateData.ok)
              throw new Error(
                updateData.error ||
                  `Failed to update published status for ${g.sku}`,
              );
          }),
        );
      }

      // Convert string inputs to numbers, dropping blanks/zeros. stockOverrides
      // is one piece of state shared across every sync dialog the page can
      // open in a session — it's only ever cleared when a NEW dialog opens
      // (see the sync-request openers below), never scoped by itself. Without
      // filtering to the SKUs this specific request actually covers, a stale
      // entry left over from an earlier product/variant (e.g. one that has
      // since been deleted, like a variant removed by a simple-product
      // conversion) would still get sent here and silently resurrect an
      // inventory_index row for a SKU that no longer has anything else
      // referencing it.
      // Sync All only ever needs stock overrides for products it's about to
      // publish for the first time (see getFirstPublishCandidates) — an
      // already-published or still-intentionally-unpublished product has no
      // reason to have its stock touched by this dialog.
      const relevantSkus =
        syncRequest.type === "single"
          ? new Set([
              syncRequest.group.sku,
              ...syncRequest.group.rows.map((r) => r.sku),
            ])
          : publishDrafts && catalog
            ? new Set(
                getFirstPublishCandidates(catalog).flatMap((g) => [
                  g.sku,
                  ...g.rows.map((r) => r.sku),
                ]),
              )
            : new Set<string>();
      const parsedOverrides = Object.fromEntries(
        Object.entries(stockOverrides)
          .filter(([sku]) => relevantSkus.has(sku))
          .map(([sku, v]) => [sku, parseInt(v, 10)])
          .filter(([, n]) => Number.isFinite(n) && (n as number) > 0),
      );

      // Sync All's skipUnchanged relies on the sheet's own content hash,
      // which can never see status drift (sheet didn't change, only Woo's
      // actual status did — e.g. a manual wp-admin publish/unpublish). The
      // ground-truth check that drives this dialog's warning text already
      // knows which products drifted; those have to be force-synced or
      // they'd get silently skipped as "unchanged" despite needing a fix.
      const forceProductIds =
        syncRequest.type === "all" &&
        catalog &&
        syncRequest.wooStatuses !== "loading"
          ? catalog.groups
              .filter((g) => {
                if (!g.wooId) return false;
                const wooStatus = syncRequest.wooStatuses[Number(g.wooId)];
                if (wooStatus === undefined) return false;
                const sheetWantsDraft =
                  !g.publishedStatus || g.publishedStatus === "draft";
                return sheetWantsDraft
                  ? wooStatus === "publish"
                  : wooStatus !== "publish";
              })
              .map((g) => g.productId)
          : [];

      const body =
        syncRequest.type === "single"
          ? {
              mode: "selected" as const,
              productIds: [syncRequest.group.productId],
              publish: publishTarget === true,
              ...(Object.keys(parsedOverrides).length
                ? { stockOverrides: parsedOverrides }
                : {}),
            }
          : {
              mode: "sync_all" as const,
              publish: publishDrafts,
              ...(Object.keys(parsedOverrides).length
                ? { stockOverrides: parsedOverrides }
                : {}),
              ...(forceProductIds.length ? { forceProductIds } : {}),
            };

      const res = await fetch("/api/catalog/sync_to_site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Sync failed");

      let summary: string;
      if (syncRequest.type === "single") {
        const result = data.results?.[0];
        if (!result || result.status === "failed") {
          throw new Error(result?.error || "Sync failed");
        }
        if (result.status === "sku_collision_trashed") {
          setPendingRelink({
            group: syncRequest.group,
            trashedWooId: result.trashedWooId as number,
          });
          setSyncRequest(null);
          setPublishStatus("idle");
          return;
        }
        // Includes a timestamp — without it, syncing the same product twice
        // in a row produces the exact same string both times, so a stale
        // leftover message from 10 minutes ago is indistinguishable from one
        // that just happened.
        summary = `Synced to site — ${syncRequest.group.sku} at ${new Date().toLocaleTimeString()}`;
      } else {
        const parts = [`${data.syncedCount} synced`];
        if (data.skippedUnchangedCount)
          parts.push(`${data.skippedUnchangedCount} unchanged`);
        if (data.skippedDraftCount)
          parts.push(`${data.skippedDraftCount} drafts skipped`);
        if (data.failedCount) parts.push(`${data.failedCount} failed`);
        summary = `Sync all complete — ${parts.join(", ")}`;
        if (data.failedCount) {
          const firstFailure = (
            data.results as Array<{
              status: string;
              sku: string;
              error?: string;
            }>
          ).find((r) => r.status === "failed");
          if (firstFailure) {
            throw new Error(
              `${summary}. First failure (${firstFailure.sku}): ${firstFailure.error}`,
            );
          }
        }
      }

      setPublishStatus("success");
      setLastSynced(summary);
      setLastCreated(null);
      setLastDeleted(null);
      setLastEdited(null);
      showToast(summary, "success");
      await loadCatalog();
      setSyncRequest(null);
      setPublishStatus("idle");
      setPublishDrafts(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setPublishError(message);
      showToast(`Sync failed — ${message}`, "error");
      setPublishStatus("idle");
    }
  };

  const handleRelinkConfirm = async () => {
    if (!pendingRelink) return;
    setRelinkStatus("confirming");
    setRelinkError(null);
    try {
      const { group, trashedWooId } = pendingRelink;
      const setRes = await fetch(
        `/api/catalog/product/${encodeURIComponent(group.sku)}/set_woo_id`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ wooId: trashedWooId }),
        },
      );
      const setData = await setRes.json();
      if (!setData.ok)
        throw new Error(setData.error || "Failed to save woo_id");

      const syncRes = await fetch("/api/catalog/sync_to_site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "selected",
          productIds: [group.productId],
          publish: group.publishedStatus !== "draft",
        }),
      });
      const syncData = await syncRes.json();
      if (!syncData.ok) throw new Error(syncData.error || "Sync failed");
      const result = syncData.results?.[0];
      if (!result || result.status === "failed") {
        throw new Error(result?.error || "Sync failed after relink");
      }

      setRelinkStatus("success");
      setLastSynced(`Relinked and synced — ${group.sku}`);
      setLastCreated(null);
      setLastDeleted(null);
      setLastEdited(null);
      showToast(`Relinked and synced — ${group.sku}`, "success");
      await loadCatalog();
      setPendingRelink(null);
      setRelinkStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setRelinkError(message);
      showToast(`Relink failed — ${message}`, "error");
      setRelinkStatus("idle");
    }
  };

  const statusMessage = loading
    ? "Loading catalog…"
    : pendingCreate
      ? "Creating product… this may take a minute"
      : pendingEditSku
        ? `Saving ${pendingEditSku}… this may take a minute`
        : createError
          ? `Create failed — ${createError}`
          : lastCreated
            ? lastCreated
            : lastDeleted
              ? `Deleted — SKU: ${lastDeleted}`
              : lastSynced
                ? lastSynced
                : lastEdited
                  ? `Saved — ${lastEdited}`
                  : error
                    ? error
                    : catalog
                      ? `${catalog.summary.productCount} products · ${catalog.summary.rowCount} variants`
                      : "";

  // Mirrors statusMessage's own priority order — an action that actually
  // succeeded (lastCreated/lastDeleted/lastSynced/lastEdited) must win over
  // `error`, which is just whatever the catalog's own background reload
  // last reported. Without this, a create that succeeds but happens to
  // trigger a reload that fails (e.g. offline right after) showed the
  // correct "Created — new SKU: X" text in red, as if the create itself
  // had failed — createError (the create's own failure) still takes
  // priority over everything, since that's a real failure of the action.
  const statusTone = createError
    ? "error"
    : pendingCreate || pendingEditSku
      ? "loading"
      : loading
        ? "loading"
        : lastCreated || lastDeleted || lastSynced || lastEdited
          ? "success"
          : error
            ? "error"
            : undefined;

  return (
    <>
      <section className="toolbar card grid gap-1">
        {catalog && canEdit && (
          <SearchComponent
            groups={catalog.groups}
            label="Find a product or variant to edit"
            placeholder="e.g. black small, CLO, CHR-TEE-0001"
            alwaysIncludeMatchedGroup
            onSelect={(result: SearchResult) => {
              if (result.kind === "row") {
                setPendingEditVariant({ row: result.row, group: result.group });
              } else {
                setPendingEdit(result.group);
              }
            }}
            renderResult={(result) => {
              if (result.kind === "row") {
                return (
                  <span className="search-result-row">
                    <span className="search-result-row__context">
                      {result.group.displayName}
                    </span>
                    <span className="search-result-row__sku">
                      {result.row.sku}
                    </span>
                    <span className="search-result-row__label clr-muted">
                      {result.row.variantDetails || result.row.label}
                    </span>
                  </span>
                );
              }
              return (
                <span className="search-result-row">
                  <span className="search-result-row__context">
                    {result.group.displayName}
                  </span>
                  <span className="search-result-row__sku">
                    {result.group.sku}
                  </span>
                  <span className="search-result-row__label clr-muted">
                    {result.group.rowCount > 0
                      ? `${result.group.rowCount} variant${result.group.rowCount !== 1 ? "s" : ""}`
                      : "Simple product"}
                  </span>
                </span>
              );
            }}
          />
        )}
        <div className="row gap-1 jc-sb ai-cen fw-wrap">
          <div className="row gap-1 ai-cen fw-wrap">
            <p
              className="status-line"
              role={statusTone === "error" ? "alert" : "status"}
              data-tone={statusTone ?? (loading ? "loading" : "")}
            >
              {statusMessage}
            </p>
            {!loading &&
              catalog &&
              catalog.summary.contentUnsyncedCount > 0 && (
                <p className="status-line" data-tone="warning">
                  {catalog.summary.contentUnsyncedCount} product
                  {catalog.summary.contentUnsyncedCount !== 1 ? "s" : ""} with
                  unsynced content
                </p>
              )}
          </div>

          <div className="row gap-1 fw-wrap ai-cen">
            <button
              type="button"
              className="btn-secondary btn-lg row gap-half ai-cen"
              onClick={() => loadCatalog()}
              disabled={loading}
            >
              <RefreshCw aria-hidden="true" />
              <span>Refresh</span>
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-secondary btn-lg row gap-half ai-cen"
                onClick={() => {
                  setFailedCreateFields(null);
                  setShowCreate(true);
                }}
                disabled={loading}
              >
                <Plus aria-hidden="true" />
                <span>New Product</span>
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn-primary btn-lg row gap-half ai-cen"
                onClick={async () => {
                  setPublishDrafts(false);
                  setStockOverrides({});
                  setPublishStatus("idle");
                  setPublishError(null);
                  setLastCreated(null);
                  setLastDeleted(null);
                  setLastEdited(null);
                  // Check every wooId'd product's ground truth, not just
                  // ones the sheet currently marks draft — the sheet's
                  // published_status can drift in either direction (e.g. a
                  // product manually unpublished in wp-admin while the sheet
                  // still says "publish"), and only checking sheet-drafts
                  // would silently miss that direction of drift entirely.
                  const allWooIds = (catalog?.groups ?? [])
                    .filter((g) => g.wooId)
                    .map((g) => Number(g.wooId));
                  setSyncRequest({ type: "all", wooStatuses: "loading" });
                  let wooStatuses: Record<number, string> = {};
                  if (allWooIds.length) {
                    try {
                      const res = await fetch("/api/catalog/woo_statuses", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ wooIds: allWooIds }),
                      });
                      const data = await res.json();
                      if (data.ok) wooStatuses = data.statuses;
                    } catch {
                      // Leave wooStatuses empty — those products just won't
                      // be counted as confirmed-live below, same as any
                      // other status we couldn't confirm.
                    }
                  }
                  setSyncRequest((prev) =>
                    prev?.type === "all" ? { type: "all", wooStatuses } : prev,
                  );
                }}
                disabled={loading || !catalog?.groups.length}
              >
                <Globe aria-hidden="true" />
                <span>Sync All</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {catalog && (
        <section className="grid gap-1">
          {catalog.groups.map((group) => (
            <ProductGroup
              key={group.productId}
              group={group}
              canEdit={canEdit}
              wooSiteUrl={catalog.summary.wooSiteUrl}
              onDeleteRequest={setPendingDelete}
              onAddVariantsRequest={setPendingAddVariants}
              onDeleteVariantRequest={(row, grp) =>
                setPendingDeleteVariant({ row, group: grp })
              }
              onEditVariantRequest={(row, grp) =>
                setPendingEditVariant({ row, group: grp })
              }
              onPublishRequest={async (grp) => {
                setPublishStatus("idle");
                setPublishError(null);
                setLastCreated(null);
                setLastDeleted(null);
                setLastSynced(null);
                setStockOverrides({});
                setSyncRequest({
                  type: "single",
                  group: grp,
                  wooLiveStatus: "loading",
                });
                const wooLiveStatus = await fetchWooLiveStatus(grp);
                setSyncRequest((prev) =>
                  prev?.type === "single" && prev.group.sku === grp.sku
                    ? { ...prev, wooLiveStatus }
                    : prev,
                );
              }}
              onEditRequest={setPendingEdit}
            />
          ))}
        </section>
      )}

      {pendingEdit && (
        <DialogEditProduct
          // Forces a full unmount/remount if pendingEdit is ever reassigned
          // to a different product while already open (e.g. two edit
          // triggers landing back-to-back) instead of reusing the same
          // instance — the dialog's dirty-tracking (`original` ref +
          // `form` state) only initializes once per mount, so without this
          // key a reused instance would keep comparing the new product
          // against the PREVIOUS product's original values, which is
          // exactly the kind of "sometimes opens already dirty" bug this
          // is meant to rule out.
          key={pendingEdit.sku}
          group={pendingEdit}
          onClose={() => setPendingEdit(null)}
          onPending={() => {
            setPendingEditSku(pendingEdit.sku);
            setPendingEdit(null);
          }}
          onSaved={() => {
            // Captures `pendingEdit.sku` directly (this closure's own render
            // still has the non-null pendingEdit reference) rather than
            // reading the `pendingEditSku` state var, which onPending just
            // scheduled an update for — that update hasn't landed yet by the
            // time this closure was created, so it'd still read stale/null.
            const sku = pendingEdit.sku;
            setPendingEditSku(null);
            setLastCreated(null);
            setLastDeleted(null);
            setLastEdited(sku);
            showToast(`Synced — ${sku}`, "success");
            loadCatalog();
          }}
          onFailed={(errorMessage) => {
            const sku = pendingEdit.sku;
            setPendingEditSku(null);
            showToast(
              `Saved ${sku}, but syncing to the site failed — ${errorMessage}. Try Sync from the card.`,
              "warning",
            );
            loadCatalog();
          }}
        />
      )}

      {pendingEditVariant && (
        <DialogEditVariant
          // Same reasoning as DialogEditProduct's key above.
          key={pendingEditVariant.row.sku}
          row={pendingEditVariant.row}
          group={pendingEditVariant.group}
          onClose={() => setPendingEditVariant(null)}
          onPending={() => {
            setPendingEditSku(pendingEditVariant.row.sku);
            setPendingEditVariant(null);
          }}
          onSaved={async () => {
            const sku = pendingEditVariant.row.sku;
            setPendingEditSku(null);
            setLastCreated(null);
            setLastDeleted(null);
            setLastEdited(sku);
            showToast(`Saved — ${sku}`, "success");
            await loadCatalog();
          }}
          onFailed={(errorMessage) => {
            const sku = pendingEditVariant.row.sku;
            setPendingEditSku(null);
            showToast(
              `Saved ${sku}, but syncing to the site failed — ${errorMessage}. Try Sync from the card.`,
              "warning",
            );
            loadCatalog();
          }}
        />
      )}

      {showCreate && (
        <DialogCreateProduct
          onClose={() => {
            setShowCreate(false);
            setFailedCreateFields(null);
          }}
          onCreated={handleCreated}
          onPending={handlePending}
          onFailed={handleFailed}
          initialValues={failedCreateFields ?? undefined}
        />
      )}

      {pendingAddVariants && (
        <DialogCreateVariant
          group={pendingAddVariants}
          onClose={() => setPendingAddVariants(null)}
          onCreated={(skus) => {
            setPendingAddVariants(null);
            setLastCreated(
              skus.length === 1
                ? `Created — new SKU: ${skus[0]}`
                : skus.length > 0
                  ? `Created ${skus.length} new variants`
                  : null,
            );
            setLastDeleted(null);
            showToast(
              skus.length === 1
                ? `Created — new SKU: ${skus[0]}`
                : `Created ${skus.length} new variants`,
              "success",
            );
            loadCatalog();
          }}
          onCreatedThenSync={(skus) => {
            const productId = pendingAddVariants.productId;
            setPendingAddVariants(null);
            setLastCreated(
              skus.length === 1
                ? `Created — new SKU: ${skus[0]}`
                : skus.length > 0
                  ? `Created ${skus.length} new variants`
                  : null,
            );
            setLastDeleted(null);
            showToast(
              skus.length === 1
                ? `Created — new SKU: ${skus[0]}`
                : `Created ${skus.length} new variants`,
              "success",
            );
            loadCatalog();
            setPendingSyncProductId(productId);
          }}
        />
      )}

      {pendingDeleteVariant && (
        <DialogDeleteVariant
          row={pendingDeleteVariant.row}
          group={pendingDeleteVariant.group}
          onClose={() => setPendingDeleteVariant(null)}
          onDeleted={async (sku, convertedToSimpleProductId) => {
            setLastDeleted(sku);
            setLastCreated(null);
            setLastEdited(null);
            showToast(`Deleted — SKU: ${sku}`, "success");
            await loadCatalog();
            setPendingDeleteVariant(null);
            if (convertedToSimpleProductId) {
              // Dedicated trigger, not the generic pendingSyncProductId flow
              // — this one skips the dialog entirely when the parent has no
              // wooId (nothing to reconcile), and always shows/pre-fills the
              // stock field when it does. See the effect's own comment.
              setPendingConvertToSimpleId(convertedToSimpleProductId);
            }
          }}
          onDeleteProduct={async (group) => {
            await performDeleteProduct(group);
            setPendingDeleteVariant(null);
          }}
        />
      )}

      {pendingDelete && (
        <DialogConfirm
          title="Delete product?"
          confirmIcon={<Trash2 aria-hidden="true" />}
          confirmLabel="Delete"
          confirmingLabel="Deleting…"
          confirmVariant="danger"
          status={deleteStatus}
          successMessage="Deleted — reloading catalog…"
          error={deleteError}
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => setPendingDelete(null)}
        >
          <p className="small">
            <strong>{pendingDelete.displayName}</strong>
            <span className="clr-muted"> · {pendingDelete.sku}</span>
          </p>
          <p className="small clr-muted">
            This will permanently remove the product
            {pendingDelete.rowCount > 0
              ? `, its ${pendingDelete.rowCount} variant${pendingDelete.rowCount !== 1 ? "s" : ""},`
              : ","}{" "}
            its descriptions, and its inventory entries from the sheet.
          </p>
          {pendingDelete.wooId && (
            <p className="small clr-warning">
              This product will also be permanently deleted from WooCommerce.
            </p>
          )}
        </DialogConfirm>
      )}

      {syncRequest?.type === "single" &&
        (() => {
          const mode = getSyncMode(
            syncRequest.group,
            syncRequest.wooLiveStatus,
          );
          const isAmbiguous = mode === "ambiguous-draft";
          const isChecking = mode === "loading";
          const isConfirmed = mode === "confirmed";
          const isCurrentlyLive =
            isConfirmed && syncRequest.wooLiveStatus === "publish";
          // Any path whose outcome is "goes/stays live" needs the no-image
          // warning: first publish, the ambiguous fallback's publish choice,
          // or confirmed-mode's secondary flip when currently hidden.
          const canGoLive =
            mode === "publish" ||
            isAmbiguous ||
            (isConfirmed && !isCurrentlyLive);
          // Content already auto-syncs on every edit (Edit Product/Variant,
          // Add Variants) — by the time this dialog opens there's usually
          // nothing new to push, so "Sync changes" as the primary label is
          // misleading outside two cases where it's actually true: a stock
          // decision is being made (new/never-confirmed rows), or the sheet
          // shows content changed since the last sync (contentUnsynced) —
          // e.g. edited directly on the sheet rather than through Edit
          // Product/Variant, which is the one path that bypasses the normal
          // auto-sync-on-save. In every other confirmed-mode case, the
          // primary action is really just "reaffirm the current status,"
          // not "sync."
          const isSimple = syncRequest.group.rowCount === 0;
          const hasZeroStock =
            syncRequest.type === "single" &&
            (syncRequest.forceStockPrompt ||
              (isSimple
                ? syncRequest.group.wooStock == null
                : syncRequest.group.rows.some((r) => r.wooStock == null)));
          const hasUnsyncedContent =
            syncRequest.type === "single" && syncRequest.group.contentUnsynced;
          const showSyncLabel = hasZeroStock || hasUnsyncedContent;

          return (
            <DialogConfirm
              title={
                isChecking
                  ? "Checking current site status…"
                  : mode === "publish"
                    ? "Publish this product?"
                    : isAmbiguous
                      ? "Couldn't confirm the site's current status"
                      : showSyncLabel
                        ? "Sync changes to the site?"
                        : isCurrentlyLive
                          ? "Keep this product published?"
                          : "Keep this product as a draft?"
              }
              confirmIcon={<Globe aria-hidden="true" />}
              confirmLabel={
                isChecking
                  ? "Checking…"
                  : mode === "publish"
                    ? "Publish"
                    : isAmbiguous
                      ? "Publish"
                      : showSyncLabel
                        ? "Sync changes"
                        : isCurrentlyLive
                          ? "Keep it Published"
                          : "Keep it Draft"
              }
              confirmingLabel={
                mode === "publish" || isAmbiguous ? "Publishing…" : "Syncing…"
              }
              confirmVariant="primary"
              confirmDisabled={isChecking}
              status={publishStatus}
              successMessage="Synced — reloading catalog…"
              error={publishError}
              onConfirm={() =>
                void handlePublishConfirm(
                  mode === "publish" || isAmbiguous
                    ? true
                    : isConfirmed
                      ? isCurrentlyLive
                      : undefined,
                )
              }
              onCancel={() => setSyncRequest(null)}
              secondaryLabel={
                isAmbiguous
                  ? "Keep as Draft, sync changes"
                  : isConfirmed
                    ? isCurrentlyLive
                      ? "Unpublish"
                      : "Publish"
                    : undefined
              }
              secondaryIcon={
                isAmbiguous || isConfirmed ? (
                  <RefreshCw aria-hidden="true" />
                ) : undefined
              }
              secondaryConfirmingLabel={
                isAmbiguous
                  ? "Syncing…"
                  : isCurrentlyLive
                    ? "Unpublishing…"
                    : "Publishing…"
              }
              onSecondary={
                isAmbiguous
                  ? () => void handlePublishConfirm(false)
                  : isConfirmed
                    ? () => void handlePublishConfirm(!isCurrentlyLive)
                    : undefined
              }
            >
              <p className="small">
                <strong>{syncRequest.group.displayName}</strong>
                <span className="clr-muted"> · {syncRequest.group.sku}</span>
              </p>
              {isChecking && (
                <p className="small clr-muted">
                  Checking WooCommerce for this product's current status…
                </p>
              )}
              {mode === "publish" && (
                <p className="small clr-muted">
                  This product has never been published to site. Publish it to
                  make it visible on the site.
                </p>
              )}
              {isConfirmed && (
                <p className="small clr-muted">
                  Currently{" "}
                  <strong>{isCurrentlyLive ? "Published" : "Draft"}</strong> on
                  the site. <strong>Both</strong> options below push your latest
                  name, description, price, sale price, category, subcategory,
                  dimensions, and child variants to WooCommerce —{" "}
                  {isCurrentlyLive
                    ? "they only differ on whether it stays published or goes offline afterward."
                    : "they only differ on whether it stays hidden or goes live afterward."}
                </p>
              )}
              {isAmbiguous && (
                <p className="small clr-muted">
                  We couldn't confirm WooCommerce's current status for this
                  product (the check itself failed). <strong>Either</strong>{" "}
                  option will sync your changes — choose{" "}
                  <strong>Publish</strong> to also make it visible on the site,
                  or <strong>Keep as Draft</strong> to leave it hidden.
                </p>
              )}
              {canGoLive && (
                <p className="xsmall clr-info">
                  Images are added manually by dev after processing — if this
                  product doesn't have one on the site yet, publishing will make
                  it visible with no image until that's done.
                </p>
              )}
              {!isChecking &&
                (() => {
                  if (!hasZeroStock) return null;
                  const existingStock = isSimple
                    ? (syncRequest.group.wooStock ?? syncRequest.group.stockQty)
                    : null;
                  return isSimple ? (
                    <form>
                      <div className="form-group">
                        <label
                          className="bold small"
                          htmlFor="stock-patch-simple"
                        >
                          Initial stock
                        </label>
                        <p className="xsmall clr-warning">
                          {existingStock != null
                            ? "This product already shows a stock quantity below — confirm it's still correct before syncing."
                            : "No stock set — will sync as out of stock unless you enter a quantity below."}
                        </p>
                        <input
                          id="stock-patch-simple"
                          type="number"
                          min="0"
                          step="1"
                          value={stockOverrides[syncRequest.group.sku] ?? "0"}
                          onChange={(e) =>
                            setStockOverrides((prev) => ({
                              ...prev,
                              [syncRequest.group.sku]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) =>
                            (e.key === "-" || e.key === "e" || e.key === ".") &&
                            e.preventDefault()
                          }
                        />
                      </div>
                    </form>
                  ) : (
                    <form>
                      <div className="form-group">
                        <p className="bold small">Stock per variant</p>
                        <p className="xsmall clr-muted">
                          Some variants have no stock — they'll sync as out of
                          stock unless you set quantities below.
                        </p>
                        <ul
                          className="grid gap-quarter stock-variant-list"
                          role="list"
                        >
                          {syncRequest.group.rows
                            .filter((r) => r.wooStock == null)
                            .map((r) => (
                              <li
                                key={r.sku}
                                className="row gap-1 ai-cen padding-b-half border-be  border-soft stock-variant-item"
                              >
                                <label
                                  className="flex-1"
                                  htmlFor={`stock-variant-${r.sku}`}
                                >
                                  {r.label ?? r.sku}
                                </label>
                                <input
                                  id={`stock-variant-${r.sku}`}
                                  type="number"
                                  min="0"
                                  step="1"
                                  className="stock-variant-input"
                                  value={stockOverrides[r.sku] ?? "0"}
                                  onChange={(e) =>
                                    setStockOverrides((prev) => ({
                                      ...prev,
                                      [r.sku]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) =>
                                    (e.key === "-" ||
                                      e.key === "e" ||
                                      e.key === ".") &&
                                    e.preventDefault()
                                  }
                                />
                              </li>
                            ))}
                        </ul>
                      </div>
                    </form>
                  );
                })()}
            </DialogConfirm>
          );
        })()}

      {pendingRelink && (
        <DialogConfirm
          title="Relink to existing WooCommerce product?"
          confirmIcon={<Globe aria-hidden="true" />}
          confirmLabel="Relink & sync"
          confirmingLabel="Relinking…"
          confirmVariant="primary"
          status={relinkStatus}
          successMessage="Relinked — reloading catalog…"
          error={relinkError}
          onConfirm={() => void handleRelinkConfirm()}
          onCancel={() => setPendingRelink(null)}
        >
          <p className="small">
            A <strong>{pendingRelink.group.displayName}</strong> product with
            this SKU already exists in WooCommerce (id{" "}
            <strong>{pendingRelink.trashedWooId}</strong>) but is trashed or not
            published.
          </p>
          <p className="small clr-muted">
            Relinking will restore it and overwrite it with the current sheet
            data. To start completely fresh instead, permanently delete it from
            WooCommerce Trash first, then sync again.
          </p>
        </DialogConfirm>
      )}

      {syncRequest?.type === "all" &&
        catalog &&
        (() => {
          const totalCount = catalog.groups.length;
          // The sheet's own published_status column doesn't distinguish
          // Unpublished from Draft (see README's "Publish state vocabulary")
          // — both read "draft" there. Split it here so the two counts below
          // use the right term for each: no wooId at all is Unpublished
          // (nothing in Woo to reconcile); a wooId whose live Woo status
          // Woo itself confirms is still "publish" is the ground-truth
          // republish/unpublish-drift case, unrelated to Unpublished.
          const sheetSaysDraft = catalog.groups.filter(
            (g) => g.publishedStatus === "draft",
          );
          const unpublishedGroups = getFirstPublishCandidates(catalog);
          const unpublishedCount = unpublishedGroups.length;
          const isChecking = syncRequest.wooStatuses === "loading";
          const wooStatuses = isChecking ? {} : syncRequest.wooStatuses;
          // Ground truth: only count products Woo directly confirms are
          // still "publish" — syncing them with the sheet's draft status
          // will actually take them offline.
          const unpublishCount = sheetSaysDraft.filter(
            (g) => g.wooId && wooStatuses[Number(g.wooId)] === "publish",
          ).length;
          // Mirror-image drift: the sheet says published, but Woo confirms
          // it's actually NOT currently live (e.g. manually unpublished in
          // wp-admin) — a routine sync always re-asserts the sheet's status,
          // so this silently republishes it unless surfaced here first.
          const republishCount = catalog.groups.filter(
            (g) =>
              g.wooId &&
              g.publishedStatus !== "draft" &&
              wooStatuses[Number(g.wooId)] !== undefined &&
              wooStatuses[Number(g.wooId)] !== "publish",
          ).length;
          return (
            <DialogConfirm
              title={
                isChecking
                  ? "Checking current site status…"
                  : "Sync all products to the site?"
              }
              confirmIcon={<Globe aria-hidden="true" />}
              confirmLabel={isChecking ? "Checking…" : "Sync all"}
              confirmingLabel="Syncing…"
              confirmVariant="primary"
              confirmDisabled={isChecking}
              status={publishStatus}
              successMessage="Synced — reloading catalog…"
              error={publishError}
              onConfirm={() => void handlePublishConfirm()}
              onCancel={() => setSyncRequest(null)}
            >
              <p className="small">
                Checks all <strong>{totalCount}</strong> product
                {totalCount !== 1 ? "s" : ""} for changes and pushes anything
                that's changed since its last sync. Unchanged products are
                skipped automatically. Stock is not affected.
              </p>
              {isChecking && (
                <p className="small clr-muted">
                  Checking WooCommerce for every synced product's current
                  status…
                </p>
              )}
              {!isChecking && unpublishedCount > 0 && (
                <label className="row gap-half ai-cen small">
                  <input
                    type="checkbox"
                    checked={publishDrafts}
                    onChange={(e) => setPublishDrafts(e.target.checked)}
                  />
                  <span>
                    Also publish {unpublishedCount} unpublished product
                    {unpublishedCount !== 1 ? "s" : ""} to be live on the site
                  </span>
                </label>
              )}
              {!isChecking && publishDrafts && unpublishedGroups.length > 0 && (
                <form className="grid gap-1">
                  <p className="bold small">
                    Set initial stock for the product
                    {unpublishedGroups.length !== 1 ? "s" : ""} going live for
                    the first time
                  </p>
                  <p className="xsmall clr-muted">
                    These have never had a stock number set — they'll go live as
                    out of stock unless you enter a quantity below.
                  </p>
                  <ul className="grid gap-half stock-variant-list" role="list">
                    {unpublishedGroups.map((g) => {
                      const isSimple = g.rowCount === 0;
                      if (isSimple) {
                        return (
                          <li
                            key={g.sku}
                            className="row gap-1 ai-cen padding-b-half border-be border-soft stock-variant-item"
                          >
                            <label
                              className="flex-1"
                              htmlFor={`stock-all-${g.sku}`}
                            >
                              {g.displayName}
                              <span className="clr-muted xsmall">
                                {" "}
                                · {g.sku}
                              </span>
                            </label>
                            <input
                              id={`stock-all-${g.sku}`}
                              type="number"
                              min="0"
                              step="1"
                              className="stock-variant-input"
                              value={stockOverrides[g.sku] ?? "0"}
                              onChange={(e) =>
                                setStockOverrides((prev) => ({
                                  ...prev,
                                  [g.sku]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) =>
                                (e.key === "-" ||
                                  e.key === "e" ||
                                  e.key === ".") &&
                                e.preventDefault()
                              }
                            />
                          </li>
                        );
                      }
                      return (
                        <li key={g.sku} className="grid gap-quarter">
                          <p className="small">
                            {g.displayName}{" "}
                            <span className="clr-muted xsmall">{g.sku}</span>
                          </p>
                          <ul
                            className="grid gap-quarter stock-variant-list"
                            role="list"
                          >
                            {g.rows.map((r) => (
                              <li
                                key={r.sku}
                                className="row gap-1 ai-cen padding-b-half border-be border-soft stock-variant-item"
                              >
                                <label
                                  className="flex-1"
                                  htmlFor={`stock-all-${r.sku}`}
                                >
                                  {r.label ?? r.sku}
                                </label>
                                <input
                                  id={`stock-all-${r.sku}`}
                                  type="number"
                                  min="0"
                                  step="1"
                                  className="stock-variant-input"
                                  value={stockOverrides[r.sku] ?? "0"}
                                  onChange={(e) =>
                                    setStockOverrides((prev) => ({
                                      ...prev,
                                      [r.sku]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) =>
                                    (e.key === "-" ||
                                      e.key === "e" ||
                                      e.key === ".") &&
                                    e.preventDefault()
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                </form>
              )}
              {unpublishCount > 0 && (
                <p className="small clr-warning">
                  {unpublishCount} product{unpublishCount !== 1 ? "s" : ""}{" "}
                  {unpublishCount !== 1 ? "are" : "is"} currently Published on
                  the site but marked Draft in the sheet —{" "}
                  {unpublishCount !== 1 ? "they" : "it"} will be unpublished
                  when synced.
                </p>
              )}
              {republishCount > 0 && (
                <p className="small clr-warning">
                  {republishCount} product{republishCount !== 1 ? "s" : ""}{" "}
                  {republishCount !== 1 ? "are" : "is"} marked Published in the
                  sheet but currently Draft on the site (e.g. manually
                  unpublished) — {republishCount !== 1 ? "they" : "it"} will be
                  republished when synced.
                </p>
              )}
            </DialogConfirm>
          );
        })()}
    </>
  );
}
