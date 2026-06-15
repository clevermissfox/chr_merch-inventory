import type { Route } from "./+types/merch._index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch | Dashboard" },
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
  return (
    <>
      <section className="card">
        <h2>Coming soon!</h2>
      </section>
    </>
  );
}
