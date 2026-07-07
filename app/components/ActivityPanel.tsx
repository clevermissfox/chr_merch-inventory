import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface ActivityEntry {
  timestamp: string;
  email: string;
  givenName: string | null;
  action: string;
  detail: string;
}

// mode is baked into the action string itself (inventory_sync_stock_sync_all,
// _standard_sync, _resolve_conflicts) rather than a separate JSON field —
// see backend/index.ts's inventory/sync_stock handler. Surfaced as its own
// "Mode" row in the detail list (see injectStockSyncMode), not folded into
// the summary label — the label stays the generic "Stock updated".
const STOCK_SYNC_MODE_LABELS: Record<string, string> = {
  sync_all: "Sync all",
  standard_sync: "Sync changes",
  resolve_conflicts: "Resolve conflicts",
  custom_selection: "Custom selection",
  quick_update: "Quick update",
};

// Action strings aren't a fixed enum — a few are template-built with a
// suffix (ref_add_color, inventory_sync_stock_selected, error_create_product)
// — so this matches by prefix first, falling back to the raw string for
// anything new/unrecognized rather than hiding it.
function formatActivityAction(action: string): string {
  if (action.startsWith("error_")) return "Error";
  if (action.startsWith("inventory_sync_stock")) return "Stock updated";
  if (action.startsWith("ref_add_")) return "Reference value added";
  switch (action) {
    case "create_product":
      return "Product created";
    case "update_product":
      return "Product edited";
    case "delete_product":
      return "Product deleted";
    case "create_variants":
      return "Variant(s) created";
    case "update_variant":
      return "Variant edited";
    case "delete_variant":
      return "Variant deleted";
    case "sync_to_site":
      return "Synced to site";
    case "set_woo_id":
      return "Product relinked";
    case "image_notification":
      return "Image uploaded";
    case "remove_woo_image":
      return "Image removed";
    case "remove_woo_variant_image":
      return "Variant image removed";
    case "inventory_get_stock":
      return "Stock refreshed";
    default:
      return action;
  }
}

// Every merch_app_logs detail is JSON now (see backend/index.ts) — parses it
// into a plain object. Falls back to null for any pre-JSON historical row or
// genuinely malformed entry, rather than throwing.
function parseActivityDetail(detail: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(detail);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Fields that exist in the raw log row for debugging but aren't useful (or
// are actively confusing) in the activity feed — e.g. sync_to_site's `mode`/
// `publish` are the request's input flags, not what happened, and
// image_notification's `notes`/`folderId`/`files` are more detail than a
// glance at "what happened" needs.
const HIDDEN_DETAIL_KEYS: Record<string, string[]> = {
  sync_to_site: ["mode", "publish"],
  image_notification: ["notes", "folderId", "files"],
  create_product: ["rowId"],
};

// Per-action overrides for a key's default humanized label, where the
// generic camelCase-split reading is ambiguous — e.g. "Skipped draft" reads
// as "any draft got skipped," but it only counts products that have never
// been published to Woo at all and weren't asked to publish this run;
// already-published-then-drafted products still sync normally.
const KEY_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  sync_to_site: {
    skippedDraft: "Skipped (never published)",
    missing: "Not found",
  },
};

// sync_to_site's `publish` flag is a single boolean for the whole request
// (it only gates whether never-before-published products in the batch are
// allowed to go live) — it can't answer "how many actually got published,"
// which is what a reader actually wants. Derive real counts from the
// per-SKU `statuses` map instead, so the feed shows an outcome rather than
// an input flag.
function deriveSyncStatusCounts(
  detail: Record<string, unknown>,
): Array<[string, string]> {
  const statuses = detail.statuses;
  if (!statuses || typeof statuses !== "object") return [];
  const values = Object.values(statuses as Record<string, string>);
  if (values.length === 0) return [];
  const published = values.filter((s) => s === "publish").length;
  const unpublished = values.length - published;
  const counts: Array<[string, string]> = [];
  if (published > 0) counts.push(["Published", String(published)]);
  if (unpublished > 0) counts.push(["Unpublished", String(unpublished)]);
  return counts;
}

// See STOCK_SYNC_MODE_LABELS's comment — mode only exists as an action-name
// suffix, so it has to be synthesized as its own detail row rather than
// coming from the parsed JSON like everything else.
function deriveStockSyncMode(action: string): Array<[string, string]> {
  if (!action.startsWith("inventory_sync_stock")) return [];
  const mode = action.replace("inventory_sync_stock_", "");
  return [["Mode", STOCK_SYNC_MODE_LABELS[mode] ?? mode]];
}

// camelCase -> "Camel case" for a log detail's JSON keys.
function humanizeKey(action: string, key: string): string {
  const override = KEY_LABEL_OVERRIDES[action]?.[key];
  if (override) return override;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatDetailValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value
      .map((v) => (typeof v === "object" && v ? JSON.stringify(v) : String(v)))
      .join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// A per-product/per-SKU breakdown (sync_to_site's `statuses` map, an
// inventory sync's `skus` array of {sku, requestedQty, wooQty}) reads as raw
// JSON if dumped through formatDetailValue — quotes, braces, and all. These
// render as an actual list instead, and get moved to the end of the detail
// list (see sortDetailEntries) since they're the "supporting detail," not
// the headline numbers.
function renderListValue(value: unknown): ReactNode | null {
  if (Array.isArray(value)) {
    if (value.length === 0 || typeof value[0] !== "object") return null;
    return (
      <ul className="xsmall">
        {(value as Array<Record<string, unknown>>).map((item, i) => {
          const { sku, ...rest } = item;
          const parts = Object.entries(rest).map(
            ([k, v]) => `${humanizeKey("", k).toLowerCase()} ${v}`,
          );
          return (
            <li key={typeof sku === "string" ? sku : i}>
              {typeof sku === "string" ? sku : `Item ${i + 1}`}
              {parts.length > 0 ? ` — ${parts.join(", ")}` : ""}
            </li>
          );
        })}
      </ul>
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return null;
    return (
      <ul className="xsmall">
        {entries.map(([k, v]) => (
          <li key={k}>
            {k} — {String(v)}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

// e.g. "Jan. 1 08:30pm"
function formatActivityTimestamp(timestamp: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const d = new Date(timestamp);
  const hours24 = d.getHours();
  const ampm = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 || 12;
  const hh = String(hours12).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()} | ${hh}:${mm}${ampm}`;
}

export default function ActivityPanel() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const entryLimit = 5;

  const loadActivity = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/catalog/recent_activity?limit=${entryLimit}`,
        {
          credentials: "include",
        },
      );
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Failed to load activity");
      setEntries(data.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    }
  }, []);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadActivity();
    setRefreshing(false);
  };

  return (
    <section className="card grid gap-1">
      <div className="row jc-sb ai-cen">
        <hgroup>
          <h2>Recent activity</h2>
          <p className="small clr-muted">
            The last {entryLimit} actions taken in the app.
          </p>
        </hgroup>
        <button
          type="button"
          className="btn-icon"
          aria-label="Refresh recent activity"
          title="Refresh"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw aria-hidden="true" className={refreshing ? "spin" : ""} />
        </button>
      </div>
      {error && (
        <p role="alert" className="status-line" data-tone="error">
          {error}
        </p>
      )}
      {!error && !entries && (
        <p role="status" className="status-line" data-tone="loading">
          Loading activity…
        </p>
      )}
      {entries && entries.length === 0 && (
        <p className="small clr-muted">No activity recorded yet.</p>
      )}
      {entries && entries.length > 0 && (
        <ul className="grid gap-half" role="list">
          {entries.map((entry, i) => {
            const detail = parseActivityDetail(entry.detail);
            const hiddenKeys = HIDDEN_DETAIL_KEYS[entry.action] ?? [];
            const rawRows: Array<[string, ReactNode, boolean]> = detail
              ? Object.entries(detail)
                  .filter(([key]) => !hiddenKeys.includes(key))
                  .map(([key, value]) => {
                    const listValue = renderListValue(value);
                    return [
                      humanizeKey(entry.action, key),
                      listValue ?? formatDetailValue(value),
                      listValue !== null,
                    ];
                  })
              : [];
            const derivedRows: Array<[string, ReactNode, boolean]> = [
              ...deriveStockSyncMode(entry.action),
              ...(entry.action === "sync_to_site" && detail
                ? deriveSyncStatusCounts(detail)
                : []),
            ].map(([label, value]) => [label, value, false]);
            // Per-SKU breakdowns (statuses/skus lists) are supporting detail,
            // not the headline — they read better at the end of the list,
            // after the summary counts.
            const detailEntries = [...derivedRows, ...rawRows].sort(
              (a, b) => Number(a[2]) - Number(b[2]),
            );
            return (
              <li key={`${entry.timestamp}-${i}`}>
                <details className="activity-entry toggle-group">
                  <summary>
                    <div className="summary-title">
                      <strong>{formatActivityAction(entry.action)}</strong>
                      <span className="small clr-muted">
                        {formatActivityTimestamp(entry.timestamp)}
                      </span>
                    </div>
                    <span className="toggle-label">Toggle</span>
                  </summary>
                  <div className="activity-content padding-b-three-fourths padding-i-1quarter surface-secondary grid gap-half">
                    {detailEntries.length > 0 && (
                      <dl className="meta row fw-wrap">
                        {detailEntries.map(([label, value, isList]) => (
                          <div
                            key={label}
                            className={isList ? "meta-row-full" : undefined}
                          >
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="margin-is-auto">
                      {entry.givenName && <span>User: {entry.givenName}</span>}{" "}
                      {entry.givenName && entry.email && <span> | </span>}
                      {entry.email && (
                        <a
                          className="underline clr-muted"
                          href={`mailto:${entry.email}`}
                        >
                          {entry.email}
                        </a>
                      )}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
