with open("webapp/js/api.js", "r") as f:
    content = f.read()

old_func = """  function getBaseUrl() {
    const origin = window.location.origin;
    if (origin && !origin.startsWith('file:') && !origin.includes('192.168.4.1') && !origin.includes(':5500')) {
      return origin;
    }
    return DEFAULT_BACKEND_URL;
  }"""

new_func = """  function getBaseUrl() {
    const origin = window.location.origin || '';
    const hostname = window.location.hostname || 'localhost';
    const port = window.location.port;

    // If served directly by FastAPI backend on port 8000
    if (port === '8000') {
      return origin;
    }

    // If served by a frontend dev server (Live Server 5500/5501, Vite 5173, React 3000, WebServer 8080, etc.)
    // Route API requests to FastAPI backend on port 8000 on the same host
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${protocol}//${hostname}:8000`;
    }

    // ESP32 AP Mode fallback or default
    if (origin.includes('192.168.4.1') || origin.startsWith('file:')) {
      return DEFAULT_BACKEND_URL;
    }

    return DEFAULT_BACKEND_URL;
  }"""

content = content.replace(old_func, new_func)

with open("webapp/js/api.js", "w") as f:
    f.write(content)

print("Updated getBaseUrl in api.js successfully!")
