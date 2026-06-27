const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

function getSupabaseConfig() {
  const url = process.env.WT_CONTENT_DB_URL;
  const serviceRoleKey = process.env.WT_CONTENT_DB_SERVICE_KEY;
  const tableName = process.env.WT_CONTACT_TABLE_NAME || 'wt_contact_messages';

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

function sanitizeText(value, maxLength = 2000) {
  return String(value || '').trim().slice(0, maxLength);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed.' })
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

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch (_error) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON payload.' })
    };
  }

  const name = sanitizeText(payload.name, 160);
  const email = sanitizeText(payload.email, 160);
  const phone = sanitizeText(payload.phone, 80);
  const subject = sanitizeText(payload.subject, 220);
  const message = sanitizeText(payload.message, 5000);
  const source = sanitizeText(payload.source, 120) || 'website';
  const page = sanitizeText(payload.page, 180);
  const pageUrl = sanitizeText(payload.pageUrl, 600);
  const referrer = sanitizeText(payload.referrer, 600);
  const userAgent = sanitizeText(event.headers['user-agent'] || event.headers['User-Agent'] || '', 300);

  if (!name || !email || !subject || !message) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required fields.' })
    };
  }

  await supabaseRequest(config, config.tableName, {
    method: 'POST',
    body: JSON.stringify([
      {
        source,
        name,
        email,
        phone: phone || null,
        subject,
        message,
        page: page || null,
        page_url: pageUrl || null,
        referrer: referrer || null,
        user_agent: userAgent || null
      }
    ])
  });

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ ok: true })
  };
};