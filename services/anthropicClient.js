function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function configValue(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim();
}

function modelName() {
  const raw = configValue('ANTHROPIC_MODEL', 'claude-sonnet-4-6').toLowerCase();
  const aliases = {
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
    'claude-3-7-sonnet-20250219': 'claude-sonnet-4-6',
    'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  };
  return aliases[raw] || raw;
}

function cleanJson(text = '') {
  const raw = String(text || '').trim();
  if (!raw) throw httpError(502, 'A IA retornou uma resposta vazia.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1].trim() : raw;
  if (!body.startsWith('{')) body = body.match(/\{[\s\S]*\}/)?.[0] || body;
  try {
    return JSON.parse(body);
  } catch (_) {
    try {
      return JSON.parse(body.replace(/,\s*([}\]])/g, '$1'));
    } catch (error) {
      throw httpError(502, `A IA respondeu em formato invalido: ${error.message}`);
    }
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 240000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw httpError(504, 'A analise da IA excedeu o tempo limite. Tente com menos documentos.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function createMessage({ content, requestApiKey = '', maxTokens = 14000 }) {
  const userKey = String(requestApiKey || '').trim();
  const serverKey = configValue('ANTHROPIC_API_KEY');
  const keys = [userKey, serverKey].filter((key, index, list) => key && list.indexOf(key) === index);
  if (!keys.length) {
    throw httpError(503, 'A chave Anthropic do servidor nao esta configurada. Informe temporariamente sua propria API key para usar a geracao inteligente.');
  }

  let lastError;
  for (const apiKey of keys) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelName(),
          max_tokens: maxTokens,
          temperature: 0.15,
          messages: [{ role: 'user', content }],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
        return { text, json: cleanJson(text), model: data.model || modelName(), usage: data.usage || {} };
      }
      const detail = data?.error?.message || `HTTP ${response.status}`;
      lastError = httpError(response.status, `Falha na API Anthropic: ${detail}`);
      if (![401, 403, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 800));
    }
  }
  throw lastError || httpError(502, 'Nao foi possivel consultar a Anthropic.');
}

function publicConfig() {
  return {
    servidor_configurado: Boolean(configValue('ANTHROPIC_API_KEY')),
    modelo: modelName(),
    chave_usuario_persistida: false,
  };
}

module.exports = { createMessage, cleanJson, publicConfig, modelName };
