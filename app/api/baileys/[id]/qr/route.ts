import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const baileysUrl = process.env.BAILEYS_SERVER_URL || 'http://localhost:3001'
  const secret = process.env.BAILEYS_SECRET || ''

  try {
    const res = await fetch(`${baileysUrl}/session/${params.id}/qr`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ qr: null })
  }
}
