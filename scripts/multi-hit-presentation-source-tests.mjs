import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const game = fs.readFileSync(path.join(root, "src", "lib", "game.ts"), "utf8");
const dungeonRun = fs.readFileSync(path.join(root, "src", "lib", "dungeon-run.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(game.includes('skillPhase?: "use" | "hit" | "summary" | "failure" | "knockout"'), "Combat presentation events must expose the complete Skill playback phase contract.");
check(game.includes('animation?: "attack" | "support"'), "Combat presentation events must expose attack/support animation metadata.");
check(game.includes("markSkillHitPresentation"), "Support Multi-Hit activations must have a dedicated per-hit presentation helper.");
check(game.includes("deferredKnockoutKeys"), "Multi-Hit playback must defer knockout visibility until its explicit knockout event.");
check(dungeonRun.includes("knockedOut: unit.hp <= 0"), "Dungeon replacement snapshots must retain explicit knockout state.");
check(app.includes('presentation?.animation === "support"'), "The renderer must select a distinct support animation for support activations.");
check(app.includes("presentationUnit?.knockedOut"), "The renderer must use the presentation snapshot to delay knockout visuals.");
check(app.includes("event?.silent"), "Silent playback events must preserve the last meaningful narration.");
check(app.includes("knockoutRevealing"), "The renderer must start knockout presentation only from the explicit knockout event.");
check(styles.includes(".battle-unit.acting-support"), "Combat CSS must define the support activation animation class.");
check(styles.includes("@keyframes combat-support-cast"), "Combat CSS must define support activation timing.");
check(styles.includes(".battle-unit.knockout-reveal") && styles.includes("@keyframes combat-knockout-reveal"), "Combat CSS must define the delayed knockout reveal animation.");

console.log("Multi-Hit presentation source tests passed.");
