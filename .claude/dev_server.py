"""Local dev server for Flag Coach: serves the project with caching disabled so edits show up on reload.

Run from the project folder:  python3 .claude/dev_server.py
Then open http://localhost:8080 (or http://<this Mac's IP>:8080 from the iPad on the same Wi-Fi).
"""
import functools
import http.server
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(('0.0.0.0', 8080), handler)
    print('Serving Flag Coach on http://localhost:8080')
    server.serve_forever()
