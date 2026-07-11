"use client";

import AdminLogsTable from '@/components/AdminLogsTable';

export default function AdminLogsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-orbitron text-2xl font-bold text-white neon-text-cyan mb-2">
          Logs do Sistema
        </h1>
        <p className="text-gray-400 font-space text-sm">
          Visualize e pesquise logs do sistema em tempo real
        </p>
      </div>

      <AdminLogsTable initialType="combined" />
    </div>
  );
}
