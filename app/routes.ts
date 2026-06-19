import { layout, route, index, type RouteConfig } from "@react-router/dev/routes";

export default [
  layout("routes/merch.tsx", [
    index("routes/merch._index.tsx"),
    route("products", "routes/merch.products.tsx"),
    route("inventory", "routes/merch.inventory.tsx"),
  ]),
] satisfies RouteConfig;
