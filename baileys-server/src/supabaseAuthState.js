import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'

export async function useSupabaseAuthState(clientId, supabase) {
  const { data } = await supabase
    .from('clients')
    .select('baileys_session')
    .eq('id', clientId)
    .single()

  const session = data?.baileys_session || {}

  let creds
  try {
    creds = session.creds
      ? JSON.parse(session.creds, BufferJSON.reviver)
      : initAuthCreds()
  } catch {
    creds = initAuthCreds()
  }

  let keys = {}
  try {
    keys = session.keys ? JSON.parse(session.keys) : {}
  } catch {
    keys = {}
  }

  const saveState = async () => {
    await supabase
      .from('clients')
      .update({
        baileys_session: {
          creds: JSON.stringify(creds, BufferJSON.replacer),
          keys: JSON.stringify(keys),
        },
      })
      .eq('id', clientId)
  }

  return {
    state: {
      creds,
      keys: {
        get(type, ids) {
          return ids.reduce((dict, id) => {
            const value = keys[`${type}-${id}`]
            if (value) {
              dict[id] =
                type === 'app-state-sync-key'
                  ? proto.Message.AppStateSyncKeyData.fromObject(value)
                  : value
            }
            return dict
          }, {})
        },
        async set(data) {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id]
              if (value) {
                keys[`${category}-${id}`] = value
              } else {
                delete keys[`${category}-${id}`]
              }
            }
          }
          await saveState()
        },
      },
    },
    saveCreds: saveState,
  }
}
