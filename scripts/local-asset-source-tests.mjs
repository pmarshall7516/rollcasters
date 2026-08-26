import fs from 'node:fs'

const runtime = fs.readFileSync('src/lib/supabase.ts', 'utf8')
const launcher = fs.readFileSync('scripts/dev-local.mjs', 'utf8')
const desktopPreview = fs.readFileSync('scripts/build-desktop-preview.mjs', 'utf8')
const vite = fs.readFileSync('vite.config.ts', 'utf8')
const styles = fs.readFileSync('src/styles.css', 'utf8')

if (/storage\.from\(GAME_ASSETS_BUCKET\)\.getPublicUrl/.test(runtime)) throw new Error('The Game still has a mutable remote asset URL fallback.')
if (!runtime.includes('if (!activeGameAssetBaseUrl) return null')) throw new Error('The Game must fail closed when no local/release asset base is configured.')
if (launcher.includes('VITE_LOCAL_ASSET_DIR') || launcher.includes('localAssetRoot')) throw new Error('Local Game development must not expose the workspace master-art directory.')
if (!launcher.includes("VITE_GAME_CATALOG_MODE: 'release'")) throw new Error('Local Game development must load an immutable Catalog Release.')
if (!launcher.includes('VITE_LOCAL_CATALOG_DIR: catalogRoot')) throw new Error('Local Game development must expose only the selected Catalog Release directory.')
if (!launcher.includes('VITE_GAME_ASSET_BASE_URL: `/@fs/${catalogPath}/game-assets`')) throw new Error('Local Game development is not pointed at the Catalog Release asset bundle.')
if (!desktopPreview.includes("VITE_GAME_LOCAL_CATALOG_PREVIEW: 'true'")) throw new Error('Desktop Catalog previews must ignore the live server Catalog acceptance version.')
if (!vite.includes('localCatalogDir') || !vite.includes('fs: { allow:')) throw new Error('Vite is not allowing the selected local Catalog Release to be served.')
if (vite.includes('localAssetDir') || vite.includes('VITE_LOCAL_ASSET_DIR')) throw new Error('Vite still allows the workspace master-art directory in the player Game.')
if (!styles.includes('border: 1px solid var(--border-bright); border-radius: var(--frame-radius); background: transparent;')) throw new Error('Game artwork frames must not paint opaque gutters behind transparent release sprites.')
if (!styles.includes('object-fit: contain !important')) throw new Error('Game artwork must preserve the full release sprite with contain fitting.')

console.log('Local Game asset source contract passed: no mutable remote fallback; local development serves only an immutable Catalog Release bundle.')
