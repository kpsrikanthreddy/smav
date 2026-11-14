export type UserRole = 'superadmin' | 'admin' | 'staff';
export type VisibleRole = 'SUPERADMIN' | 'ADMIN' | 'POS_BILLING';
export type BusinessCategory = 'restaurant' | 'salon' | 'retail' | 'other';

export function getVisibleRole(role?: string): VisibleRole {
  const r = (role || '').trim().toLowerCase();
  if (r === 'superadmin') return 'SUPERADMIN';
  if (r === 'admin' || r === 'owner' || r === 'manager') return 'ADMIN';
  return 'POS_BILLING';
}

export interface Outlet {
  id: string;
  code: string;
  name: string;
  category: BusinessCategory;
  address: string;
  phone: string;
  gstin: string;
  receiptHeader: string;
  receiptFooter: string;
  providerType: 'supabase_salon' | 'supabase_restaurant' | 'central_smav' | 'custom_outlet';
  supabaseUrl?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserOutletMembership {
  outletId: string;
  outletCode: string;
  outletName: string;
  outletCategory: BusinessCategory;
  role: UserRole;
  displayRole?: VisibleRole;
  specificTitle?: string;
  permissions: string[];
  isPrimary: boolean;
}

export interface UserSession {
  token: string;
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  displayRole?: VisibleRole;
  activeOutlet: Outlet;
  assignedOutlets?: UserOutletMembership[];
  specificTitle: string;
  permissions: string[];
  deviceId: string;
  createdAt: string;
  expiresAt?: string;
  supabaseToken?: string;
  platformRole?: string;
  // Backward compatibility fields
  user_id?: string;
  user_name?: string;
  business_id?: string;
  business_type?: 'salon' | 'restaurant' | 'retail' | 'other';
  business_name?: string;
  branch_id?: string;
  branch_code?: string;
  branch_name?: string;
}

// Backward compatibility alias
export type StaffSession = UserSession;

export interface AvailableBusiness {
  outletId?: string;
  outletCode?: string;
  outletName?: string;
  outletCategory?: BusinessCategory;
  business_id?: string;
  business_name?: string;
  business_type?: 'salon' | 'restaurant' | 'retail' | 'other';
  branch_id?: string;
  branch_code?: string;
  branch_name?: string;
  role: string;
  specificTitle?: string;
}

export interface SalonService {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  price: number;
  gstPercent: number;
  durationMinutes?: number;
  isDiscountEligible: boolean;
  isActive: boolean;
  revision: number;
  isDeleted?: boolean;
}

export interface Stylist {
  id: string;
  name: string;
  specialty: string;
  branchId: string;
  phone?: string;
  isAvailable: boolean;
}

export interface Appointment {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  stylistId: string;
  stylistName: string;
  appointmentTime: string;
  status: string;
}

export interface RestaurantMenuItem {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  basePrice: number;
  isVeg: boolean;
  variants: Array<{ id: string; name: string; priceDelta: number }>;
  revision: number;
  isDeleted?: boolean;
}

export interface RestaurantTable {
  tableNumber: string;
  capacity: number;
  status: string;
  currentOrderId?: string;
}

export interface RetailProduct {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  sku: string;
  price: number;
  gstPercent: number;
  stockQty: number;
  barcode: string;
  isActive: boolean;
  isDeleted?: boolean;
  revision: number;
}

export interface RetailCartItem {
  product: RetailProduct;
  quantity: number;
  discountPercent: number;
  addedPrice: number;
  addedRevision: number;
}

export interface Device {
  id: string;
  device_id: string;
  outlet_id?: string;
  outlet_code?: string;
  business_id?: string;
  branch_id?: string;
  device_name: string;
  model_info: string;
  assigned_role: string;
  last_seen_at: string;
  is_active: boolean;
}

export interface WhatsAppMsg {
  id: string;
  recipient_phone: string;
  template_name: string;
  bill_or_order_id: string;
  status: 'queued' | 'sent' | 'delivered';
  created_at: string;
}

export interface SyncEventItem {
  id: string;
  timestamp: string;
  businessId: string;
  revision: number;
  eventType: 'UPDATE' | 'INSERT' | 'DELETE' | 'FULL_RECONCILE' | 'CONNECTED';
  details: string;
  source: 'supabase_realtime' | 'sse' | 'delta_sync' | 'supabase_authoritative';
}

export interface SalonCartItem {
  service: SalonService;
  stylist: Stylist | null;
  quantity: number;
  discountPercent: number;
  addedPrice: number;
  addedRevision: number;
}

export interface RestaurantCartItem {
  item: RestaurantMenuItem;
  variantName?: string;
  unitPrice: number;
  quantity: number;
  notes: string;
  addedPrice: number;
  addedRevision: number;
}

export interface AuditLogEntry {
  id: string;
  eventType: string;
  actorId?: string;
  actorEmail?: string;
  outletId?: string;
  ipAddress?: string;
  details: Record<string, any>;
  timestamp: string;
}
