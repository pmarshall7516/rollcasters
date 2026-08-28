import { routeFromLocation, viewUrl } from "../src/app/routing.js";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
}

function location(pathname: string, search = ""): Pick<Location, "pathname" | "search"> {
  return { pathname, search };
}

equal(routeFromLocation(location("/shop", "?tab=relic")), { view: "shop", shopTab: "relic" }, "relic shop route");
equal(routeFromLocation(location("/shop", "?tab=lootbox")), { view: "shop", shopTab: "lootbox" }, "lootbox shop route");
equal(routeFromLocation(location("/shop", "?tab=promo")), { view: "shop", shopTab: "promo" }, "promo shop route");
equal(routeFromLocation(location("/shop", "?tab=unknown")), { view: "shop", shopTab: "shard" }, "unknown shop tab default");
equal(routeFromLocation(location("/collection", "?tab=promo")), { view: "collection", shopTab: "promo" }, "collection route");
equal(routeFromLocation(location("/bag")), { view: "bag", shopTab: "shard" }, "bag route");
equal(routeFromLocation(location("/play")), { view: "play", shopTab: "shard" }, "play route");
equal(routeFromLocation(location("/unexpected")), { view: "home", shopTab: "shard" }, "fallback route");

check(viewUrl("shop", "relic") === "/shop?tab=relic", "shop URL");
check(viewUrl("collection", "promo") === "/collection", "collection URL");
check(viewUrl("bag", "promo") === "/bag", "bag URL");
check(viewUrl("play", "promo") === "/play", "play URL");
check(viewUrl("home", "promo") === "/", "home URL");
check(viewUrl("auth", "promo") === "/", "auth URL");

console.log("Routing helper tests passed.");
