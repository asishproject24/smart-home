from django.db import models


class DeviceState(models.Model):
    """Single source of truth for device targets (one row, pk=1)."""
    light_on   = models.BooleanField(default=True)
    fan_on     = models.BooleanField(default=True)
    fan_speed  = models.PositiveSmallIntegerField(default=65)   # %
    auto_mode  = models.BooleanField(default=True)
    # Automation thresholds (editable from the dashboard, pushed to the ESP32)
    temp_on       = models.FloatField(default=30)                   # fan ON above this °C
    temp_full     = models.FloatField(default=40)                   # fan reaches 100 % at this °C
    light_on_lux  = models.PositiveSmallIntegerField(default=200)   # light ON below this lux
    humidity_alert = models.PositiveSmallIntegerField(default=60)   # alert above this %
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Device State'

    def __str__(self):
        return f'Light={self.light_on} Fan={self.fan_on}/{self.fan_speed}% Auto={self.auto_mode}'

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class SensorReading(models.Model):
    """One telemetry sample from the ESP32."""
    temperature = models.FloatField(default=0)
    humidity    = models.FloatField(default=0)
    ldr         = models.IntegerField(default=0)     # lux
    fan_speed   = models.PositiveSmallIntegerField(default=0)
    signal      = models.PositiveSmallIntegerField(default=0)   # Wi-Fi %
    uptime_ms   = models.BigIntegerField(default=0)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.temperature}C {self.humidity}% {self.ldr}lux @ {self.created_at:%H:%M:%S}'


class Alert(models.Model):
    LEVELS = [('high-temp', 'High Temp'), ('high-humidity', 'High Humidity'),
              ('low-light', 'Low Light')]
    alert_type  = models.CharField(max_length=32, choices=LEVELS)
    title       = models.CharField(max_length=120)
    description = models.CharField(max_length=240)
    color       = models.CharField(max_length=16, default='#ef5350')
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.title} @ {self.created_at:%H:%M}'
