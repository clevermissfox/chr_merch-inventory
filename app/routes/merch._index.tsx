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
  return <></>;
}
