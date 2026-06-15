'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, MessageCircle, Search } from 'lucide-react'
import { Client } from '@/lib/types'
import ClientCard from '@/components/ClientCard'

export default function DashboardPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(d => { setClients(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = clients.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    (c.tipo_negocio || '').toLowerCase().includes(search.toLowerCase()) ||
    c.whatsapp_number.includes(search)
  )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Chatbots</h1>
          <p className="text-slate-400 text-sm mt-1">
            {loading ? '...' : `${clients.length} cliente${clients.length !== 1 ? 's' : ''} configurado${clients.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link
          href="/clients/new"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Plus className="w-4 h-4" />
          Nuevo cliente
        </Link>
      </div>

      {/* Search */}
      {!loading && clients.length > 3 && (
        <div className="relative mb-6 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl h-52 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
            <MessageCircle className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">
            {search ? 'Sin resultados' : 'Aún no hay clientes'}
          </h3>
          <p className="text-slate-400 text-sm mb-6 max-w-xs">
            {search
              ? 'Prueba con otro término de búsqueda'
              : 'Agrega tu primer cliente para activar su chatbot de WhatsApp'}
          </p>
          {!search && (
            <Link
              href="/clients/new"
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Agregar primer cliente
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              onDelete={() => setClients(prev => prev.filter(c => c.id !== client.id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
