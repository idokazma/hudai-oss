import http from 'node:http';
import net from 'node:net';
import { INSPECTOR_SCRIPT } from './inspector-script.js';

export class PreviewProxy {
  private targetOrigin: string;
  private server: http.Server | null = null;

  constructor(private targetUrl: string) {
    const u = new URL(targetUrl);
    this.targetOrigin = u.origin;
  }

  async start(): Promise<number> {
    const server = http.createServer((clientReq, clientRes) => {
      const targetUrl = new URL(clientReq.url || '/', this.targetOrigin);

      const headers: Record<string, string | string[]> = {};
      for (const [key, val] of Object.entries(clientReq.headers)) {
        if (!val || key === 'host') continue;
        headers[key] = val as string;
      }
      // Force uncompressed so we can inject into HTML
      headers['accept-encoding'] = 'identity';

      const proxyReq = http.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path: targetUrl.pathname + targetUrl.search,
          method: clientReq.method,
          headers,
        },
        (proxyRes) => {
          const contentType = proxyRes.headers['content-type'] || '';
          const isHtml = contentType.includes('text/html');

          // Strip CSP so injected script can run
          const resHeaders: Record<string, string | string[] | undefined> = { ...proxyRes.headers };
          delete resHeaders['content-security-policy'];
          delete resHeaders['content-security-policy-report-only'];

          if (isHtml) {
            // Buffer HTML to inject inspector script
            const chunks: Buffer[] = [];
            proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
            proxyRes.on('end', () => {
              let html = Buffer.concat(chunks).toString('utf-8');

              // Inject before </body> or </html> or at end
              const injectPoint = html.lastIndexOf('</body>');
              if (injectPoint !== -1) {
                html = html.slice(0, injectPoint) + INSPECTOR_SCRIPT + html.slice(injectPoint);
              } else {
                const htmlEnd = html.lastIndexOf('</html>');
                if (htmlEnd !== -1) {
                  html = html.slice(0, htmlEnd) + INSPECTOR_SCRIPT + html.slice(htmlEnd);
                } else {
                  html += INSPECTOR_SCRIPT;
                }
              }

              const buf = Buffer.from(html, 'utf-8');
              delete resHeaders['content-length'];
              resHeaders['content-length'] = String(buf.length);
              // Remove transfer-encoding since we're sending a complete buffer
              delete resHeaders['transfer-encoding'];

              clientRes.writeHead(proxyRes.statusCode || 200, resHeaders);
              clientRes.end(buf);
            });
          } else {
            // Stream non-HTML responses directly
            clientRes.writeHead(proxyRes.statusCode || 200, resHeaders);
            proxyRes.pipe(clientRes);
          }
        },
      );

      proxyReq.on('error', (err) => {
        console.error('[preview-proxy] Request error:', err.message);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Preview proxy error: ' + err.message);
        }
      });

      clientReq.pipe(proxyReq);
    });

    // WebSocket passthrough for HMR
    server.on('upgrade', (req, clientSocket, head) => {
      const targetUrl = new URL(req.url || '/', this.targetOrigin);
      const targetSocket = net.createConnection(
        { host: targetUrl.hostname, port: Number(targetUrl.port) },
        () => {
          const reqLine = `${req.method} ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n`;
          const headers: string[] = [];
          for (const [key, val] of Object.entries(req.headers)) {
            if (key === 'host') {
              headers.push(`Host: ${targetUrl.host}`);
            } else if (val) {
              headers.push(`${key}: ${Array.isArray(val) ? val.join(', ') : val}`);
            }
          }
          targetSocket.write(reqLine + headers.join('\r\n') + '\r\n\r\n');
          if (head.length > 0) targetSocket.write(head);
          targetSocket.pipe(clientSocket);
          clientSocket.pipe(targetSocket);
        },
      );

      targetSocket.on('error', (err) => {
        console.error('[preview-proxy] WS upgrade error:', err.message);
        clientSocket.destroy();
      });

      clientSocket.on('error', () => {
        targetSocket.destroy();
      });
    });

    return new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.server = server;
          console.log(`[preview-proxy] Listening on port ${addr.port} → ${this.targetOrigin}`);
          resolve(addr.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
      server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    return new Promise((resolve) => {
      s.close(() => {
        console.log('[preview-proxy] Stopped');
        resolve();
      });
    });
  }
}
