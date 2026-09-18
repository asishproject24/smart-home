from django.contrib import admin
from .models import DeviceState, SensorReading, Alert


@admin.register(DeviceState)
class DeviceStateAdmin(admin.ModelAdmin):
    list_display = ('light_on', 'fan_on', 'fan_speed', 'auto_mode', 'temp_on', 'light_on_lux', 'updated_at')


@admin.register(SensorReading)
class SensorReadingAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'temperature', 'humidity', 'ldr', 'fan_speed', 'signal')
    list_filter = ('created_at',)


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'alert_type', 'title')
    list_filter = ('alert_type',)
