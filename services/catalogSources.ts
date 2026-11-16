import type { SourceCatalogItem } from './catalogImport';
import type { OutletRuntimeConfig } from './outletRegistry';

export type CatalogSourceResult = { items: SourceCatalogItem[]; source: string; fresh: boolean };
export type CatalogSourceAdapter = (config: OutletRuntimeConfig) => Promise<CatalogSourceResult>;
const adapters = new Map<string, CatalogSourceAdapter>();

/** Register adapters once at startup; routes never contain outlet-specific mapping logic. */
export function registerCatalogSource(key: string, adapter: CatalogSourceAdapter) {
  if (!key || adapters.has(key)) throw new Error('Duplicate or invalid catalog adapter');
  adapters.set(key, adapter);
}

export async function resolveCatalogSource(config: OutletRuntimeConfig): Promise<CatalogSourceResult> {
  // Explicitly fail closed. Never guess an endpoint or fetch arbitrary DB-configured URLs.
  const adapter = adapters.get(config.outletCode);
  if (!adapter) throw new Error('Catalog source not configured for outlet');
  const result = await adapter(config);
  if (!result.items.length || result.items.length > 10000) throw new Error('Source catalog empty or too large');
  return result;
}

/** Existing Glossy Looks public API adapter, now isolated from generic routes. */
export const glossyLooksSource: CatalogSourceAdapter = async () => {
  const [sr, cr] = await Promise.all([
    fetch('https://www.glossylooks.in/api/services', { signal: AbortSignal.timeout(10000) }),
    fetch('https://www.glossylooks.in/api/categories', { signal: AbortSignal.timeout(10000) })
  ]);
  if (!sr.ok || !cr.ok) throw new Error('Glossy Looks source unavailable');
  const [services, categories]: [unknown, unknown] = await Promise.all([sr.json(), cr.json()]);
  if (!Array.isArray(services) || !Array.isArray(categories)) throw new Error('Invalid source response');
  const categoryMap = new Map(categories.map((c: any) => [String(c.id), String(c.name)]));
  return { source: 'glossylooks-api', fresh: true, items: services.map((s: any) => ({
    external_item_id: String(s.id ?? ''), item_type: 'service' as const,
    name: String(s.name ?? ''), category: categoryMap.get(String(s.category_id)) || 'Salon',
    subcategory: String(s.salon_subcategory || (s.description ? String(s.description).slice(0, 45) : '')),
    price: Number(s.price), is_active: s.is_active !== false, is_deleted: false,
    duration_minutes: Number(s.duration_minutes) || 45
  })) };
};
