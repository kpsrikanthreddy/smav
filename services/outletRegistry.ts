import type { SupabaseClient } from '@supabase/supabase-js';

/** Phase 2 foundation: DB-driven, read-only outlet discovery. No secret material leaves server. */
export interface OutletRuntimeConfig {
  outletId: string;
  outletCode: string;
  organizationId: string | null;
  hostingMode: 'smav_hosted' | 'external_supabase' | 'external_api' | 'hybrid';
  posTemplateId: string;
  externalApiBaseUrl: string | null;
  catalogEndpoint: string | null;
  staffEndpoint: string | null;
  catalogRevision: number;
}

export async function loadOutletRuntimeConfig(db: SupabaseClient, outletId: string): Promise<OutletRuntimeConfig> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId)) throw new Error('Invalid outlet ID');
  const { data: outlet, error: outletError } = await db.from('smav_outlets')
    .select('id,outlet_code,organization_id,is_active').eq('id', outletId).single();
  if (outletError || !outlet || !outlet.is_active) throw new Error('Outlet not found or inactive');
  const { data: cfg, error: configError } = await db.from('smav_outlet_configs')
    .select('outlet_id,organization_id,hosting_mode,pos_template_id,external_api_base_url,external_catalog_endpoint,external_staff_endpoint,catalog_revision')
    .eq('outlet_id', outletId).single();
  if (configError || !cfg) throw new Error('Outlet configuration missing');
  if (cfg.organization_id !== outlet.organization_id) throw new Error('Outlet organization mismatch');
  return {
    outletId: outlet.id, outletCode: outlet.outlet_code,
    organizationId: outlet.organization_id, hostingMode: cfg.hosting_mode,
    posTemplateId: cfg.pos_template_id, externalApiBaseUrl: cfg.external_api_base_url,
    catalogEndpoint: cfg.external_catalog_endpoint, staffEndpoint: cfg.external_staff_endpoint,
    catalogRevision: Number(cfg.catalog_revision)
  };
}

export async function listPosTemplates(db: SupabaseClient) {
  const { data, error } = await db.from('smav_pos_templates')
    .select('id,display_name,category,description,features,receipt_layout,is_active')
    .eq('is_active', true).order('display_name');
  if (error) throw error;
  return data ?? [];
}
