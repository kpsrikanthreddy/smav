import React from 'react';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T, index: number) => React.ReactNode;
  hideOnMobile?: boolean;
}

export interface ResponsiveTableProps<T> {
  rows: T[];
  columns: TableColumn<T>[];
  keyExtractor: (row: T, index: number) => string;
  renderMobileCard: (row: T, index: number) => React.ReactNode;
  emptyState?: React.ReactNode;
}

export function ResponsiveTable<T>({
  rows,
  columns,
  keyExtractor,
  renderMobileCard,
  emptyState,
}: ResponsiveTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {/* Mobile stacked cards (< md) — zero horizontal overflow */}
      <div className="md:hidden space-y-2.5">
        {rows.map((row, idx) => (
          <div
            key={keyExtractor(row, idx)}
            className="bg-white border border-[#E5E7EC] rounded-2xl p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.03)]"
          >
            {renderMobileCard(row, idx)}
          </div>
        ))}
      </div>

      {/* Desktop / Tablet clean data table (md+) */}
      <div className="hidden md:block bg-white border border-[#E5E7EC] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(16,24,40,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F9FAFC] border-b border-[#E5E7EC] text-[11px] font-semibold uppercase tracking-wider text-[#6F737D]">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F1F5] text-xs text-[#2F3033]">
              {rows.map((row, idx) => (
                <tr key={keyExtractor(row, idx)} className="hover:bg-[#F9FAFC] transition-colors">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 align-middle ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {col.render(row, idx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
