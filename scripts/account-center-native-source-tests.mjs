import assert from "node:assert/strict";
import fs from "node:fs";

const cargo = fs.readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const rust = fs.readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../src/lib/desktop-profile.ts", import.meta.url), "utf8");

assert.match(cargo, /keyring/, "Native builds must depend on an OS credential-store library.");
assert.match(rust, /secure_credential_get/, "Rust must expose secure credential reads.");
assert.match(rust, /secure_credential_set/, "Rust must expose secure credential writes.");
assert.match(rust, /secure_credential_delete/, "Rust must expose secure credential deletion.");
assert.match(rust, /delete_credential/, "Credential removal must use the keyring delete operation.");
assert.doesNotMatch(rust, /println!.*refresh|eprintln!.*refresh|log!.*refresh/, "Refresh tokens must never be logged.");
assert.match(profile, /credentialNamespace/, "Desktop profiles must carry a credential namespace.");

console.log("Account-center native source contract passed.");
