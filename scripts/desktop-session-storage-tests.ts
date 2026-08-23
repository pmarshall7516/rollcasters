import { createDesktopSessionStorage } from "../src/lib/desktop-session-storage.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const account = "com.rollcasters.game.auth";
const storage = createDesktopSessionStorage("com.rollcasters.game", account);

for (const [key, value] of [
  [`${account}-code-verifier`, "desktop-verifier"],
  [`${account}-user`, '{"user":{"id":"desktop-user"}}'],
] as const) {
  await storage.setItem(key, value);
  check((await storage.getItem(key)) === value, `Auxiliary auth value was not stored for ${key}.`);
  await storage.removeItem(key);
  check((await storage.getItem(key)) === null, `Auxiliary auth value was not removed for ${key}.`);
}

let rejected = false;
try {
  await storage.getItem(`${account}-unexpected`);
} catch (error) {
  rejected = error instanceof Error && error.message === "Unexpected desktop session-storage key.";
}
check(rejected, "Unexpected storage keys must remain rejected.");

console.log("Desktop session storage accepts Supabase auxiliary auth keys.");
