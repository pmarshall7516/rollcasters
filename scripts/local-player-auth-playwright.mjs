import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseEnv } from "./db-utils.mjs";

if (process.env.RUN_LIVE_LOCAL_PLAYER_AUTH_TEST !== "true") {
  throw new Error("Set RUN_LIVE_LOCAL_PLAYER_AUTH_TEST=true to run the disposable local account test.");
}

function localSupabaseConfig() {
  const status = spawnSync("supabase", ["status", "--workdir", process.cwd(), "-o", "env"], { encoding: "utf8" });
  if (status.status !== 0) throw new Error("Local Supabase status failed; run npm run local:player:start first.");
  const values = {};
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  if (!values.API_URL || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) {
    throw new Error("Local Supabase status did not provide the required Auth keys.");
  }
  return values;
}

const env = { ...parseEnv(), ...process.env };
const local = localSupabaseConfig();
const baseUrl = env.BASE_URL ?? "http://127.0.0.1:4173";
const email = `local-preview-${Date.now()}@example.com`;
const password = `Rollcasters-Local-${Date.now()}!`;
const username = `Local Preview ${Date.now()}`;
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const browser = await chromium.launch({ headless: process.env.HEADED !== "true" });
const userIds = [];

async function runAuthFlow(page, mode) {
  page.setDefaultTimeout(45_000);
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (mode === "signup") {
    await page.getByText("Need an account?", { exact: true }).click();
    await page.getByLabel("Username").fill(username);
  }
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: mode === "signup" ? "Sign up" : "Log in" }).click();
  const waitForStarter = async () => {
    await page.waitForFunction(() => {
      const text = window.render_game_to_text?.();
      return text && JSON.parse(text).view === "starter-rollcaster";
    });
  };
  try {
    await waitForStarter();
  } catch (error) {
    const takeover = page.getByRole("button", { name: "Play Here" });
    if (mode === "signin" && await takeover.isVisible().catch(() => false)) {
      await takeover.click();
      await waitForStarter();
    } else {
    console.error(`${mode} did not reach onboarding.`, {
      render: await page.evaluate(() => window.render_game_to_text?.()).catch(() => null),
      body: (await page.locator("body").innerText().catch(() => "")).slice(0, 500),
      errors,
    });
    throw error;
    }
  }
  assert.equal(errors.length, 0, `${mode} produced browser errors: ${errors.join(" | ")}`);
}

try {
  const signupPage = await browser.newPage();
  await runAuthFlow(signupPage, "signup");
  const created = await admin.auth.admin.listUsers({ perPage: 1000 });
  const createdUser = created.data.users.find((user) => user.email === email);
  assert.ok(createdUser, "The local sign-up flow must create an Auth user.");
  userIds.push(createdUser.id);
  await signupPage.locator(".user-menu-trigger").click();
  await signupPage.getByRole("menuitem", { name: "Account Center" }).click();
  await assert.doesNotReject(async () => signupPage.getByRole("heading", { name: "Account Center" }).waitFor());
  await signupPage.getByRole("button", { name: "Continue" }).click();
  await waitForStarterOnPage(signupPage);
  await signupPage.close();

  const signinPage = await browser.newPage();
  await runAuthFlow(signinPage, "signin");
  await signinPage.close();
  console.log("Local player Auth browser flow passed: sign-up and sign-in reached starter onboarding.");
} finally {
  const listed = await admin.auth.admin.listUsers({ perPage: 1000 }).catch(() => ({ data: { users: [] } }));
  for (const user of listed.data.users.filter((candidate) => candidate.email === email || userIds.includes(candidate.id))) {
    await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
  }
  await browser.close();
}

async function waitForStarterOnPage(page) {
  await page.waitForFunction(() => {
    const text = window.render_game_to_text?.();
    return text && JSON.parse(text).view === "starter-rollcaster";
  });
}
