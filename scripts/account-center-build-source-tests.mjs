import assert from "node:assert/strict";
import fs from "node:fs";

const storage = fs.readFileSync(new URL("../src/lib/account-center-storage.ts", import.meta.url), "utf8");
const localDev = fs.readFileSync(new URL("./dev-local.mjs", import.meta.url), "utf8");
const catalogDev = fs.readFileSync(new URL("./dev-with-catalog.mjs", import.meta.url), "utf8");
const desktopBuild = fs.readFileSync(new URL("./build-desktop.mjs", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../src/lib/desktop-profile.ts", import.meta.url), "utf8");

assert.match(storage, /isTauriDesktop\(\).*NativeCredentialStore|if \(isTauriDesktop\(\)/s, "Desktop builds must use the native credential store.");
assert.match(storage, /profile\.profile === "local" && browserFallbackAllowed/, "Only explicit Local development builds may use browser fallback storage.");
assert.match(localDev, /VITE_ALLOW_INSECURE_ACCOUNT_CENTER_STORAGE: 'true'/, "Local browser development must opt into its test-only fallback.");
assert.match(catalogDev, /VITE_ALLOW_INSECURE_ACCOUNT_CENTER_STORAGE: 'true'/, "Local catalog browser development must opt into its test-only fallback.");
assert.match(desktopBuild, /\['local', 'stable'\]/, "Desktop packaging must continue to support both profiles.");
assert.match(profile, /credentialNamespace: `\$\{expected\.appId\}\.accounts\.v1:\$\{actualProjectRef\}`/, "Account credentials must be isolated by app profile and backend.");

console.log("Account-center local/stable build contract passed.");
