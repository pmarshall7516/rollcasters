import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createDbClient, parseArgs, readEnv, root } from "./db-utils.mjs";
import {
  CATALOG_SCHEMA_VERSION,
  RUNTIME_CONTRACT_VERSION,
  createPacks,
  groupEffects,
  groupRows,
  sha256,
  sriSha256,
  stableJson,
  validateCatalog,
} from "./catalog-release-utils.mjs";

const args = parseArgs();
const env = readEnv();
const releaseId = String(args.release ?? "").trim();
if (!releaseId || !/^[A-Za-z0-9._-]+$/.test(releaseId)) {
  throw new Error("Pass a release ID such as --release 2026.07.20.1.");
}
const minimumGameVersion = String(args["minimum-game-version"] ?? "0.1.0");
const outputRoot = path.resolve(root, String(args.output ?? "output/catalog-release"));
const publishedAt = String(args["published-at"] ?? new Date().toISOString());
const assetBaseUrl = String(args["asset-base-url"] ?? "../../../game-assets");
const supabaseUrl = String(env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");

try {
  const existing = await fs.readdir(outputRoot);
  if (existing.length > 0) {
    if (!args.clean) throw new Error(`Output directory is not empty: ${outputRoot}. Pass --clean to replace generated release artifacts.`);
    if (outputRoot === root || outputRoot === path.parse(outputRoot).root) throw new Error("Refusing to clean a workspace or filesystem root.");
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await fs.mkdir(outputRoot, { recursive: true });

function numeric(row, keys) {
  const result = { ...row };
  for (const key of keys) if (result[key] != null) result[key] = Number(result[key]);
  return result;
}

async function rows(client, sql, parameters = []) {
  return (await client.query(sql, parameters)).rows;
}

async function readCatalog(client) {
  const q = (sql) => rows(client, sql);
  const data = {};
  data.currencies = await q(`select id,name,description,asset_path,text_color,is_default,is_system,sort_order,is_active,is_archived from public.currencies where is_active and not is_archived order by is_default desc,sort_order,id`);
  data.collectibleUnlockRequirements = await q(`select collectible_type,collectible_id,required_challenges from public.collectible_unlock_requirements order by collectible_type,collectible_id`);
  data.unlockChallengeTemplates = await q(`select id,name,description,challenge_category,progress_mode,runtime_version,allowed_collectible_types,parameter_schema,ui_schema,version,sort_order from public.unlock_challenge_templates where is_active and not is_archived order by sort_order,id`);
  data.collectibleUnlockChallenges = (await q(`select id,collectible_type,collectible_id,challenge_type,parameters,display_text,target_category,target_id,target_mode,any_target,target_ids,required_amount::text,required_level,sort_order,gate_order from public.collectible_unlock_challenges order by collectible_type,collectible_id,sort_order,id`));
  data.shopEntries = await q(`select id,shop_type,name,description,target_category,target_id,quantity,currency_id,price::text,sort_order,is_active,is_archived from public.shop_entries where is_active and not is_archived order by shop_type,sort_order,id`);
  data.elements = await q(`select id,name,description,asset_path,sort_order from public.elements where is_active and not is_archived order by sort_order,id`);
  data.elementEffectiveness = (await q(`select attacking_element_id,defending_element_id,multiplier from public.element_effectiveness order by attacking_element_id,defending_element_id`)).map((row) => numeric(row, ["multiplier"]));
  data.skills = await q(`select id,name,element_id,skill_type,power,mana_cost,targeting,description,sort_order from public.skills where is_active and not is_archived order by sort_order,id`);
  data.critters = await q(`select id,name,element_1_id,element_2_id,base_hp,base_atk,base_def,base_spd,base_dice_min,base_dice_max,base_block_cost,base_swap_cost,asset_path,description,sort_order,is_active,is_archived from public.critters where is_active and not is_archived order by sort_order,id`);
  data.critterProgression = await q(`select critter_id,level,total_required_xp,grant_skill_points,hp_delta,atk_delta,def_delta,spd_delta,dice_min_delta,dice_max_delta,block_cost_delta,swap_cost_delta,total_unlocked_relic_slots from public.critter_level_progression order by critter_id,level`);
  data.critterSkillUnlocks = await q(`select critter_id,skill_id,unlock_level,unlock_cost,is_default,sort_order from public.critter_skill_unlocks order by critter_id,sort_order,skill_id`);
  data.rollcasters = await q(`select id,name,asset_path,description,sort_order,is_active,is_archived from public.rollcasters where is_active and not is_archived order by sort_order,id`);
  data.rollcasterProgression = await q(`select rollcaster_id,level,total_required_xp,grant_ability_points,total_unlocked_ability_slots from public.rollcaster_level_progression order by rollcaster_id,level`);
  data.rollcasterAbilities = await q(`select id,name,description,sort_order from public.rollcaster_abilities where is_active and not is_archived order by sort_order,id`);
  data.rollcasterAbilityUnlocks = await q(`select rollcaster_id,ability_id,unlock_level,unlock_cost,is_default,sort_order from public.rollcaster_ability_unlocks order by rollcaster_id,sort_order,ability_id`);
  data.relics = await q(`select id,name,description,max_owned,asset_path,sort_order,is_active,is_archived from public.relics where is_active and not is_archived order by sort_order,id`);
  data.dungeons = await q(`select id,name,description,dungeon_type,difficulty,battle_format,battle_count,player_active_count,opponent_active_count,encounter_count,next_dungeon_id,regular_logo_path,boss_logo_path,sort_order,is_active,is_archived,version from public.dungeons where is_active and not is_archived order by id::numeric`);
  const rawOpponents = await q(`select id,dungeon_id,pool_type,sequence_index,probability,critter_id,critter_level,skill_ids,relic_ids,rollcaster_xp_reward,critter_xp_reward,currency_reward,drops from public.dungeon_opponents order by dungeon_id,sequence_index,id`);
  const opponentSkills = groupRows(await q(`select opponent_id,skill_id,slot_index from public.dungeon_opponent_skills order by opponent_id,slot_index`), "opponent_id");
  const opponentRelics = groupRows(await q(`select opponent_id,relic_id,slot_index from public.dungeon_opponent_relics order by opponent_id,slot_index`), "opponent_id");
  data.dungeonOpponentStatOverrides = await q(`select opponent_id,stat_key,value from public.dungeon_opponent_stat_overrides order by opponent_id,stat_key`);
  const overrides = groupRows(data.dungeonOpponentStatOverrides, "opponent_id");
  const currencyDrops = groupRows(await q(`select id,opponent_id,currency_id,min_amount,max_amount,probability,sort_order from public.dungeon_opponent_currency_drops order by opponent_id,sort_order,id`), "opponent_id");
  const itemDrops = groupRows(await q(`select id,opponent_id,drop_type,target_category,target_id,min_amount,max_amount,probability,dupe_currency_id,dupe_currency_amount,sort_order from public.dungeon_opponent_item_drops order by opponent_id,sort_order,id`), "opponent_id");
  const overrideKeys = { hp: "hp", atk: "atk", def: "def", spd: "spd", dice_min: "diceMin", dice_max: "diceMax", block_cost: "block", swap_cost: "swap", relic_slots: "relicSlots" };
  data.dungeonOpponents = rawOpponents.map((row) => ({
    ...numeric(row, ["probability"]),
    skill_ids: (opponentSkills.get(String(row.id)) ?? []).map((item) => item.skill_id),
    relic_ids: (opponentRelics.get(String(row.id)) ?? []).map((item) => item.relic_id),
    currencyDrops: (currencyDrops.get(String(row.id)) ?? []).map((item) => ({ id: item.id, kind: "currency", targetId: item.currency_id, minAmount: item.min_amount, maxAmount: item.max_amount, probability: Number(item.probability) })),
    itemDrops: (itemDrops.get(String(row.id)) ?? []).map((item) => ({ id: item.id, kind: item.drop_type, targetCategory: item.target_category, targetId: item.target_id, minAmount: item.min_amount, maxAmount: item.max_amount, probability: Number(item.probability), dupeCurrencyId: item.dupe_currency_id, dupeCurrencyAmount: item.dupe_currency_amount })),
    overrides: Object.fromEntries((overrides.get(String(row.id)) ?? []).map((item) => [overrideKeys[item.stat_key], item.value])),
  }));
  data.dungeonCompletionDrops = (await q(`select id,dungeon_id,completion_phase,drop_type,target_category,target_id,min_amount,max_amount,probability,dupe_currency_id,dupe_currency_amount,sort_order from public.dungeon_completion_drops order by dungeon_id,completion_phase,sort_order,id`)).map((row) => ({ id: `${row.dungeon_id}:${row.id}`, phase: row.completion_phase, kind: row.drop_type, ...(row.target_category ? { targetCategory: row.target_category } : {}), targetId: row.target_id, minAmount: row.min_amount, maxAmount: row.max_amount, probability: Number(row.probability), ...(row.dupe_currency_id ? { dupeCurrencyId: row.dupe_currency_id, dupeCurrencyAmount: row.dupe_currency_amount } : {}) }));
  data.starterRollcasterOptions = await q(`select rollcaster_id,sort_order,is_active from public.starter_rollcaster_options where is_active order by sort_order,rollcaster_id`);
  data.starterOptions = await q(`select critter_id,sort_order,is_active from public.starter_options where is_active order by sort_order,critter_id`);
  data.gameAssets = await q(`select id,bucket_id,path,category,owner_table,owner_id,variant,display_name,alt_text,content_type,width,height,checksum,is_active,sort_order,updated_at from public.game_assets where is_active order by category,owner_id,variant,path`);
  data.statuses = await q(`select id,name,description,asset_path,sort_order,is_active,is_archived,version from public.statuses where is_active and not is_archived order by sort_order,id`);
  const effects = groupEffects(await q(`select owner_type,owner_id,id,name,description,sort_order,template_id,runtime_kind,runtime_version,parameters,classification,execution from public.combat_effects_v1 order by owner_type,owner_id,sort_order,id`));
  data.effectsBySkill = effects.skill;
  data.effectsByAbility = effects.ability;
  data.effectsByRelic = effects.relic;
  data.effectsByStatus = effects.status;
  return data;
}

const variantsFor = (category) => category === "rollcaster"
  ? { default: 640, thumb: 224, card: 448, portrait: 960 }
  : ["critter", "relic"].includes(category)
    ? { default: 448, thumb: 224, card: 448, battle: 640 }
    : ["element", "currency", "status", "mana", "ui"].includes(category)
      ? { default: 96, icon: 96 }
      : { default: 960 };

const budgetFor = (variant) => ({ icon: 80_000, thumb: 180_000, card: 300_000, battle: 450_000, portrait: 500_000, default: 500_000 }[variant] ?? 500_000);

async function processAssets(catalog) {
  if (args["skip-assets"]) return { manifest: { schemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion: releaseId, assets: [] }, replacements: new Map() };
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL is required to download source assets.");
  const output = [];
  const replacements = new Map();
  const dedupe = new Map();
  const publishedByHash = new Map();
  for (const asset of catalog.gameAssets) {
    if (!dedupe.has(asset.path)) dedupe.set(asset.path, asset);
  }
  for (const asset of dedupe.values()) {
    const sourceUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(asset.bucket_id)}/${asset.path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Unable to download ${asset.path}: HTTP ${response.status}.`);
    const source = Buffer.from(await response.arrayBuffer());
    const image = sharp(source, { animated: false });
    for (const [variant, width] of Object.entries(variantsFor(asset.category))) {
      let bytes = await image.clone().resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90, effort: 5 }).toBuffer();
      for (const quality of [74, 66]) {
        if (bytes.length <= budgetFor(variant)) break;
        bytes = await image.clone().resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality, alphaQuality: 86, effort: 5 }).toBuffer();
      }
      if (bytes.length > budgetFor(variant) && !args["allow-oversize"]) {
        throw new Error(`${asset.path} ${variant} is ${bytes.length} bytes; budget is ${budgetFor(variant)}.`);
      }
      const metadata = await sharp(bytes).metadata();
      const hash = sha256(bytes);
      const stem = path.basename(asset.path, path.extname(asset.path)).replace(/[^A-Za-z0-9._-]+/g, "-");
      const objectPath = publishedByHash.get(hash) ?? `${asset.category}/${stem}.${variant}.${hash.slice(0, 12)}.webp`;
      if (!publishedByHash.has(hash)) {
        await fs.mkdir(path.join(outputRoot, "game-assets", asset.category), { recursive: true });
        await fs.writeFile(path.join(outputRoot, "game-assets", objectPath), bytes);
        publishedByHash.set(hash, objectPath);
      }
      output.push({ owner: { category: asset.category, table: asset.owner_table, id: asset.owner_id }, variant, path: objectPath, width: metadata.width, height: metadata.height, format: "webp", byteSize: bytes.length, sha256: hash, integrity: sriSha256(bytes), sourcePath: asset.path });
      if (variant === "default") replacements.set(asset.path, objectPath);
    }
  }
  return { manifest: { schemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion: releaseId, assets: output }, replacements };
}

function applyAssetPaths(catalog, manifest, replacements) {
  const rewrite = (value) => value ? replacements.get(value.split("?", 1)[0]) ?? value : value;
  for (const field of ["currencies", "elements", "critters", "rollcasters", "relics", "statuses"]) {
    catalog[field] = catalog[field].map((row) => ({ ...row, asset_path: rewrite(row.asset_path) }));
  }
  catalog.dungeons = catalog.dungeons.map((row) => ({ ...row, regular_logo_path: rewrite(row.regular_logo_path), boss_logo_path: rewrite(row.boss_logo_path) }));
  const sourceByPath = new Map(catalog.gameAssets.map((asset) => [asset.path, asset]));
  catalog.gameAssets = manifest.assets.map((asset, index) => {
    const source = sourceByPath.get(asset.sourcePath);
    return { id: `${source?.id ?? "asset"}:${asset.variant}`, bucket_id: "static-release", path: asset.path, category: asset.owner.category, owner_table: asset.owner.table, owner_id: asset.owner.id, variant: asset.variant, display_name: source?.display_name ?? null, alt_text: source?.alt_text ?? null, content_type: "image/webp", width: asset.width, height: asset.height, checksum: asset.sha256, is_active: true, sort_order: index, updated_at: publishedAt };
  });
}

function enforceReleaseAssetBudgets(catalog, manifest) {
  const uniqueDefault = new Map(manifest.assets.filter((asset) => asset.variant === "default").map((asset) => [asset.path, asset.byteSize]));
  const defaultBytes = [...uniqueDefault.values()].reduce((sum, bytes) => sum + bytes, 0);
  if (defaultBytes > 5_000_000) throw new Error(`Default referenced art is ${defaultBytes} bytes; release budget is 5,000,000.`);
  const initialOwners = new Set([
    ...catalog.starterOptions.map((row) => `critter:${row.critter_id}`),
    ...catalog.starterRollcasterOptions.map((row) => `rollcaster:${row.rollcaster_id}`),
  ]);
  const initialAssets = manifest.assets.filter((asset) => asset.variant === "default" && (
    ["element", "currency", "mana", "ui"].includes(asset.owner.category)
    || initialOwners.has(`${asset.owner.category}:${asset.owner.id}`)
  ));
  const uniqueInitial = new Map(initialAssets.map((asset) => [asset.path, asset.byteSize]));
  const initialBytes = [...uniqueInitial.values()].reduce((sum, bytes) => sum + bytes, 0);
  if (initialBytes > 750_000) throw new Error(`Initial-home release art is ${initialBytes} bytes; release budget is 750,000.`);
  return { defaultBytes, initialBytes };
}

const client = createDbClient(env);
try {
  await client.connect();
  await client.query("begin isolation level repeatable read read only");
  const catalog = await readCatalog(client);
  const { manifest: assetManifest, replacements } = await processAssets(catalog);
  applyAssetPaths(catalog, assetManifest, replacements);
  const assetBudgets = enforceReleaseAssetBudgets(catalog, assetManifest);
  validateCatalog(catalog);
  await client.query("commit");

  const releaseDir = path.join(outputRoot, "game-data", "releases", releaseId);
  await fs.mkdir(releaseDir, { recursive: true });
  const assetManifestBytes = Buffer.from(stableJson(assetManifest));
  const assetManifestHash = sha256(assetManifestBytes);
  const assetManifestName = `asset-manifest.${assetManifestHash.slice(0, 12)}.json`;
  await fs.mkdir(path.join(outputRoot, "game-assets"), { recursive: true });
  await fs.writeFile(path.join(outputRoot, "game-assets", assetManifestName), assetManifestBytes);

  const packDescriptors = [];
  const artifacts = [];
  for (const [key, pack] of Object.entries(createPacks(catalog, releaseId))) {
    const bytes = Buffer.from(stableJson(pack));
    const hash = sha256(bytes);
    const fileName = `${key}.${hash.slice(0, 12)}.json`;
    await fs.writeFile(path.join(releaseDir, fileName), bytes);
    packDescriptors.push({ key, url: fileName, sha256: hash, byteSize: bytes.length });
    artifacts.push({ key, kind: "catalog_pack", contentType: "application/json", hash, integrity: sriSha256(bytes), byteSize: bytes.length, objectPath: `game-data/releases/${releaseId}/${fileName}` });
  }

  const previous = (await rows(client, `select current_release_id as id from public.content_release_channels where channel='production'`).catch(() => []))[0]?.id ?? null;
  const releaseManifest = { schemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion: releaseId, publishedAt, minimumGameVersion, runtimeContractVersion: RUNTIME_CONTRACT_VERSION, serverCatalogVersion: releaseId, assetBaseUrl, assetManifestUrl: `../../../game-assets/${assetManifestName}`, assetManifestSha256: assetManifestHash, previousCatalogVersion: previous, packs: packDescriptors };
  const releaseBytes = Buffer.from(stableJson(releaseManifest));
  const releaseHash = sha256(releaseBytes);
  const releaseName = `release-manifest.${releaseHash.slice(0, 12)}.json`;
  await fs.writeFile(path.join(releaseDir, releaseName), releaseBytes);
  await fs.mkdir(path.join(outputRoot, "game-data"), { recursive: true });
  await fs.writeFile(path.join(outputRoot, "game-data", "latest.json"), stableJson({ schemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion: releaseId, releaseManifestUrl: `releases/${releaseId}/${releaseName}`, releaseManifestSha256: releaseHash, publishedAt, minimumGameVersion }));
  const uniqueAssets = new Map(assetManifest.assets.map((asset) => [asset.path, asset.byteSize]));
  await fs.writeFile(path.join(releaseDir, "release-report.json"), stableJson({ releaseId, publishedAt, packs: packDescriptors, assets: { variants: assetManifest.assets.length, objects: uniqueAssets.size, bytes: [...uniqueAssets.values()].reduce((sum, bytes) => sum + bytes, 0), defaultBytes: assetBudgets.defaultBytes, initialHomeBytes: assetBudgets.initialBytes } }));

  if (args.record) {
    await client.query("begin");
    await client.query(`insert into public.content_releases(id,schema_version,minimum_game_version,status,manifest_hash,manifest_path,previous_release_id,validated_at) values($1,$2,$3,'validated',$4,$5,$6,now()) on conflict(id) do update set schema_version=excluded.schema_version,minimum_game_version=excluded.minimum_game_version,status='validated',manifest_hash=excluded.manifest_hash,manifest_path=excluded.manifest_path,previous_release_id=excluded.previous_release_id,validated_at=now()`, [releaseId, CATALOG_SCHEMA_VERSION, minimumGameVersion, releaseHash, `game-data/releases/${releaseId}/${releaseName}`, previous]);
    await client.query('delete from public.content_release_artifacts where release_id=$1', [releaseId]);
    for (const artifact of [...artifacts, { key: "asset-manifest", kind: "asset_manifest", contentType: "application/json", hash: assetManifestHash, integrity: sriSha256(assetManifestBytes), byteSize: assetManifestBytes.length, objectPath: `game-assets/${assetManifestName}` }, { key: "release-manifest", kind: "release_manifest", contentType: "application/json", hash: releaseHash, integrity: sriSha256(releaseBytes), byteSize: releaseBytes.length, objectPath: `game-data/releases/${releaseId}/${releaseName}` }]) {
      await client.query(`insert into public.content_release_artifacts(release_id,artifact_key,artifact_kind,content_hash,integrity_hash,byte_size,object_path,content_type) values($1,$2,$3,$4,$5,$6,$7,$8)`, [releaseId, artifact.key, artifact.kind, artifact.hash, artifact.integrity, artifact.byteSize, artifact.objectPath, artifact.contentType]);
    }
    await client.query("commit");
  }
  process.stdout.write(`Validated release ${releaseId}: ${packDescriptors.length} packs, ${assetManifest.assets.length} asset variants.\nOutput: ${outputRoot}\nManifest SHA-256: ${releaseHash}\n`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
