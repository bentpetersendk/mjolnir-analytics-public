const RECOVERY_ENDPOINT = window.MJOLNIR_RECOVERY_ENDPOINT || '';

function normalizeUsername(username) {
  return String(username || '').trim();
}

export async function requestDashboardRecovery(username) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return {
      ok: false,
      mode: 'validation',
      message: 'Enter your Mjolnir username to request your Resource Insights link.',
    };
  }

  if (!RECOVERY_ENDPOINT) {
    return {
      ok: false,
      mode: 'not-configured',
      message: 'Recovery email sending is not enabled in this static preview yet.',
    };
  }

  const response = await fetch(RECOVERY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: normalizedUsername }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok) {
    return {
      ok: false,
      mode: 'server',
      message: payload.message || 'The recovery service could not process the request.',
    };
  }

  return {
    ok: true,
    mode: 'submitted',
    message: payload.message || 'If the username exists, the Resource Insights link will be sent by email.',
  };
}
