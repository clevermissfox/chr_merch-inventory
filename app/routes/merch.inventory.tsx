import type { Route } from "./+types/merch.inventory";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch | Inventory" },
    {
      name: "description",
      content:
        "Inventory management workspace for warehouse and website stock.",
    },
  ];
}

const metrics = [
  { label: "Products", value: 5 },
  { label: "Inventory Rows", value: 44 },
  { label: "Stock Conflicts", value: 3 },
];

const sampleGroups = [
  {
    title: "CHR Classic T-Shirt",
    count: "22 SKUs",
    rows: [
      ["CHR-CLO-0001-BLK-SM", "black small", "2", "2", "ok"],
      ["CHR-CLO-0001-BLK-MD", "black medium", "2", "2", "ok"],
      ["CHR-CLO-0001-BLK-LG", "black large", "1", "1", "ok"],
    ],
  },
  {
    title: "CHR Desert Angels Baby Tee",
    count: "6 SKUs",
    rows: [
      ["CHR-CLO-0012-CRM-SM", "cream small", "8", "6", "mismatch"],
      ["CHR-CLO-0012-CRM-MD", "cream medium", "4", "4", "ok"],
    ],
  },
];

export default function InventoryPage() {
  return (
    <>
      <section className="toolbar card">
        <div className="toolbar-row">
          <div>
            <div className="badge">Signed In</div>
            <div className="small">dev@cochiseharmreduction.org (editor)</div>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn-secondary">
              Refresh Website Stock
            </button>
            <button type="button" className="btn-primary">
              Push Warehouse Stock Live
            </button>
          </div>
        </div>
        <div className="toolbar-row">
          <div className="status-line">
            Loaded 44 inventory rows across 5 products.
          </div>
        </div>
      </section>

      <section className="hero card">
        <div className="hero-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="metric">
              <div className="metric-label">{metric.label}</div>
              <div className="metric-value">{metric.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="inventory-groups">
        {sampleGroups.map((group) => (
          <details key={group.title} className="inventory-group card" open>
            <summary>
              <div className="summary-title">
                <strong>{group.title}</strong>
                <span className="summary-count">{group.count}</span>
              </div>
              <span className="toggle-label">Toggle</span>
            </summary>

            <div className="table-wrapper">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Item</th>
                    <th>Warehouse Stock</th>
                    <th>Website Stock</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row[0]}>
                      <td className="sku-cell">{row[0]}</td>
                      <td className="variant-cell">{row[1]}</td>
                      <td>{row[2]}</td>
                      <td>{row[3]}</td>
                      <td>
                        <span
                          className={
                            row[4] === "mismatch"
                              ? "merch-status merch-status--mismatch"
                              : "merch-status merch-status--ok"
                          }
                        >
                          {row[4]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </section>
    </>
  );
}
