'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Client } from '@/lib/types'
import { Phone, Building2, Edit2, Trash2, Wifi } from 'lucide-react'

interface Props {
  client: Client
  onDelete: () => void
}

export default function ClientCard({ client, onDelete }: Props) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`¿Eliminar a "${client.nombre}"? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    await fetch(`/api/clients/${client.id}`, { method: 'DELETE' })
    onDelete()
  }

  const badges = [
    client.logs_enabled && 'Logs',
    client.offhours_enabled && 'Off-hours',
    client.escalate_enabled && 'Escalado',
  ].filter(Boolean) as string[]

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-indigo-500/50 transition-all flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate">{client.nombre}</h3>
          {client.tipo_negocio && (
            <div className="flex items-center gap-1.5 mt-1">
              <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-400 truncate">{client.tipo_negocio}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 bg-green-500/10 border border-green-500/30 rounded-full px-2 py-0.5 ml-2 shrink-0">
          <Wifi className="w-3 h-3 text-green-400" />
          <span className="text-xs text-green-400 font-medium">Activo</span>
        </div>
      </div>

      {/* WhatsApp number */}
      <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2">
        <Phone className="w-3.5 h-3.5 text-green-400 shrink-0" />
        <span className="text-sm text-slate-300 font-mono">{client.whatsapp_number || '—'}</span>
      </div>

      {/* Badges */}
      {badges.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {badges.map(b => (
            <span key={b} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full border border-slate-600">
              {b}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        <Link
          href={`/clients/${client.id}`}
          className="flex-1 flex items-center justify-center gap-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 hover:border-indigo-500 text-indigo-300 hover:text-white text-sm font-medium py-2 rounded-lg transition-all"
        >
          <Edit2 className="w-3.5 h-3.5" />
          Editar
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-2 rounded-lg bg-slate-700 hover:bg-red-900/40 border border-slate-600 hover:border-red-700/50 text-slate-400 hover:text-red-400 transition-all disabled:opacity-40"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
