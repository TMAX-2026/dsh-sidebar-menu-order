#!/usr/bin/env node
/**
 * Generate (or update) a plugin-market index (format 1) for this bundle.
 *
 * The document is validated with the exact parser DSH ships
 * (`@deepseek-ai/dsh-plugin-market-index`), so a successful run means the
 * Discover tab will accept it.
 *
 * Usage:
 *   node scripts/make-index.mjs --published-at 1763900000
 *   node scripts/make-index.mjs --published-at 1763900000 --index-url https://example.com/market/index.json
 *   node scripts/make-index.mjs --published-at 1763900000 --out market/index.json --icon-url https://example.com/icon.svg
 *
 * Options:
 *   --published-at <seconds>  npm publish time of the package version, Unix seconds (default: now)
 *   --out <path>              output file (default: market/index.json)
 *   --index-url <url>         public URL the index will be served at (default: https://example.com/plugin-index.json)
 *   --index-title <json>      localized index title (default: {"en":"Plugins","zh":"插件"})
 *   --index-description <json> localized index description
 *   --icon-url <url>          icon URL; by default icon.svg is embedded as a data: URL
 *   --dry-run                 print the document and validation result without writing
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/u, '')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}

const dryRun = process.argv.includes('--dry-run')
const outPath = resolve(root, arg('out', 'market/index.json'))
const indexUrl = arg('index-url', 'https://example.com/plugin-index.json')
const iconUrl = arg('icon-url', undefined)

/** Resolve the publish timestamp: seconds, an ISO date, or the registry (`--from-npm`). */
async function resolvePublishedAt() {
  const raw = arg('published-at', undefined)
  if (raw !== undefined) {
    if (/[T:-]/u.test(raw)) {
      const parsed = Date.parse(raw)
      if (!Number.isFinite(parsed)) {
        console.error('--published-at must be Unix seconds or an ISO date')
        process.exit(1)
      }
      return Math.floor(parsed / 1000)
    }
    return Number(raw)
  }
  if (process.argv.includes('--from-npm')) {
    // Read the packument straight from the registry: no shell, no npm cache.
    try {
      const registry = (process.env.npm_config_registry ?? 'https://registry.npmjs.org/').replace(/\/?$/u, '/')
      const documentUrl = new URL(encodeURIComponent(pkg.name), registry)
      const response = await fetch(documentUrl, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${documentUrl.href}`)
      const document = await response.json()
      const iso = document?.time?.[pkg.version]
      if (typeof iso !== 'string') throw new Error(`version ${pkg.version} is not published in ${registry}`)
      return Math.floor(Date.parse(iso) / 1000)
    } catch (error) {
      console.error(`--from-npm could not read the publish time for ${pkg.name}@${pkg.version}: ${error.message}`)
      process.exit(1)
    }
  }
  return Math.floor(Date.now() / 1000)
}

const publishedAt = await resolvePublishedAt()
if (!Number.isInteger(publishedAt) || publishedAt < 0 || publishedAt >= 1e11) {
  console.error('--published-at must be an integer number of Unix seconds')
  process.exit(1)
}
if (pkg.private === true) console.warn('warning: package.json still declares "private": true — it cannot be published as-is')
if (typeof pkg.name === 'string' && pkg.name.startsWith('@local/')) {
  console.warn('warning: the package name is scoped to @local/* — rename it to a public npm name before publishing')
}

function readMeta(language, fallback) {
  const path = join(root, 'locale', language + '.json')
  if (!existsSync(path)) return fallback
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8')).meta ?? {}
    return {
      title: typeof meta.title === 'string' ? meta.title : fallback.title,
      description: typeof meta.description === 'string' ? meta.description : fallback.description,
    }
  } catch (error) {
    console.warn(`warning: ${path} is not valid JSON (${error.message})`)
    return fallback
  }
}

const fallback = { title: pkg.name, description: pkg.description ?? '' }
const en = readMeta('en', fallback)
const zh = readMeta('zh', fallback)
const localized = (value) => (value.en === value.zh ? { en: value.en } : { en: value.en, zh: value.zh })

const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
const homepage = typeof pkg.homepage === 'string' ? pkg.homepage : undefined

// Optional taxonomy: index-level categories/labels and per-plugin assignments.
// Kept in a data file so this generator stays repository-agnostic.
const taxonomyPath = join(root, 'market', 'taxonomy.json')
let taxonomy = {}
if (existsSync(taxonomyPath)) {
  try {
    taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8'))
  } catch (error) {
    console.warn(`warning: ${taxonomyPath} is not valid JSON (${error.message})`)
  }
}
const entryMeta = taxonomy.entries?.[pkg.name] ?? {}
const taxonomyMetadata = {
  categories: taxonomy.categories ?? {},
  labels: taxonomy.labels ?? {},
  sortKeys: taxonomy.sortKeys ?? {},
}
const hasTaxonomy = Object.keys(taxonomyMetadata.categories).length > 0
  || Object.keys(taxonomyMetadata.labels).length > 0
  || Object.keys(taxonomyMetadata.sortKeys).length > 0

let icon = iconUrl
if (icon === undefined) {
  const svgPath = join(root, 'icon.svg')
  if (existsSync(svgPath)) {
    const svg = readFileSync(svgPath)
    if (svg.length <= 32 * 1024) icon = 'data:image/svg+xml;base64,' + svg.toString('base64')
    else console.warn('warning: icon.svg exceeds 32 KiB; pass --icon-url instead')
  }
}

const entry = {
  name: pkg.name,
  title: localized({ en: en.title, zh: zh.title }),
  description: localized({ en: en.description || fallback.description, zh: zh.description || fallback.description }),
  ...(icon === undefined ? {} : { icon }),
  ...(typeof pkg.author === 'string' ? { author: pkg.author } : {}),
  ...(homepage === undefined ? {} : { homepage }),
  ...(repository === undefined ? {} : { repository: { url: repository.replace(/^git\+/u, '').replace(/\.git$/u, '') } }),
  metadata: {
    ...(typeof entryMeta.category === 'string' ? { category: entryMeta.category } : {}),
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
    ...(Array.isArray(entryMeta.labels) && entryMeta.labels.length > 0 ? { labels: entryMeta.labels } : {}),
    ...(entryMeta.sortKeys !== null && typeof entryMeta.sortKeys === 'object' ? { sortKeys: entryMeta.sortKeys } : {}),
  },
  versions: [{
    version: pkg.version,
    publishTimestamp: publishedAt,
    source: { type: 'npm' },
    ...(typeof pkg.engines?.dsh === 'string' ? { engines: { dsh: pkg.engines.dsh } } : {}),
  }],
}

// Keep other plugins and earlier versions of this plugin when updating an index in place.
const index = {
  format: 1,
  title: JSON.parse(arg('index-title', JSON.stringify({ en: 'Plugins', zh: '插件' }))),
  ...(arg('index-description', undefined) === undefined
    ? {}
    : { description: JSON.parse(arg('index-description')) }),
  metadata: hasTaxonomy ? taxonomyMetadata : {},
  plugins: [entry],
}
if (existsSync(outPath) && !dryRun) {
  try {
    const previous = JSON.parse(readFileSync(outPath, 'utf8'))
    if (previous.format === 1 && Array.isArray(previous.plugins)) {
      if (!hasTaxonomy) index.metadata = previous.metadata ?? {}
      index.plugins = previous.plugins.filter(plugin => plugin?.name !== entry.name).concat(entry)
      const existing = previous.plugins.find(plugin => plugin?.name === entry.name)
      if (Array.isArray(existing?.versions)) {
        entry.versions = existing.versions.filter(version => version?.version !== pkg.version).concat(entry.versions)
      }
    }
  } catch (error) {
    console.warn(`warning: could not merge the existing ${outPath}: ${error.message}`)
  }
}
entry.versions.sort((a, b) => (a.version === b.version ? 0 : a.version < b.version ? 1 : -1))

// Validate with the parser DSH itself uses, then print the install spec per version.
let valid = true
let marketInstallTarget
try {
  const installDir = process.env.DSH_INSTALL_DIR
  if (installDir === undefined) throw new Error('DSH_INSTALL_DIR is not set')
  const requireFromInstall = createRequire(join(installDir, 'package.json'))
  const parserPath = requireFromInstall.resolve('@deepseek-ai/dsh-plugin-market-index')
  const parser = await import(pathToFileURL(parserPath).href)
  const parsed = parser.parseMarketIndex(index, indexUrl)
  marketInstallTarget = parser.marketInstallTarget
  console.log(`validated: ${parsed.plugins.length} plugin(s), ${parsed.plugins[0].versions.length} version(s)`)
} catch (error) {
  valid = false
  console.error('index validation failed: ' + error.message)
  if (error.path !== undefined) console.error('  at ' + error.path)
}

if (!dryRun && valid) {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n', 'utf8')
  console.log('wrote ' + outPath)
}
if (dryRun) console.log(JSON.stringify(index, null, 2))
for (const version of entry.versions) {
  if (marketInstallTarget === undefined) break
  const target = marketInstallTarget(entry.name, version)
  console.log(`install ${version.version}: target=${target.spec}${target.registry === undefined ? '' : ' registry=' + target.registry}`)
}
process.exitCode = valid ? 0 : 1
