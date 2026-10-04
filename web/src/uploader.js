// Comunicação com o gravador local (pasta server/), que roda o arduino-cli.

function savedServer() {
  try {
    return localStorage.getItem('rc.server');
  } catch {
    return null;
  }
}

// Endereço do gravador; pode ser trocado com localStorage 'rc.server'.
export const SERVER_URL = savedServer() || 'http://localhost:3232';

export async function getStatus() {
  try {
    const res = await fetch(`${SERVER_URL}/status`, { signal: AbortSignal.timeout(2000) });
    return await res.json();
  } catch {
    return null;
  }
}

export async function listPorts() {
  const res = await fetch(`${SERVER_URL}/ports`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Compila (e grava, se upload = true). O servidor responde em texto, aos
// poucos; a última linha é "@@RESULTADO ok" ou "@@RESULTADO erro".
export async function build({ code, port, upload }, onLog) {
  const res = await fetch(`${SERVER_URL}/${upload ? 'upload' : 'compile'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, port }),
  });
  if (!res.ok || !res.body) throw new Error(await res.text());

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let ok = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('@@RESULTADO ')) ok = line.endsWith('ok');
      else onLog(line);
    }
  }
  if (buffer.startsWith('@@RESULTADO ')) ok = buffer.endsWith('ok');
  else if (buffer) onLog(buffer);
  return ok;
}
