from django.urls import path
from . import views

urlpatterns = [
    path('telemetry/', views.telemetry, name='telemetry'),   # ESP32 POST
    path('control/', views.control, name='control'),         # dashboard GET/POST
    path('state/', views.state, name='state'),               # dashboard poll
]
