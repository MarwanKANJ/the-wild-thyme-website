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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getNotificationConfig() {
  const resendApiKey = process.env.WT_RESEND_API_KEY || '';
  const from = process.env.WT_CONTACT_NOTIFY_FROM || 'onboarding@resend.dev';
  const rawTo = process.env.WT_CONTACT_NOTIFY_TO || 'Marwan@thewildthymegroup.com,Paula@thewildthymegroup.com';
  const to = rawTo
    .split(',')
    .map((entry) => sanitizeText(entry, 320).toLowerCase())
    .filter(Boolean);

  return {
    resendApiKey,
    from,
    to
  };
}

async function sendNotificationEmail(options) {
  const {
    resendApiKey,
    from,
    to,
    name,
    email,
    phone,
    subject,
    message,
    source,
    page,
    pageUrl,
    referrer,
    createdAtIso
  } = options;

  if (!resendApiKey || to.length === 0) {
    throw new Error('Email notification is not configured. Missing WT_RESEND_API_KEY or recipient list.');
  }

  const safePhone = phone || '-';
  const safeReferrer = referrer || '-';
  const safePage = page || '-';
  const safePageUrl = pageUrl || '-';
  const safeSource = source || 'website';

  const html = `
    <h2>New Website Contact Message</h2>
    <p><strong>Received:</strong> ${createdAtIso}</p>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${safePhone}</p>
    <p><strong>Subject:</strong> ${subject}</p>
    <p><strong>Source:</strong> ${safeSource}</p>
    <p><strong>Page:</strong> ${safePage}</p>
    <p><strong>Page URL:</strong> ${safePageUrl}</p>
    <p><strong>Referrer:</strong> ${safeReferrer}</p>
    <hr />
    <p style="white-space: pre-wrap;">${message}</p>
  `;

  const replyTo = isValidEmail(email) ? email : undefined;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to,
      ...(replyTo && { reply_to: replyTo }),
      subject: `[Website Contact] ${subject}`,
      html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }

  return { sent: true };
}

exports.handler = async (event) => {
  try {
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
    const headers = event && event.headers && typeof event.headers === 'object' ? event.headers : {};
    const userAgent = sanitizeText(headers['user-agent'] || headers['User-Agent'] || '', 300);
    const createdAtIso = new Date().toISOString();

    if (!name || !email || !subject || !message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required fields.' })
      };
    }

    if (!isValidEmail(email)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email address.' })
      };
    }

    try {
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
            user_agent: userAgent || null,
            created_at: createdAtIso
          }
        ])
      });
    } catch (dbError) {
      console.error('[contact-message] DB insert failed:', dbError.message);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'Unable to save message right now. Please try again shortly.' })
      };
    }

    let emailSent = false;
    let emailError = null;

    try {
      const notificationConfig = getNotificationConfig();
      await sendNotificationEmail({
        ...notificationConfig,
        name,
        email,
        phone,
        subject,
        message,
        source,
        page,
        pageUrl,
        referrer,
        createdAtIso
      });
      emailSent = true;
    } catch (notificationError) {
      emailError = notificationError.message;
      console.error('[contact-message] Email notification failed:', notificationError.message);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        emailSent,
        warning: emailSent ? null : 'Message saved but email notification failed.',
        emailError: emailSent ? null : emailError
      })
    };
  } catch (unhandledError) {
    console.error('[contact-message] Unhandled error:', unhandledError && unhandledError.message ? unhandledError.message : unhandledError);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Internal server error.' })
    };
  }
};