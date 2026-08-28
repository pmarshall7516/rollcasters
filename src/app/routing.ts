import type { View } from "../lib/types.js";

export type ShopTab = "shard" | "relic" | "lootbox" | "promo";
export type RouteLocation = Pick<Location, "pathname" | "search">;
export type AppRoute = { view: View; shopTab: ShopTab };

export function routeFromLocation(location: RouteLocation = window.location): AppRoute {
  const params = new URLSearchParams(location.search);
  const requestedTab = params.get("tab");
  const shopTab: ShopTab = requestedTab === "relic" || requestedTab === "lootbox" || requestedTab === "promo"
    ? requestedTab
    : "shard";
  if (location.pathname === "/shop") return { view: "shop", shopTab };
  if (location.pathname === "/collection") return { view: "collection", shopTab };
  if (location.pathname === "/bag") return { view: "bag", shopTab };
  if (location.pathname === "/play") return { view: "play", shopTab };
  return { view: "home", shopTab };
}

export function viewUrl(view: View, shopTab: ShopTab): string {
  if (view === "shop") return `/shop?tab=${shopTab}`;
  if (view === "collection") return "/collection";
  if (view === "bag") return "/bag";
  if (view === "play") return "/play";
  return "/";
}
