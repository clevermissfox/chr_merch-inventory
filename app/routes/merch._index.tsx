import type { Route } from "./+types/merch._index";
import { MerchShell } from "~/components/merch-shell";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch | Dashboard" },
    {
      name: "description",
      content: "Merch operations dashboard for inventory, products, and syncs.",
    },
  ];
}

const stats = [
  {
    label: "Inventory",
    value: "Live",
    note: "Warehouse stock and website stock in one place.",
  },
  {
    label: "Source",
    value: "Google Sheets",
    note: "The spreadsheet still owns the truth.",
  },
  {
    label: "Sync path",
    value: "Cloudflare",
    note: "Worker + backend proxy between the app and legacy logic.",
  },
  {
    label: "Next screens",
    value: "2",
    note: "Products and inventory are the main screens now.",
  },
];

const roadMap = [
  {
    title: "Products",
    body: "Top-level product cards that hold the editable copy and nested variants in one place.",
  },
  {
    title: "Inventory",
    body: "Fast stock editing with clear warehouse vs website feedback and a no-surprises save flow.",
  },
];

export default function MerchDashboard() {
  return (
    <MerchShell
      eyebrow="Merch HQ"
      title="The merch brain, without the sheet gymnastics."
      kicker="This is the new front door for the merch stack: faster to navigate, easier to expand, and designed around products and inventory instead of separate descriptions and variants screens."
    >
      <section className="merch-section merch-section--dashboard">
        <div className="merch-card merch-card--soft">
          <div className="merch-chip-row">
            <span className="merch-chip merch-chip--brand">Ready to build</span>
            <span className="merch-chip merch-chip--soft">/merch</span>
          </div>

          <h3 className="merch-section__title merch-section__title--spaced">
            A dashboard that can guide the team without exposing the entire
            spreadsheet maze.
          </h3>

          <div className="merch-kpi-grid merch-kpi-grid--dashboard">
            {stats.map((stat) => (
              <div key={stat.label} className="merch-kpi">
                <div className="merch-kpi__label">{stat.label}</div>
                <div className="merch-kpi__value">{stat.value}</div>
                <p className="merch-kpi__note">{stat.note}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="merch-card merch-card--dark">
          <p className="merch-sidebar__callout-eyebrow">First build target</p>
          <div className="merch-panel-list merch-panel-list--spaced">
            {roadMap.map((item, index) => (
              <div key={item.title} className="merch-panel">
                <div className="merch-panel__header">
                  <div className="merch-panel__step">{index + 1}</div>
                  <h4 className="merch-panel__title">{item.title}</h4>
                </div>
                <p className="merch-panel__body">{item.body}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="merch-section merch-section--dashboard">
        <div className="merch-note-box">
          <p className="merch-note-box__eyebrow">What we keep</p>
          <p className="merch-note-box__body">
            The Google Sheet stays the source of truth. Legacy Apps Script stays
            in the reference archive. The UI becomes the friendly layer on top.
          </p>
        </div>
        <div className="merch-note-box">
          <p className="merch-note-box__eyebrow">What changes</p>
          <p className="merch-note-box__body">
            Routes, panels, and clear workflow screens instead of one giant
            sheet brain with hidden logic.
          </p>
        </div>
        <div className="merch-note-box merch-note-box--brand">
          <p className="merch-note-box__eyebrow">Why it feels better</p>
          <p className="merch-note-box__body">
            Less waiting, less hunting, fewer accidental sync surprises, and a
            layout your team can actually learn once.
          </p>
        </div>
      </section>
    </MerchShell>
  );
}
