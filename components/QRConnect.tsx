'use client'

import { useEffect, useState, useCallback } from 'react'
import { Wifi, WifiOff, Loader2, RefreshCw, LogOut, QrCode } from 'lucide-react'

type WaStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected' | 'reconnecting'

const STATUS_LABELS: Record<WaStatus, string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando...',
  qr_pending: 'Escanea el QR',
  connected: 'Conectado',
  reconnecting: 'Reconectando...',
}

const STATUS_COLORS: Record<WaStatus, string> = {
  disconnected: 'text-slate-400 bg-slate-700/50 border-slate-600',
  connecting: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  qr_pending: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  connected: 'text-green-400 bg-green-500/10 border-green-500/30',
  reconnecting: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
}

export default function QRConnect({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<WaStatus>('disconnected')
  const [qr, setQr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/baileys/${clientId}/status`)
      const data = await res.json()
      setStatus(data.status || 'disconnected')
    } catch {
      setStatus('disconnected')
    }
  }, [clientId])

  const fetchQR = useCallback(async () => {
    try {
      const res = await fetch(`/api/baileys/${clientId}/qr`)
      const data = await res.json()
      setQr(data.qr || null)
    } catch {
      setQr(null)
    }
  }, [clientId])

  // Polling: cada 3s cuando está pendiente/conectando, cada 15s cuando está conectado
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(() => {
      fetchStatus()
      if (status === 'qr_pending' || status === 'connecting') {
        fetchQR()
      }
    }, status === 'connected' ? 15000 : 3000)

    return () => clearInterval(interval)
  }, [status, fetchStatus, fetchQR])

  // Cargar QR cuando cambia a qr_pending
  useEffect(() => {
    if (status === 'qr_pending') fetchQR()
    if (status === 'connected') setQr(null)
  }, [status, fetchQR])

  async function handleConnect() {
    setLoading(true)
    setStatus('connecting')
    try {
      await fetch(`/api/baileys/${clientId}/connect`, { method: 'POST' })
      setTimeout(fetchStatus, 2000)
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    setLoading(true)
    try {
      await fetch(`/api/baileys/${clientId}/disconnect`, { method: 'POST' })
      setQr(null)
      setStatus('disconnected')
    } finally {
      setLoading(false)
    }
  }

  const isActive = status === 'connected' || status === 'reconnecting'
  const isPending = status === 'qr_pending' || status === 'connecting'

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-white text-sm">Conexión WhatsApp</h2>
          <p className="text-xs text-slate-400 mt-0.5">Sin API oficial — solo escanea el QR</p>
        </div>
        <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLORS[status]}`}>
          {isActive
            ? <Wifi className="w-3 h-3" />
            : isPending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <WifiOff className="w-3 h-3" />}
          {STATUS_LABELS[status]}
        </span>
      </div>

      {/* QR Code */}
      {status === 'qr_pending' && (
        <div className="border-t border-slate-700 p-6 flex flex-col items-center gap-4">
          {qr ? (
            <>
              <p className="text-sm text-slate-300 text-center">
                Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo
              </p>
              <div className="bg-white p-3 rounded-xl">
                <img src={qr} alt="QR WhatsApp" className="w-52 h-52" />
              </div>
              <button
                onClick={fetchQR}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Actualizar QR
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              <p className="text-sm text-slate-400">Generando QR...</p>
            </div>
          )}
        </div>
      )}

      {/* Connected */}
      {status === 'connected' && (
        <div className="border-t border-slate-700 px-5 py-4 flex items-center gap-2 bg-green-500/5">
          <Wifi className="w-4 h-4 text-green-400 shrink-0" />
          <p className="text-sm text-green-300">WhatsApp conectado y recibiendo mensajes</p>
        </div>
      )}

      {/* Actions */}
      <div className={`px-5 pb-5 flex gap-2 ${status !== 'disconnected' ? 'pt-4 border-t border-slate-700' : 'pt-5 border-t border-slate-700'}`}>
        {!isActive && !isPending && (
          <button
            onClick={handleConnect}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <QrCode className="w-4 h-4" />}
            Conectar WhatsApp
          </button>
        )}

        {(isActive || isPending) && (
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-red-900/40 border border-slate-600 hover:border-red-700/50 text-slate-300 hover:text-red-400 text-sm font-medium px-4 py-2.5 rounded-lg transition-all disabled:opacity-50"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <LogOut className="w-4 h-4" />}
            Desconectar
          </button>
        )}
      </div>
    </div>
  )
}
