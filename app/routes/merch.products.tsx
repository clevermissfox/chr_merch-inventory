import type { Route } from "./+types/merch.products";
import { MerchShell } from "~/components/merch-shell";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch | Products" },
    {
      name: "description",
      content: "Product-level merch management with nested descriptions and variants.",
    },
  ];
}

const products = [
  {
    name: "CHR Classic T-Shirt",
    sku: "CHR-CLO-0001",
    note: "Descriptions and variants live under the product record.",
    variants: ["Black / Small", "Black / Medium", "Black / Large"],
  },
  {
    name: "CHR Desert Angels Baby Tee",
    sku: "CHR-CLO-0012",
    note: "One product card can contain the descriptive fields and all variants.",
    variants: ["Cream / Small", "Cream / Medium"],
  },
];

export default function ProductsPage() {
  return (
    <MerchShell
      eyebrow="Product workspace"
      title="Products are the top-level editor."
      kicker="Descriptions and variants are not separate sections anymore. They belong under each product card so the team stays in one place while editing the right thing."
    >
      <section className="inventory-groups">
        {products.map((product) => (
          <details key={product.sku} className="inventory-group card" open>
            <summary>
              <div className="summary-title">
                <strong>{product.name}</strong>
                <span className="summary-count">{product.sku}</span>
              </div>
              <span className="toggle-label">Toggle</span>
            </summary>

            <div className="merch-card merch-card--soft">
              <p className="small">{product.note}</p>
              <div className="merch-chip-row merch-chip-row--spaced">
                <span className="merch-chip merch-chip--brand">
                  Primary description
                </span>
                <span className="merch-chip merch-chip--soft">
                  Short description
                </span>
                <span className="merch-chip merch-chip--soft">
                  Variant descriptions
                </span>
              </div>
            </div>

            <div className="table-wrapper">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Workflow</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((variant) => (
                    <tr key={variant}>
                      <td className="variant-cell">{variant}</td>
                      <td>
                        <span className="merch-status merch-status--ok">
                          Nested under product
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
    </MerchShell>
  );
}
