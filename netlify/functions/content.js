const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS'
};

function getSupabaseConfig() {
  const url = process.env.WT_CONTENT_DB_URL;
  const serviceRoleKey = process.env.WT_CONTENT_DB_SERVICE_KEY;
  const tableName = process.env.WT_CONTENT_TABLE_NAME || 'wt_content_entries';

  if (!url || !serviceRoleKey) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ''),
    serviceRoleKey,
    tableName
  };
}

function buildHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal'
  };
}

function buildRows(bucket, items) {
  return items.map((item, index) => {
    const id = item && item.id ? String(item.id) : `item-${index}`;
    return {
      entry_key: `${bucket}:${id}`,
      bucket,
      id,
      sort_order: index,
      payload: item
    };
  });
}

async function supabaseRequest(config, path, init = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...buildHeaders(config.serviceRoleKey),
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  const config = getSupabaseConfig();
  if (!config) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing Supabase environment variables.' })
    };
  }

  const queryParams = event.queryStringParameters || {};
  const parsedBody = event.body ? JSON.parse(event.body) : {};
  const bucket = queryParams.bucket || parsedBody.bucket;

  if (!bucket) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing bucket.' })
    };
  }

  if (event.httpMethod === 'GET') {
    const rows = await supabaseRequest(
      config,
      `${config.tableName}?select=entry_key,bucket,id,sort_order,payload&bucket=eq.${encodeURIComponent(bucket)}&order=sort_order.asc,id.asc`
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ items: Array.isArray(rows) ? rows : [] })
    };
  }

  if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
    const items = Array.isArray(parsedBody.items) ? parsedBody.items : [];

    await supabaseRequest(config, `${config.tableName}?bucket=eq.${encodeURIComponent(bucket)}`, {
      method: 'DELETE'
    });

    if (items.length > 0) {
      await supabaseRequest(config, config.tableName, {
        method: 'POST',
        body: JSON.stringify(buildRows(bucket, items)),
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, count: items.length })
    };
  }

  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'Method not allowed.' })
  };
};