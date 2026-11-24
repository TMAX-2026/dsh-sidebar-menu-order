/**
 * Host half of the sidebar menu order plugin.
 *
 * The browser half reorders the left navigation by shadowing the
 * `sidebar.panellist` registrations, and it needs an order that survives
 * restarts. This half contributes exactly one durable field to the profile:
 * a VOLATILE `order` array in this entry's Config. The Host settings service
 * exposes volatile fields as a settings namespace keyed by the profile entry
 * id (`sidebar-menu-order`), so the browser reads and writes the order through
 * the ordinary settings form without any custom Remote: writes land in the
 * active profile's Cordis patch, and a volatile field is updated in place
 * without restarting this plugin.
 *
 * This package imports `@deepseek-ai/schemastery`, which dsh carries in its own
 * installation. A published package installed into a profile resolves it
 * through the profile's resolution roots; a linked development checkout sits
 * outside those roots, so the schema module falls back to a `createRequire`
 * anchored at `DSH_INSTALL_DIR`. When neither lookup works the entry still
 * activates without a Config and the browser half keeps the order in its
 * browser-local cache.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Resolve schemastery from the running dsh installation when the normal import is unavailable. */
function loadSchemaFromInstall() {
  const installDir = process.env.DSH_INSTALL_DIR
  if (installDir === undefined || installDir.length === 0) throw new Error('DSH_INSTALL_DIR is not set')
  const requireFromInstall = createRequire(join(installDir, 'package.json'))
  const loaded = requireFromInstall('@deepseek-ai/schemastery')
  return loaded.default ?? loaded
}

/**
 * Prefer the ordinary import a published package resolves through the profile;
 * fall back to the installation anchor for a linked development checkout, whose
 * real path sits outside the profile's module-resolution roots.
 */
async function loadSchema() {
  try {
    const loaded = await import('@deepseek-ai/schemastery')
    return loaded.default ?? loaded
  } catch (importError) {
    try {
      return loadSchemaFromInstall()
    } catch (fallbackError) {
      console.warn(
        '[sidebar-menu-order] schemastery is unavailable; the order will only persist in this browser',
        importError,
        fallbackError,
      )
      return undefined
    }
  }
}

const schema = await loadSchema()

/** Durable order field; one entry per sidebar panel id, top to bottom. */
export const Config = schema === undefined
  ? undefined
  : schema.object({
    order: schema.array(schema.string()).default([]).volatile().description(
      'Sidebar menu order, top to bottom, as panel ids (for example "plugins", "schedules", "deepseek"). '
      + 'Maintained by the plugin\'s own Reorder menu action; it may be edited here as well.',
    ),
  })

/**
 * Activate the entry. The Config field is the whole contribution; the browser
 * half owns the behavior.
 */
export function apply() {}
