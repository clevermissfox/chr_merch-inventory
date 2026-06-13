import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("merch", "routes/merch.tsx", [
    index("routes/merch._index.tsx"),
    route("auth/google/callback", "routes/merch/auth/google/callback.tsx"),
    route("products", "routes/merch.products.tsx"),
    route("inventory", "routes/merch.inventory.tsx"),
  ]),
] satisfies RouteConfig;
