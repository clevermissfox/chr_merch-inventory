import { Search } from "lucide-react";
import type { Route } from "./+types/merch._index";
import { SearchComponent } from "~/components/SearchComponent";
import { useCatalog } from "~/context/CatalogContext";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch Hub | Dashboard" },
    {
      name: "description",
      content: "Merch and shop operations dashboard.",
    },
  ];
}

export const handle = {
  title: "Dashboard",
  eyebrow: "Manage shop",
};

const stats = [
  {
    label: "Inventory",
    value: "Live",
    note: "Warehouse stock and website stock in one place.",
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
  const { state } = useCatalog();
  return (
    <>
      <section className="card">
        <h2>Coming soon!</h2>
      </section>
      <section className="card" data-action="search_inventory">
        {/* <SearchComponent
          idSuffix="quick-inventory"
          data={state.catalog?.groups}
        /> */}
        <div className="search-input-wrapper">
          <input
            type="search"
            minLength={3}
            placeholder="e.g. black small"
            enterKeyHint="search"
          />
          <button type="submit" aria-label="Search">
            <Search aria-hidden="true" />
          </button>
        </div>
      </section>
    </>
  );
}
