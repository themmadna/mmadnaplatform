const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { fight_id, status } = await req.json()

    if (!fight_id || !['in_progress', 'final'].includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid payload: need fight_id and status (in_progress|final)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const dbHeaders = {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    }

    // Fetch the fight row
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/fights?id=eq.${fight_id}&select=id,espn_competition_id,fight_started_at,fight_ended_at`,
      { headers: dbHeaders }
    )
    const fights = await fetchRes.json()
    if (!fights.length) {
      return new Response(JSON.stringify({ error: 'Fight not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const fight = fights[0]

    if (!fight.espn_competition_id) {
      return new Response(JSON.stringify({ error: 'Fight has no espn_competition_id — run sync first' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // NULL-safe updates — only write timestamps that haven't been set yet.
    // Safe against concurrent calls from multiple clients.
    const now = new Date().toISOString()
    const updates: Record<string, string> = {}

    if (status === 'in_progress' && !fight.fight_started_at) {
      updates.fight_started_at = now
    }
    if (status === 'final') {
      if (!fight.fight_started_at) updates.fight_started_at = now  // catch missed start
      if (!fight.fight_ended_at) updates.fight_ended_at = now
    }

    if (Object.keys(updates).length === 0) {
      // Already recorded — idempotent no-op
      return new Response(JSON.stringify({ ok: true, noop: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/fights?id=eq.${fight_id}`,
      {
        method: 'PATCH',
        headers: { ...dbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(updates),
      }
    )

    if (!updateRes.ok) {
      const err = await updateRes.text()
      throw new Error(err)
    }

    return new Response(JSON.stringify({ ok: true, updates }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
