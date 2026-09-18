from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import DeviceState, SensorReading, Alert
from .serializers import DeviceStateSerializer, AlertSerializer


# ─────────────────────────── helpers ───────────────────────────
def format_uptime(ms):
    secs = int(ms) // 1000
    d, secs = divmod(secs, 86400)
    h, secs = divmod(secs, 3600)
    m, _ = divmod(secs, 60)
    return f'{d}d {h}h {m}m'


def status_labels(r):
    """Human-readable status strings shown on the sensor cards."""
    temp = ('Hot' if r.temperature >= 35 else 'Warm' if r.temperature >= 28 else
            'Normal' if r.temperature >= 18 else 'Cold')
    hum = ('High' if r.humidity > settings.HUMIDITY_ALERT else
           'Comfortable' if r.humidity >= 30 else 'Dry')
    light = ('Bright' if r.ldr >= settings.LIGHT_ALERT_LUX else 'Dim')
    fan = ('Running' if r.fan_speed > 0 else 'Stopped')
    return {'temperature': temp, 'humidity': hum, 'ldr': light, 'fan': fan}


def evaluate_alerts(r):
    """Return active-alert dicts for a reading and log new ones (deduped)."""
    active = []
    if r.temperature > settings.TEMP_ALERT_C:
        active.append(dict(alert_type='high-temp', color='#ef5350',
                           title='High Temperature Alert',
                           description=f'Temperature is above {settings.TEMP_ALERT_C}°C'))
    if r.humidity > settings.HUMIDITY_ALERT:
        active.append(dict(alert_type='high-humidity', color='#ffa726',
                           title='High Humidity Alert',
                           description=f'Humidity is above {settings.HUMIDITY_ALERT}%'))
    if r.ldr < settings.LIGHT_ALERT_LUX:
        active.append(dict(alert_type='low-light', color='#ffee58',
                           title='Low Light Alert',
                           description=f'Light intensity is below {settings.LIGHT_ALERT_LUX} lux'))

    # Log to history, but not more than once per 2 min per type.
    cutoff = timezone.now() - timedelta(minutes=2)
    for a in active:
        recent = Alert.objects.filter(alert_type=a['alert_type'],
                                      created_at__gte=cutoff).exists()
        if not recent:
            Alert.objects.create(**a)
    return active


# ─────────────────────────── endpoints ───────────────────────────
@api_view(['POST'])
def telemetry(request):
    """ESP32 -> server. Saves a reading, returns the device state to apply."""
    d = request.data
    reading = SensorReading.objects.create(
        temperature=float(d.get('temperature', 0)),
        humidity=float(d.get('humidity', 0)),
        ldr=int(d.get('ldr', 0)),
        fan_speed=int(d.get('fan_speed', 0)),
        signal=int(d.get('signal', 0)),
        uptime_ms=int(d.get('uptime_ms', 0)),
    )

    state = DeviceState.load()

    # In AUTO mode the device is authoritative — reflect its decisions.
    if state.auto_mode:
        state.light_on = bool(d.get('light_on', state.light_on))
        state.fan_on = bool(d.get('fan_on', state.fan_on))
        state.fan_speed = int(d.get('fan_speed', state.fan_speed))
        state.save()

    evaluate_alerts(reading)
    return Response(DeviceStateSerializer(state).data)


@api_view(['GET', 'POST'])
def control(request):
    """Dashboard <-> server device-state control."""
    state = DeviceState.load()
    if request.method == 'POST':
        for f in ('light_on', 'fan_on', 'auto_mode'):
            if f in request.data:
                setattr(state, f, bool(request.data[f]))
        if 'fan_speed' in request.data:
            state.fan_speed = max(0, min(100, int(request.data['fan_speed'])))
        state.save()
    return Response(DeviceStateSerializer(state).data)


@api_view(['GET'])
def state(request):
    """Everything the dashboard needs in one poll."""
    dev = DeviceState.load()
    latest = SensorReading.objects.first()
    alerts_active = evaluate_alerts(latest) if latest else []

    data = {
        'device': DeviceStateSerializer(dev).data,
        'sensors': None,
        'status': None,
        'uptime': format_uptime(latest.uptime_ms) if latest else '0d 0h 0m',
        'alerts': alerts_active,
        'alert_history': AlertSerializer(Alert.objects.all()[:20], many=True).data,
    }
    if latest:
        data['sensors'] = {
            'temperature': round(latest.temperature, 1),
            'humidity': round(latest.humidity),
            'ldr': latest.ldr,
            'fan_speed': latest.fan_speed,
            'signal': latest.signal,
            'updated_at': latest.created_at,
        }
        data['status'] = status_labels(latest)
    return Response(data)
