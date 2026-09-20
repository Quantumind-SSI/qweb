#!/usr/bin/env python3
"""
Local development server.

Mirrors Azure Static Web Apps behaviour so local and production resolve URLs
identically:
  - /products      -> products.html      (extensionless, as SWA serves them)
  - /              -> index.html
  - unknown path   -> 404.html with a 404 status (navigationFallback)

Without this, internal links like href="/products" 404 locally while working
in production.
"""

import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", "8080"))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class StaticWebAppHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def translate_path(self, path):
        resolved = super().translate_path(path)

        # Existing file or directory: serve as-is
        if os.path.exists(resolved) and not os.path.isdir(resolved):
            return resolved
        if os.path.isdir(resolved) and os.path.exists(os.path.join(resolved, "index.html")):
            return resolved

        # Extensionless route -> .html
        candidate = resolved.rstrip("/") + ".html"
        if os.path.isfile(candidate):
            return candidate

        return resolved

    def send_head(self):
        resolved = self.translate_path(self.path)

        # navigationFallback: unknown routes render 404.html with a 404 status
        if not os.path.exists(resolved):
            fallback = os.path.join(DIRECTORY, "404.html")
            if os.path.isfile(fallback):
                body = open(fallback, "rb").read()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return None if self.command == "HEAD" else __import__("io").BytesIO(body)

        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), StaticWebAppHandler) as httpd:
        print(f"Serving QuantumindSSI at http://localhost:{PORT}/")
        print("Extensionless routes enabled (matches Azure Static Web Apps).")
        httpd.serve_forever()
