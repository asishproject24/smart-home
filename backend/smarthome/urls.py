from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404
from django.urls import path, include


def serve_frontend(request, filename='index.html'):
    """Serve the dashboard + PWA assets from the project root so everything
    is same-origin with the API (needed for installability & the SW scope)."""
    safe = {
        'index.html': 'text/html',
        'styles.css': 'text/css',
        'script.js': 'application/javascript',
        'sw.js': 'application/javascript',
        'manifest.webmanifest': 'application/manifest+json',
        'icon-192.png': 'image/png',
        'icon-512.png': 'image/png',
        'apple-touch-icon.png': 'image/png',
    }
    if filename not in safe:
        raise Http404()
    path_ = settings.FRONTEND_DIR / filename
    if not path_.exists():
        raise Http404()
    resp = FileResponse(open(path_, 'rb'), content_type=safe[filename])
    if filename == 'sw.js':
        resp['Service-Worker-Allowed'] = '/'        # allow root scope
    return resp


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    path('', serve_frontend),                       # dashboard
    path('styles.css', serve_frontend, {'filename': 'styles.css'}),
    path('script.js', serve_frontend, {'filename': 'script.js'}),
    path('sw.js', serve_frontend, {'filename': 'sw.js'}),
    path('manifest.webmanifest', serve_frontend, {'filename': 'manifest.webmanifest'}),
    path('icon-192.png', serve_frontend, {'filename': 'icon-192.png'}),
    path('icon-512.png', serve_frontend, {'filename': 'icon-512.png'}),
    path('apple-touch-icon.png', serve_frontend, {'filename': 'apple-touch-icon.png'}),
]
