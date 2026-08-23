import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { validatePublishedCatalogContract } from './download-published-catalog.mjs'

const SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function validateCandidate(candidate, repoRoot) {
  if (!SEMVER.test(String(candidate.version ?? ''))) throw new Error('Candidate version must be SemVer.')
  if (candidate.channel !== 'stable') throw new Error('Candidate channel must be stable.')
  if (!SHA.test(String(candidate.sourceCommit ?? ''))) throw new Error('Candidate sourceCommit must be a full lowercase commit SHA.')
  if (!candidate.sourceTag || !candidate.releaseNotes?.trim()) throw new Error('Candidate tag and release notes are required.')
  if (!Number.isFinite(Date.parse(String(candidate.createdAt ?? '')))) throw new Error('Candidate createdAt must be an ISO timestamp.')
  if (!SHA.test(String(candidate.aiLabCommit ?? ''))) throw new Error('Candidate aiLabCommit must be a full lowercase commit SHA.')
  for (const field of ['clientProtocolVersion', 'contentSchemaVersion', 'combatRuntimeVersion']) {
    if (!Number.isInteger(candidate[field]) || candidate[field] < 1) throw new Error(`Candidate ${field} must be a positive integer.`)
  }
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(String(candidate.catalogRelease?.id ?? '')) || !SHA256.test(String(candidate.catalogRelease?.manifestSha256 ?? ''))) throw new Error('Candidate must pin an immutable Catalog Release ID and SHA-256.')
  validatePublishedCatalogContract(candidate)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(candidate.distribution?.repository ?? '')) || !candidate.distribution?.tag) throw new Error('Candidate must identify the release-only repository and immutable release tag.')
  execFileSync('git', ['cat-file', '-e', `${candidate.sourceCommit}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
  execFileSync('git', ['cat-file', '-e', `${candidate.sourceTag}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
  const tagged = execFileSync('git', ['rev-list', '-n', '1', candidate.sourceTag], { cwd: repoRoot, encoding: 'utf8' }).trim()
  if (tagged !== candidate.sourceCommit) throw new Error('Candidate tag does not resolve to sourceCommit.')
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  if (dirty) throw new Error('Tracked source worktree is not clean.')
  return candidate
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const candidateFile = path.resolve(process.argv[2] ?? 'release/game-update-candidate.json')
  const candidate = validateCandidate(JSON.parse(fs.readFileSync(candidateFile, 'utf8')), path.resolve('.'))
  console.log(JSON.stringify({ updateId: `${candidate.channel}:${candidate.version}`, sourceCommit: candidate.sourceCommit, catalogReleaseId: candidate.catalogRelease.id }))
}
