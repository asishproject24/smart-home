# Smart Home Control System — Django Backend

REST backend for the Smart Home dashboard. It receives sensor telemetry from
an **ESP32**, stores device state, generates alerts, and serves the dashboard.

```
ESP32  ──POST /api/telemetry/──►  Django  ◄──GET /api/state/──  Dashboard (browser)
       ◄── device state (JSON) ──         ◄──POST /api/control/──
```

## 1. Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows  (source venv/bin/activate on Linux/Mac)
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser # optional, for /admin
python manage.py runserver 0.0.0.0:8000
```

`0.0.0.0` makes the server reachable from the ESP32 over your LAN.

- **Dashboard:** http://127.0.0.1:8000/
- **Admin:**     http://127.0.0.1:8000/admin/
- **API root:**  http://127.0.0.1:8000/api/

## 2. API

| Method | Endpoint          | Who       | Purpose |
|--------|-------------------|-----------|---------|
| POST   | `/api/telemetry/` | ESP32     | Send readings; returns device state to apply |
| GET    | `/api/state/`     | Dashboard | Latest reading + device state + alerts (poll every 3 s) |
| GET    | `/api/control/`   | Dashboard | Read device state |
| POST   | `/api/control/`   | Dashboard | Update `light_on` / `fan_on` / `fan_speed` / `auto_mode` |

### telemetry payload (ESP32 → server)
```json
{ "temperature": 31.2, "humidity": 62, "ldr": 320, "fan_speed": 65,
  "light_on": true, "fan_on": true, "auto_mode": true,
  "signal": 85, "uptime_ms": 225300000 }
```
Response = current device state:
```json
{ "light_on": true, "fan_on": true, "fan_speed": 65, "auto_mode": true }
```

## 3. Auto vs Manual mode

- **Auto** — the ESP32 decides locally (fan on when temp > 30 °C, light on when
  lux < 200) and reports its decisions; the server mirrors them so the dashboard
  stays in sync.
- **Manual** — the dashboard sets `light_on` / `fan_on` / `fan_speed` and the
  ESP32 obeys the state returned from `/api/telemetry/`.

Mode is switched from the dashboard's **Mode Selection** card.

## 4. Alert thresholds

Edit in `smarthome/settings.py`:
```python
TEMP_ALERT_C    = 30     # High Temperature Alert above this
HUMIDITY_ALERT  = 60     # High Humidity Alert    above this
LIGHT_ALERT_LUX = 200    # Low Light Alert        below this
```

## 5. ESP32 firmware

See `../firmware/smart_home_esp32/smart_home_esp32.ino`.
Edit `WIFI_SSID`, `WIFI_PASS`, and `SERVER_URL` (use your PC's LAN IP, e.g.
`http://192.168.1.105:8000/api/telemetry/`). Required Arduino libraries:
**DHT sensor library** (Adafruit) + **Adafruit Unified Sensor**, and **ArduinoJson**.

## Notes (dev vs production)

`DEBUG=True`, `SECRET_KEY`, `ALLOWED_HOSTS=['*']` and `CORS_ALLOW_ALL_ORIGINS`
are convenient for local development. Tighten all four before deploying.
