# Dev server that refuses to cache. Browsers cache ES modules hard, and a stale
# module silently invalidates whatever you just tested.
import http.server, socketserver, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", 8101), H) as httpd:
    httpd.serve_forever()
