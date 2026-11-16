import type { SupabaseClient } from '@supabase/supabase-js';
import { loadOutletRuntimeConfig, type OutletRuntimeConfig } from './outletRegistry';

/** Read-only adapter contract. Mutations, external credentials and sync are deliberately out of scope. */
export interface CatalogPage {
  outletId: string;
  outletCode: string;
  source: 'central_smav';
  revision: number;
  items: Record<string, unknown>[];
  nextOffset: number | null;
}

export interface OutletCatalogAdapter {
  readonly kind: string;
  listCatalog(db: SupabaseClient, config: OutletRuntimeConfig, limit: number, offset: number): Promise<CatalogPage>;
}

class CentralCatalogAdapter implements OutletCatalogAdapter {
  readonly kind = 'central_smav';

  async listCatalog(db: SupabaseClient, config: OutletRuntimeConfig, limit: number, offset: number): Promise<CatalogPage> {
    // The caller-scoped Supabase JWT enforces RLS; outlet_id is also filtered explicitly.
    const { data, error } = await db.from('smav_catalog_items')
      .select('id,outlet_id,external_item_id,item_type,name,category,subcategory,sku,barcode,unit_type,unit_step,price,tax_percent,is_tax_inclusive,is_discount_eligible,duration_minutes,is_veg,stock_qty,variants,attributes,sort_order,revision')
      .eq('outlet_id', config.outletId)
      .eq('is_active', true).eq('is_deleted', false)
      .order('sort_order', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + limit);
    if (error) throw new Error(`Central catalog read failed: ${error.message}`);
    const rows = data ?? [];
    return {
      outletId: config.outletId,
      outletCode: config.outletCode,
      source: 'central_smav',
      revision: config.catalogRevision,
      items: rows.slice(0, limit),
      nextOffset: rows.length > limit ? offset + limit : null
    };
  }
}

const centralCatalogAdapter = new CentralCatalogAdapter();

/**
 * Hybrid outlets use the central catalog only when populated. We do not silently
 * fetch external endpoints: outbound calls require approved credential storage,
 * SSRF protections, timeouts, and explicit per-outlet mapping.
 */
export async function loadCentralOutletCatalog(
  db: SupabaseClient, outletId: string, limit = 100, offset = 0
): Promise<CatalogPage> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new Error('Invalid catalog pagination');
  }
  const config = await loadOutletRuntimeConfig(db, outletId);
  if (!['smav_hosted', 'hybrid'].includes(config.hostingMode)) {
    throw new Error('External catalog adapter not configured; no remote request was attempted');
  }
  return centralCatalogAdapter.listCatalog(db, config, limit, offset);
}

/** Incremental catalog feed for authorized clients. Includes tombstones so devices can remove stale items. */
export interface CatalogChangesPage {
  outletId: string;
  outletCode: string;
  source: 'central_smav';
  sinceRevision: number;
  snapshotRevision: number;
  changes: Record<string, unknown>[];
  nextOffset: number | null;
}

export async function loadCentralCatalogChanges(
  db: SupabaseClient, outletId: string, sinceRevision: number, limit = 100, offset = 0
): Promise<CatalogChangesPage> {
  if (!Number.isSafeInteger(sinceRevision) || sinceRevision < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new Error('Invalid catalog change pagination');
  }
  const config = await loadOutletRuntimeConfig(db, outletId);
  if (!['smav_hosted', 'hybrid'].includes(config.hostingMode)) {
    throw new Error('Central catalog changes are not configured for this outlet');
  }
  const snapshotRevision = config.catalogRevision;
  if (!Number.isSafeInteger(snapshotRevision) || snapshotRevision < 0) {
    throw new Error('Invalid catalog revision');
  }
  const { data, error } = await db.from('smav_catalog_items')
    .select('id,outlet_id,external_item_id,item_type,name,category,subcategory,sku,barcode,unit_type,unit_step,price,tax_percent,is_tax_inclusive,is_discount_eligible,duration_minutes,is_veg,stock_qty,variants,attributes,sort_order,is_active,is_deleted,revision,updated_at')
    .eq('outlet_id', config.outletId)
    .gt('revision', sinceRevision)
    .lte('revision', snapshotRevision)
    .order('revision', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + limit);
  if (error) throw new Error(`Central catalog changes unavailable: ${error.message}`);
  const rows = data ?? [];
  return {
    outletId: config.outletId,
    outletCode: config.outletCode,
    source: 'central_smav',
    sinceRevision,
    snapshotRevision,
    changes: rows.slice(0, limit),
    nextOffset: rows.length > limit ? offset + limit : null
  };
}
