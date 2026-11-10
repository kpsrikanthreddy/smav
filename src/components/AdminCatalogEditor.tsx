import React, { useState } from 'react';
import {
  Sparkles,
  Scissors,
  Utensils,
  Plus,
  Trash2,
  Edit2,
  Check,
  RefreshCw,
  AlertCircle,
  Tag,
  ArrowUpRight
} from 'lucide-react';
import { StaffSession, SalonService, RestaurantMenuItem } from '../types';

interface AdminCatalogEditorProps {
  session: StaffSession;
  salonServices: SalonService[];
  restaurantMenu: RestaurantMenuItem[];
  serverCatalogRevision: number;
  onRefreshCatalog: () => void;
  onPullSupabaseSync?: () => void;
  isPullingSupabase?: boolean;
}

export const AdminCatalogEditor: React.FC<AdminCatalogEditorProps> = ({
  session,
  salonServices,
  restaurantMenu,
  serverCatalogRevision,
  onRefreshCatalog,
  onPullSupabaseSync,
  isPullingSupabase = false
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // New Item Form State
  const [isAddingNew, setIsAddingNew] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newCategory, setNewCategory] = useState<string>(session.business_type === 'salon' ? 'Facial' : 'Shawarma');
  const [newPrice, setNewPrice] = useState<number>(100);

  const showFeedback = (text: string, type: 'success' | 'error') => {
    setFeedbackMsg({ text, type });
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  // Update Price Handler
  const handleSavePrice = async (item: SalonService | RestaurantMenuItem) => {
    setIsSubmitting(true);
    try {
      if (session.business_type === 'salon') {
        const srv = item as SalonService;
        const res = await fetch('/api/admin/catalog/service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service: {
              ...srv,
              price: Number(editingPrice)
            }
          })
        });
        const data = await res.json();
        if (data.success) {
          showFeedback(`Price updated to ₹${editingPrice}! Revision bumped to #${data.revision}`, 'success');
          setEditingId(null);
          onRefreshCatalog();
        } else {
          showFeedback(data.message || 'Failed to update price', 'error');
        }
      } else {
        const mnu = item as RestaurantMenuItem;
        const res = await fetch('/api/admin/catalog/menu-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item: {
              ...mnu,
              basePrice: Number(editingPrice)
            }
          })
        });
        const data = await res.json();
        if (data.success) {
          showFeedback(`Price updated to ₹${editingPrice}! Revision bumped to #${data.revision}`, 'success');
          setEditingId(null);
          onRefreshCatalog();
        } else {
          showFeedback(data.message || 'Failed to update price', 'error');
        }
      }
    } catch (e: any) {
      showFeedback(e.message || 'Network error', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add Item Handler
  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newPrice <= 0) return;

    setIsSubmitting(true);
    try {
      if (session.business_type === 'salon') {
        const newSrv = {
          id: 'srv_' + Math.random().toString(36).substring(2, 9),
          name: newName.trim(),
          category: newCategory,
          price: Number(newPrice),
          gstPercent: 18,
          isDiscountEligible: true,
          isActive: true
        };

        const res = await fetch('/api/admin/catalog/service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service: newSrv })
        });
        const data = await res.json();
        if (data.success) {
          showFeedback(`Added "${newName}" at Rev #${data.revision}`, 'success');
          setIsAddingNew(false);
          setNewName('');
          setNewPrice(100);
          onRefreshCatalog();
        }
      } else {
        const newMnu = {
          id: 'mnu_' + Math.random().toString(36).substring(2, 9),
          name: newName.trim(),
          category: newCategory,
          basePrice: Number(newPrice),
          isVeg: false,
          variants: [{ id: 'v_reg', name: 'Regular', priceDelta: 0 }]
        };

        const res = await fetch('/api/admin/catalog/menu-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: newMnu })
        });
        const data = await res.json();
        if (data.success) {
          showFeedback(`Added "${newName}" at Rev #${data.revision}`, 'success');
          setIsAddingNew(false);
          setNewName('');
          setNewPrice(100);
          onRefreshCatalog();
        }
      }
    } catch (e: any) {
      showFeedback(e.message || 'Error creating item', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete / Tombstone Item Handler
  const handleDeleteItem = async (id: string, name: string) => {
    if (!confirm(`Tombstone delete "${name}"? This increments the revision and pushes a tombstone to all connected POS agents.`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const url = session.business_type === 'salon'
        ? `/api/admin/catalog/service/${id}`
        : `/api/admin/catalog/menu-item/${id}`;

      const res = await fetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showFeedback(`Tombstoned "${name}" at Rev #${data.revision}`, 'success');
        onRefreshCatalog();
      }
    } catch (e: any) {
      showFeedback(e.message || 'Delete error', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              {session.business_type === 'salon' ? <Scissors className="w-5 h-5 text-rose-400" /> : <Utensils className="w-5 h-5 text-amber-400" />}
              Authoritative Supabase Master Catalog: {session.business_name}
            </h3>
            <span className="bg-sky-500/20 text-sky-400 text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border border-sky-500/30">
              Rev #{serverCatalogRevision}
            </span>
            <a
              href={session.business_type === 'salon' ? 'https://onswigwiwuvkvoduuhxr.supabase.co' : 'https://uyqdnqbadfysnbzbncyj.supabase.co'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-mono px-2.5 py-0.5 rounded-full border border-emerald-500/20 transition"
              title="Open authoritative Supabase database"
            >
              <span>{session.business_type === 'salon' ? 'https://onswigwiwuvkvoduuhxr.supabase.co' : 'https://uyqdnqbadfysnbzbncyj.supabase.co'}</span>
              <ArrowUpRight className="w-3 h-3 text-emerald-400" />
            </a>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Single authoritative catalog master for Website, Android App, and SMAV Print Agent POS. Edits auto-broadcast to all devices.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onPullSupabaseSync && (
            <button
              onClick={onPullSupabaseSync}
              disabled={isPullingSupabase}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md disabled:opacity-50"
              title="Pull latest live catalog, services, stylists and menu items from authoritative Supabase project"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPullingSupabase ? 'animate-spin' : ''}`} />
              <span>{isPullingSupabase ? 'Syncing Supabase...' : 'Sync Supabase'}</span>
            </button>
          )}

          <button
            onClick={() => setIsAddingNew(!isAddingNew)}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md"
          >
            <Plus className="w-4 h-4" />
            {isAddingNew ? 'Cancel New Item' : 'Add New Item / Service'}
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className={`p-3.5 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
          feedbackMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
        }`}>
          <AlertCircle className="w-4 h-4" />
          {feedbackMsg.text}
        </div>
      )}

      {/* Add New Item Drawer */}
      {isAddingNew && (
        <form onSubmit={handleAddNewItem} className="bg-slate-900/95 border border-emerald-500/30 rounded-2xl p-5 space-y-4 shadow-xl">
          <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
            Create Master Item (Will Bump Monotonic Revision Cursor)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Item / Service Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={session.business_type === 'salon' ? 'e.g. Japanese Silk Spa' : 'e.g. Peri-Peri Shawarma'}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
              <input
                type="text"
                required
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Category"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Price (₹)</label>
              <input
                type="number"
                required
                min={1}
                value={newPrice}
                onChange={(e) => setNewPrice(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md flex items-center gap-2"
          >
            {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Save & Broadcast Monotonic Revision
          </button>
        </form>
      )}

      {/* Catalog Table */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-3 font-semibold">Item & Category</th>
                <th className="px-6 py-3 font-semibold">Authoritative Price</th>
                <th className="px-6 py-3 font-semibold">Row Revision</th>
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {session.business_type === 'salon' ? (
                salonServices.map((srv) => (
                  <tr key={srv.id} className="hover:bg-slate-850/50 transition">
                    <td className="px-6 py-4">
                      <p className="font-bold text-white">{srv.name}</p>
                      <p className="text-[11px] text-slate-400">{srv.category} {srv.subcategory ? `• ${srv.subcategory}` : ''}</p>
                    </td>
                    <td className="px-6 py-4">
                      {editingId === srv.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={editingPrice}
                            onChange={(e) => setEditingPrice(Number(e.target.value))}
                            className="w-24 bg-slate-950 border border-sky-500 rounded px-2 py-1 text-xs text-white"
                          />
                          <button
                            onClick={() => handleSavePrice(srv)}
                            disabled={isSubmitting}
                            className="bg-sky-600 hover:bg-sky-500 text-white p-1 rounded"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="font-bold text-emerald-400 text-sm">₹{srv.price}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-slate-400 text-[11px]">Rev #{srv.revision}</span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => {
                          setEditingId(srv.id);
                          setEditingPrice(srv.price);
                        }}
                        className="text-sky-400 hover:text-sky-300 font-semibold p-1"
                        title="Edit Price"
                      >
                        <Edit2 className="w-4 h-4 inline" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(srv.id, srv.name)}
                        className="text-rose-400 hover:text-rose-300 font-semibold p-1"
                        title="Tombstone Delete"
                      >
                        <Trash2 className="w-4 h-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                restaurantMenu.map((mnu) => (
                  <tr key={mnu.id} className="hover:bg-slate-850/50 transition">
                    <td className="px-6 py-4">
                      <p className="font-bold text-white">{mnu.name}</p>
                      <p className="text-[11px] text-slate-400">{mnu.category} • {mnu.isVeg ? 'Veg' : 'Non-Veg'}</p>
                    </td>
                    <td className="px-6 py-4">
                      {editingId === mnu.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={editingPrice}
                            onChange={(e) => setEditingPrice(Number(e.target.value))}
                            className="w-24 bg-slate-950 border border-amber-500 rounded px-2 py-1 text-xs text-white"
                          />
                          <button
                            onClick={() => handleSavePrice(mnu)}
                            disabled={isSubmitting}
                            className="bg-amber-600 hover:bg-amber-500 text-white p-1 rounded"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="font-bold text-amber-400 text-sm">₹{mnu.basePrice}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-slate-400 text-[11px]">Rev #{mnu.revision}</span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => {
                          setEditingId(mnu.id);
                          setEditingPrice(mnu.basePrice);
                        }}
                        className="text-sky-400 hover:text-sky-300 font-semibold p-1"
                        title="Edit Price"
                      >
                        <Edit2 className="w-4 h-4 inline" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(mnu.id, mnu.name)}
                        className="text-rose-400 hover:text-rose-300 font-semibold p-1"
                        title="Tombstone Delete"
                      >
                        <Trash2 className="w-4 h-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
