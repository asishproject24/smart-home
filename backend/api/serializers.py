from rest_framework import serializers
from .models import DeviceState, SensorReading, Alert


class DeviceStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceState
        fields = ['light_on', 'fan_on', 'fan_speed', 'auto_mode',
                  'temp_on', 'temp_full', 'light_on_lux', 'humidity_alert', 'updated_at']


class SensorReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = SensorReading
        fields = ['temperature', 'humidity', 'ldr', 'fan_speed', 'signal', 'uptime_ms', 'created_at']


class AlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = Alert
        fields = ['alert_type', 'title', 'description', 'color', 'created_at']
