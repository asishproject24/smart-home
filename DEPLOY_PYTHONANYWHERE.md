# Deploying to PythonAnywhere

Replace `smarthome24` with your PythonAnywhere username and `asishproject24/smart-home` with your repo everywhere below.

## 1. Get the code onto PythonAnywhere

Open a **Bash console** (Dashboard → Consoles → Bash):

```bash
git clone https://github.com/asishproject24/smart-home.git smarthome
cd smarthome/backend
python3.10 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser        # optional, for /admin
```

## 2. Create the web app

Dashboard → **Web** → **Add a new web app**
- Domain: `smarthome24.pythonanywhere.com`
- Framework: **Manual configuration** (NOT the "Django" option)
- Python version: **3.10**

## 3. Point the web app at the project

On the Web tab, set:

| Setting | Value |
|---|---|
| Source code | `/home/smarthome24/smarthome/backend` |
| Working directory | `/home/smarthome24/smarthome/backend` |
| Virtualenv | `/home/smarthome24/smarthome/backend/venv` |

## 4. WSGI file

Web tab → click the **WSGI configuration file** link, delete everything, paste:

```python
import os, sys

path = '/home/smarthome24/smarthome/backend'
if path not in sys.path:
    sys.path.insert(0, path)

os.environ['DJANGO_SETTINGS_MODULE'] = 'smarthome.settings'
os.environ['DJANGO_SECRET_KEY'] = 'put-a-long-random-string-here'
os.environ['DJANGO_DEBUG'] = '0'
os.environ['DJANGO_ALLOWED_HOSTS'] = 'smarthome24.pythonanywhere.com'

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
```

Save, then Web tab → green **Reload** button.

## 5. Test

- Dashboard: `https://smarthome24.pythonanywhere.com/`
- API: `https://smarthome24.pythonanywhere.com/api/state/`
- Admin: `https://smarthome24.pythonanywhere.com/admin/`

If something breaks: Web tab → **Error log**.

## 6. Point the ESP32 at the server

In `firmware/smart_home_esp32/smart_home_esp32.ino`:

```cpp
const char* SERVER_BASE = "http://smarthome24.pythonanywhere.com";
```

Plain `http://` works and needs no certificate on the ESP32. Keep **Force HTTPS** switched **off** on the Web tab
(it is off by default) — otherwise the ESP32's http requests get redirected and fail.
Re-upload the firmware.

## 7. Updating later

Locally:
```bash
git add -A && git commit -m "update" && git push
```
On PythonAnywhere (Bash console):
```bash
cd ~/smarthome && git pull
cd backend && source venv/bin/activate && python manage.py migrate
```
Then Web tab → **Reload**.

## Notes / limits (free account)

- Free accounts sleep if the site is not visited for 3 months; just log in and click Reload.
- `db.sqlite3` is **not** in git; the server keeps its own database.
- CPU quota is 100 s/day of *CPU* time — the ESP32's polling (every 0.4 s + 3 s) is light, but if you
  hit the quota, raise `POLL_EVERY` in the firmware to 1000 ms.
