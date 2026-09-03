import assert from "node:assert/strict";
import { readEnv } from "./db-utils.mjs";

const env = readEnv();
const url = `${String(env.VITE_SUPABASE_URL).replace(/\/$/, "")}/rest/v1/rpc/get_promo_code_definition`;
const response = await fetch(url, {
  method: "POST",
  headers: {
    apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ p_code: "ROLLCASTERS_GATE_REGRESSION_UNKNOWN" }),
});
const payload = await response.json();
assert.equal(response.status, 200, `The public definition lookup must not require Game Update headers: ${JSON.stringify(payload)}`);
assert.equal(payload, null, "An unknown code should remain a normal null definition lookup.");
console.log("Promo Code definition lookup is outside the client update gate.");
