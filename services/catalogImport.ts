import type { SupabaseClient } from '@supabase/supabase-js';

export interface SourceCatalogItem {
  external_item_id: string;
  item_type: 'service' | 'menu_item';
  name: string;
  category: string;
  subcategory: string;
  price: number;
  is_active: boolean;
  is_deleted: boolean;
  duration_minutes?: number | null;
  is_veg?: boolean | null;
  variants?: unknown[];
}

/** Compare only; never modifies a catalog or calls an external URL. */
export async function previewCatalogImport(
  db: SupabaseClient, outletId: string, sourceItems: SourceCatalogItem[]
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId)) throw new Error('Invalid outlet ID');
  if (sourceItems.length > 10000) throw new Error('Catalog exceeds preview limit');
  const ids = new Set<string>();
  for (const item of sourceItems) {
    if (!item.external_item_id || ids.has(item.external_item_id) || !item.name.trim() ||
        !Number.isFinite(item.price) || item.price < 0) throw new Error('Invalid or duplicate source item');
    ids.add(item.external_item_id);
  }
  const existing = new Map<string, Record<string, any>>();
  let offset = 0;
  while (true) {
    const { data, error } = await db.from('smav_catalog_items')
      .select('external_item_id,name,category,subcategory,price,is_active,is_deleted')
      .eq('outlet_id', outletId).not('external_item_id', 'is', null)
      .order('id').range(offset, offset + 499);
    if (error) throw new Error('Central catalog comparison unavailable');
    for (const row of data ?? []) existing.set(row.external_item_id, row);
    if (!data || data.length < 500) break;
    offset += 500;
  }
  let newItems = 0, changedItems = 0, unchangedItems = 0;
  for (const item of sourceItems) {
    const row = existing.get(item.external_item_id);
    if (!row) { newItems++; continue; }
    const changed = row.name !== item.name || row.category !== item.category ||
      row.subcategory !== item.subcategory || Number(row.price) !== item.price ||
      row.is_active !== item.is_active || row.is_deleted !== item.is_deleted;
    if (changed) changedItems++; else unchangedItems++;
  }
  return {
    sourceCount: sourceItems.length, centralCount: existing.size,
    newItems, changedItems, unchangedItems,
    missingFromSource: [...existing.keys()].filter(id => !ids.has(id)).length,
    warning: 'Read-only preview. Missing source items are NOT deleted; verify source completeness before importing.'
  };
}

/** Initial insert-only import. Existing catalog rows are never updated or deleted. */
export async function importMissingCatalogItems(
  db: SupabaseClient, outletId: string, sourceItems: SourceCatalogItem[],
  expectedSourceCount: number
) {
  if (!Number.isSafeInteger(expectedSourceCount) || expectedSourceCount !== sourceItems.length ||
      expectedSourceCount < 1 || expectedSourceCount > 1000) {
    throw new Error('Source catalog count changed; run preflight again');
  }
  // Reuse the strict source validation and tenant-scoped central comparison.
  const before = await previewCatalogImport(db, outletId, sourceItems);
  if (before.sourceCount !== expectedSourceCount) throw new Error('Source count mismatch');
  let inserted = 0, skipped = 0;
  const failures: Array<{ externalItemId: string; message: string }> = [];
  for (const item of sourceItems) {
    // Do not overwrite existing rows, including manually modified prices.
    const { data: existing, error: readError } = await db.from('smav_catalog_items')
      .select('id').eq('outlet_id', outletId)
      .eq('external_item_id', item.external_item_id).limit(1);
    if (readError) throw new Error('Catalog import read failed; stopped');
    if (existing?.length) { skipped++; continue; }
    const { error } = await db.from('smav_catalog_items').insert({
      outlet_id: outletId,
      external_item_id: item.external_item_id,
      item_type: item.item_type,
      name: item.name.trim(),
      category: item.category || 'General',
      subcategory: item.subcategory || '',
      price: item.price,
      is_active: item.is_active,
      is_deleted: item.is_deleted,
      ...(item.duration_minutes == null ? {} : { duration_minutes: item.duration_minutes }),
      ...(item.is_veg == null ? {} : { is_veg: item.is_veg }),
      ...(item.variants ? { variants: item.variants } : {})
    });
    if (error) {
      // Unique conflicts may occur on concurrent imports; never turn them into overwrites.
      failures.push({ externalItemId: item.external_item_id, message: error.code === '23505' ? 'Already inserted concurrently' : 'Insert rejected' });
    } else inserted++;
  }
  return { outletId, sourceCount: sourceItems.length, inserted, skipped, failed: failures.length,
    failures, existingBefore: before.centralCount, writePerformed: inserted > 0,
    note: 'Insert-only: existing items and missing-from-source items were not modified or deleted.' };
}
