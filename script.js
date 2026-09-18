// ─── Smart Home Control System Dashboard ───
// Polls Django REST API for real ESP32 data, with local simulation fallback.
document.addEventListener('DOMContentLoaded', () => {

    // ── State ──
    const state = {
        temperature: 0,
        humidity: 0,
        ldr: 0,
        fanSpeed: 0,
        lightOn: true,
        fanOn: true,
        autoMode: true,
        thresholds: { temp_on: 30, temp_full: 40, light_on_lux: 200, humidity_alert: 60 },
        wifiConnected: false,
        signalStrength: 0,
        uptime: '0d 0h 0m',
        alerts: [],
        chartData: {
            temp: [],
            humidity: [],
            ldr: [],
            labels: []
        }
    };

    // ── API Configuration ──
    const API_BASE = window.location.origin;   // same-origin Django server
    let apiConnected = false;
    let pollInterval = null;
    let simInterval = null;

    // ── Clock ──
    function updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
        document.getElementById('header-time').textContent = timeStr;
        document.getElementById('header-date').textContent = dateStr;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ── Navigation ──
    const navLinks = document.querySelectorAll('.nav-menu a');
    const pages = document.querySelectorAll('.page-section');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = link.dataset.page;
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            pages.forEach(p => { p.classList.remove('active'); });
            const pageEl = document.getElementById('page-' + target);
            if (pageEl) pageEl.classList.add('active');

            // Close mobile sidebar
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebar-overlay').classList.remove('open');
        });
    });

    // ── Mobile menu toggle ──
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebar-overlay').classList.toggle('open');
        });
        document.getElementById('sidebar-overlay').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebar-overlay').classList.remove('open');
        });
    }

    // ── UI Control Bindings ──
    const lightToggle = document.getElementById('light-toggle');
    const fanToggle = document.getElementById('fan-toggle');
    const fanSlider = document.getElementById('fan-speed-slider');

    lightToggle.addEventListener('change', () => {
        if (state.autoMode) {
            lightToggle.checked = state.lightOn;
            showToast("Auto Mode active — switch to Manual to control devices");
            return;
        }
        state.lightOn = lightToggle.checked;
        document.getElementById('light-toggle-text').textContent = state.lightOn ? 'ON' : 'OFF';
        document.getElementById('light-toggle-text').className = 'toggle-text ' + (state.lightOn ? 'on' : 'off');
        updateFooter();
        sendControl({ light_on: state.lightOn });
    });

    fanToggle.addEventListener('change', () => {
        if (state.autoMode) {
            fanToggle.checked = state.fanOn;
            showToast("Auto Mode active — switch to Manual to control devices");
            return;
        }
        state.fanOn = fanToggle.checked;
        document.getElementById('fan-toggle-text').textContent = state.fanOn ? 'ON' : 'OFF';
        document.getElementById('fan-toggle-text').className = 'toggle-text ' + (state.fanOn ? 'on' : 'off');
        if (!state.fanOn) state.fanSpeed = 0;
        else state.fanSpeed = parseInt(fanSlider.value);
        updateFanGauge();
        updateFooter();
        sendControl({ fan_on: state.fanOn, fan_speed: state.fanSpeed });
    });

    fanSlider.addEventListener('input', () => {
        if (state.autoMode) {
            fanSlider.value = state.fanSpeed;
            return;
        }
        state.fanSpeed = parseInt(fanSlider.value);
        fanSlider.style.setProperty('--val', state.fanSpeed + '%');
        document.getElementById('fan-speed-val').textContent = state.fanSpeed + '%';
        updateFanGauge();
        updateSensorCards();
    });

    fanSlider.addEventListener('change', () => {
        if (state.autoMode) return;
        sendControl({ fan_speed: state.fanSpeed });
    });
    fanSlider.style.setProperty('--val', state.fanSpeed + '%');

    // ── Automation thresholds (Automation page) ──
    const thInputs = { temp_on: 'th-temp-on', temp_full: 'th-temp-full', light_on_lux: 'th-lux', humidity_alert: 'th-hum' };
    let thEditing = false;
    Object.values(thInputs).forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('focus', () => thEditing = true);
        el.addEventListener('blur', () => thEditing = false);
    });
    function renderThresholds() {
        const t = state.thresholds;
        if (!thEditing) for (const [k, id] of Object.entries(thInputs)) document.getElementById(id).value = t[k];
        document.getElementById('rule-temp-on').textContent = t.temp_on;
        document.getElementById('rule-temp-full').textContent = t.temp_full;
        document.getElementById('rule-lux').textContent = t.light_on_lux;
        document.getElementById('rule-hum').textContent = t.humidity_alert;
        document.getElementById('set-temp-on').textContent = t.temp_on;
        document.getElementById('set-lux').textContent = t.light_on_lux;
        document.getElementById('set-hum').textContent = t.humidity_alert;
    }
    document.getElementById('th-save').addEventListener('click', () => {
        const payload = {};
        for (const [k, id] of Object.entries(thInputs)) payload[k] = parseFloat(document.getElementById(id).value);
        if (payload.temp_full <= payload.temp_on) { showToast('"Fan 100% at" must be higher than "Fan ON above"'); return; }
        Object.assign(state.thresholds, payload);
        renderThresholds();
        sendControl(payload);
        showToast('Thresholds saved — ESP32 will apply them shortly');
    });
    renderThresholds();
    document.getElementById('set-server').textContent = API_BASE;

    // ── Mode Buttons ──
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.autoMode = btn.dataset.mode === 'auto';

            if (state.autoMode) {
                fanSlider.disabled = true;
                lightToggle.disabled = true;
                fanToggle.disabled = true;
                document.getElementById('mode-status').textContent = 'Auto Control is Active';
                document.getElementById('mode-desc').textContent = 'System will automatically adjust devices';
            } else {
                fanSlider.disabled = false;
                lightToggle.disabled = false;
                fanToggle.disabled = false;
                document.getElementById('mode-status').textContent = 'Manual Control is Active';
                document.getElementById('mode-desc').textContent = 'You are controlling devices manually';
            }

            updateFooter();
            sendControl({ auto_mode: state.autoMode });
        });
    });

    // ── Simple toast notification ──
    function showToast(msg) {
        let toast = document.getElementById('toast-msg');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-msg';
            toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;padding:10px 24px;border-radius:8px;font-size:13px;z-index:9999;border:1px solid rgba(0,230,118,0.3);box-shadow:0 4px 20px rgba(0,0,0,0.4);transition:opacity 0.3s;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    // ═══════════════════════════════════════════════════════════════
    //  DJANGO API COMMUNICATION  (replaces old WebSocket-only logic)
    // ═══════════════════════════════════════════════════════════════

    // ── Send control command to Django ──
    function sendControl(data) {
        fetch(`${API_BASE}/api/control/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).catch(err => console.warn('Control POST error:', err));
    }

    // ── Poll /api/state/ for latest sensor + device data ──
    function pollState() {
        fetch(`${API_BASE}/api/state/`)
            .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(data => {
                if (!apiConnected) {
                    apiConnected = true;
                    if (simInterval) { clearInterval(simInterval); simInterval = null; }
                }
                applyServerState(data);
            })
            .catch(err => {
                console.warn('API poll error:', err);
                if (apiConnected) {
                    apiConnected = false;
                    startSimulation();
                }
            });
    }

    // ── Apply server response to dashboard ──
    function applyServerState(data) {
        const dev = data.device;
        const sensors = data.sensors;

        // — WiFi status —
        updateWiFiStatus(sensors ? sensors.signal : 0, true);

        // — Device state —
        state.autoMode = dev.auto_mode;
        state.lightOn = dev.light_on;
        state.fanOn = dev.fan_on;
        state.fanSpeed = dev.fan_speed;
        if (dev.temp_on !== undefined) {
            state.thresholds = { temp_on: dev.temp_on, temp_full: dev.temp_full,
                                 light_on_lux: dev.light_on_lux, humidity_alert: dev.humidity_alert };
            renderThresholds();
        }
        document.getElementById('set-signal').textContent = sensors ? sensors.signal + '%' : '—';

        // — Sensor values —
        if (sensors) {
            state.temperature = sensors.temperature;
            state.humidity = sensors.humidity;
            state.ldr = sensors.ldr;
            state.signalStrength = sensors.signal;
        }

        // — Uptime —
        state.uptime = data.uptime || '0d 0h 0m';

        // — Push to chart —
        const now = new Date();
        const timeLabel = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        state.chartData.temp.push(state.temperature);
        state.chartData.humidity.push(state.humidity);
        state.chartData.ldr.push(state.ldr);
        state.chartData.labels.push(timeLabel);
        if (state.chartData.temp.length > 20) {
            state.chartData.temp.shift();
            state.chartData.humidity.shift();
            state.chartData.ldr.shift();
            state.chartData.labels.shift();
        }

        // — Sync UI toggles —
        lightToggle.checked = state.lightOn;
        document.getElementById('light-toggle-text').textContent = state.lightOn ? 'ON' : 'OFF';
        document.getElementById('light-toggle-text').className = 'toggle-text ' + (state.lightOn ? 'on' : 'off');

        fanToggle.checked = state.fanOn;
        document.getElementById('fan-toggle-text').textContent = state.fanOn ? 'ON' : 'OFF';
        document.getElementById('fan-toggle-text').className = 'toggle-text ' + (state.fanOn ? 'on' : 'off');

        fanSlider.value = state.fanSpeed;
        fanSlider.style.setProperty('--val', state.fanSpeed + '%');
        document.getElementById('fan-speed-val').textContent = state.fanSpeed + '%';

        // — Mode UI —
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === (state.autoMode ? 'auto' : 'manual'));
        });
        fanSlider.disabled = state.autoMode;
        lightToggle.disabled = state.autoMode;
        fanToggle.disabled = state.autoMode;
        document.getElementById('mode-status').textContent = state.autoMode ? 'Auto Control is Active' : 'Manual Control is Active';
        document.getElementById('mode-desc').textContent = state.autoMode ? 'System will automatically adjust devices' : 'You are controlling devices manually';

        // — Uptime —
        document.getElementById('footer-uptime').textContent = state.uptime;

        // — Alerts —
        if (data.alerts) {
            state.alerts = data.alerts;
        }

        // — Refresh all visuals —
        updateSensorCards();
        updateFanGauge();
        updateFooter();
        drawChart('live-chart', state.chartData, state.chartData.labels);
    }

    // ── WiFi status display ──
    function updateWiFiStatus(signal, connected) {
        const wifiStatusLbl = document.getElementById('wifi-status-lbl');
        const wifiIcon = document.getElementById('wifi-icon');
        const signalVal = document.getElementById('wifi-signal-val');
        const signalBar = document.getElementById('wifi-signal-bar');

        if (connected && signal > 0) {
            wifiStatusLbl.textContent = 'Connected';
            wifiStatusLbl.style.color = 'var(--accent-green)';
            wifiIcon.classList.add('connected');
            signalVal.textContent = signal + '%';
            signalBar.style.width = signal + '%';
        } else if (connected) {
            wifiStatusLbl.textContent = 'ESP32 Online';
            wifiStatusLbl.style.color = 'var(--accent-green)';
            signalVal.textContent = '—';
            signalBar.style.width = '50%';
        } else {
            wifiStatusLbl.textContent = 'Disconnected';
            wifiStatusLbl.style.color = 'var(--accent-red)';
            signalVal.textContent = '0%';
            signalBar.style.width = '0%';
        }
    }

    // ── ESP32 IP / Connect button  ──
    // Now used to manually set the ESP32 IP in firmware reference.
    // Real connection is through Django polling, not direct WebSocket.
    const btnConnect = document.getElementById('btn-connect');
    const ipInput = document.getElementById('esp32-ip');

    if (localStorage.getItem('esp32_ip')) {
        ipInput.value = localStorage.getItem('esp32_ip');
    }

    btnConnect.addEventListener('click', () => {
        localStorage.setItem('esp32_ip', ipInput.value.trim());
        showToast('IP saved. ESP32 connects to Django automatically.');
    });

    // ── Fan Gauge (SVG Arc) ──
    function updateFanGauge() {
        const speed = state.fanOn ? state.fanSpeed : 0;
        const text = document.getElementById('gauge-value');
        const cx = 100, cy = 95;
        const startAngle = Math.PI;

        text.textContent = speed + '%';

        const needleAngle = startAngle - (speed / 100) * Math.PI;
        const needleLen = 65;
        const nx = cx + needleLen * Math.cos(needleAngle);
        const ny = cy - needleLen * Math.sin(needleAngle);

        const needle = document.getElementById('gauge-needle');
        if (needle) {
            needle.setAttribute('x2', nx);
            needle.setAttribute('y2', ny);
        }
    }

    // ── Live Chart (Canvas) with Hover Tooltip ──
    let chartMeta = {};  // store chart geometry for hover

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.style.cssText = `
        position: absolute; display: none; pointer-events: none; z-index: 100;
        background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(0, 230, 118, 0.3);
        border-radius: 10px; padding: 10px 14px; font-size: 12px; color: #e2e8f0;
        backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        min-width: 160px; transition: opacity 0.15s;
    `;
    document.body.appendChild(tooltip);

    function drawChart(canvasId, data, labels) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width = canvas.parentElement.clientWidth;
        const H = canvas.height = canvas.parentElement.clientHeight;
        ctx.clearRect(0, 0, W, H);

        if (!labels || labels.length < 2) return;

        const padL = 40, padR = 20, padT = 10, padB = 30;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;

        const datasets = [
            { values: data.temp,     color: '#ef5350', min: 0, max: 50,   unit: '°C',  label: 'Temperature' },
            { values: data.humidity,  color: '#42a5f5', min: 0, max: 100,  unit: '%',   label: 'Humidity' },
            { values: data.ldr,      color: '#ffa726', min: 0, max: 1000, unit: ' lux', label: 'LDR' }
        ];

        // Save geometry for hover calculations
        chartMeta[canvasId] = { padL, padR, padT, padB, chartW, chartH, W, H, datasets, labels, data };

        // Draw grid
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padT + (chartH / 4) * i;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        }

        // Y-axis labels
        ctx.fillStyle = '#5a6478';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const pct = 100 - (100 / 4) * i;
            const y = padT + (chartH / 4) * i;
            ctx.fillText(pct + '%', padL - 6, y + 3);
        }

        // X-axis labels
        ctx.textAlign = 'center';
        const step = Math.max(1, Math.floor(labels.length / 8));
        labels.forEach((lbl, i) => {
            const x = padL + (chartW / (labels.length - 1)) * i;
            if (i % step === 0 || i === labels.length - 1) {
                ctx.fillText(lbl, x, H - 6);
            }
        });

        // Draw lines and dots
        datasets.forEach(ds => {
            ctx.beginPath();
            ctx.strokeStyle = ds.color;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ds.values.forEach((v, i) => {
                const x = padL + (chartW / (ds.values.length - 1)) * i;
                const y = padT + chartH - (v / ds.max) * chartH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            ds.values.forEach((v, i) => {
                const x = padL + (chartW / (ds.values.length - 1)) * i;
                const y = padT + chartH - (v / ds.max) * chartH;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = ds.color;
                ctx.fill();
            });
        });
    }

    // ── Draw crosshair + highlighted dots at hovered index ──
    function drawChartWithHighlight(canvasId, hoverIdx) {
        const meta = chartMeta[canvasId];
        if (!meta) return;

        // Redraw base chart
        drawChart(canvasId, meta.data, meta.labels);

        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const { padL, padT, chartW, chartH, datasets } = meta;
        const count = meta.labels.length;

        // Vertical crosshair line
        const xPos = padL + (chartW / (count - 1)) * hoverIdx;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xPos, padT);
        ctx.lineTo(xPos, padT + chartH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Highlighted dots (larger, with glow)
        datasets.forEach(ds => {
            const v = ds.values[hoverIdx];
            if (v === undefined) return;
            const y = padT + chartH - (v / ds.max) * chartH;

            // Glow
            ctx.beginPath();
            ctx.arc(xPos, y, 8, 0, Math.PI * 2);
            ctx.fillStyle = ds.color + '33';
            ctx.fill();

            // Dot
            ctx.beginPath();
            ctx.arc(xPos, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = ds.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
        ctx.restore();
    }

    // ── Chart hover event handler ──
    function setupChartHover(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        canvas.style.cursor = 'crosshair';

        canvas.addEventListener('mousemove', (e) => {
            const meta = chartMeta[canvasId];
            if (!meta || !meta.labels || meta.labels.length < 2) {
                tooltip.style.display = 'none';
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const mouseX = (e.clientX - rect.left) * scaleX;

            const { padL, chartW, labels, data, datasets } = meta;
            const count = labels.length;

            // Find nearest data index
            const relX = mouseX - padL;
            if (relX < -10 || relX > chartW + 10) {
                tooltip.style.display = 'none';
                return;
            }

            const idx = Math.round((relX / chartW) * (count - 1));
            const clampedIdx = Math.max(0, Math.min(count - 1, idx));

            // Draw highlight
            drawChartWithHighlight(canvasId, clampedIdx);

            // Build tooltip content
            const time = labels[clampedIdx];
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

            let html = `<div style="margin-bottom:6px;font-weight:600;color:#94a3b8;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:5px;">
                📅 ${dateStr} &nbsp; 🕐 ${time}
            </div>`;

            const tempVal = data.temp[clampedIdx];
            const humVal = data.humidity[clampedIdx];
            const ldrVal = data.ldr[clampedIdx];

            html += `<div style="display:flex;align-items:center;gap:6px;margin:4px 0;">
                <span style="width:8px;height:8px;border-radius:50%;background:#ef5350;display:inline-block;"></span>
                <span style="color:#9ca3af;">Temp:</span>
                <span style="color:#ef5350;font-weight:700;margin-left:auto;">${tempVal !== undefined ? tempVal.toFixed(1) + '°C' : '—'}</span>
            </div>`;
            html += `<div style="display:flex;align-items:center;gap:6px;margin:4px 0;">
                <span style="width:8px;height:8px;border-radius:50%;background:#42a5f5;display:inline-block;"></span>
                <span style="color:#9ca3af;">Humidity:</span>
                <span style="color:#42a5f5;font-weight:700;margin-left:auto;">${humVal !== undefined ? Math.round(humVal) + '%' : '—'}</span>
            </div>`;
            html += `<div style="display:flex;align-items:center;gap:6px;margin:4px 0;">
                <span style="width:8px;height:8px;border-radius:50%;background:#ffa726;display:inline-block;"></span>
                <span style="color:#9ca3af;">LDR:</span>
                <span style="color:#ffa726;font-weight:700;margin-left:auto;">${ldrVal !== undefined ? ldrVal + ' lux' : '—'}</span>
            </div>`;

            tooltip.innerHTML = html;
            tooltip.style.display = 'block';

            // Position tooltip near mouse but keep on screen
            let tipX = e.pageX + 16;
            let tipY = e.pageY - 20;
            const tipW = tooltip.offsetWidth;
            const tipH = tooltip.offsetHeight;
            if (tipX + tipW > window.innerWidth - 10) tipX = e.pageX - tipW - 16;
            if (tipY + tipH > window.innerHeight + window.scrollY - 10) tipY = e.pageY - tipH - 10;
            if (tipY < window.scrollY + 5) tipY = window.scrollY + 5;

            tooltip.style.left = tipX + 'px';
            tooltip.style.top = tipY + 'px';
        });

        canvas.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            // Redraw without highlight
            const meta = chartMeta[canvasId];
            if (meta) drawChart(canvasId, meta.data, meta.labels);
        });
    }

    // Setup hover for the live chart
    setTimeout(() => setupChartHover('live-chart'), 200);

    // ── Update Sensor Cards ──
    function updateSensorCards() {
        document.getElementById('temp-value').textContent = state.temperature.toFixed(1);
        document.getElementById('humidity-value').textContent = Math.round(state.humidity);
        document.getElementById('ldr-value').textContent = state.ldr;
        document.getElementById('fan-value').textContent = state.fanSpeed;

        const tFill = document.getElementById('temp-bar-fill');
        const hFill = document.getElementById('hum-bar-fill');
        const lFill = document.getElementById('ldr-bar-fill');

        if (tFill) tFill.style.width = (state.temperature / 50 * 100) + '%';
        if (hFill) hFill.style.width = state.humidity + '%';
        if (lFill) lFill.style.width = (state.ldr / 1000 * 100) + '%';

        const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.querySelectorAll('.sensor-updated').forEach(el => el.textContent = 'Updated: ' + ts);
    }

    // ── Update Footer ──
    function updateFooter() {
        document.getElementById('footer-light').textContent = state.lightOn ? 'ON' : 'OFF';
        document.getElementById('footer-light').style.color = state.lightOn ? '#00e676' : '#ef5350';
        document.getElementById('footer-fan').textContent = state.fanOn ? 'ON' : 'OFF';
        document.getElementById('footer-fan').style.color = state.fanOn ? '#00e676' : '#ef5350';
        document.getElementById('footer-mode').textContent = state.autoMode ? 'ACTIVE' : 'MANUAL';
        document.getElementById('footer-mode').style.color = state.autoMode ? '#00e676' : '#42a5f5';
    }

    // ── Local Simulation (Fallback when API is down) ──
    function startSimulation() {
        if (simInterval) clearInterval(simInterval);

        updateWiFiStatus(0, false);

        fanSlider.disabled = state.autoMode;
        lightToggle.disabled = state.autoMode;
        fanToggle.disabled = state.autoMode;

        simInterval = setInterval(() => {
            state.temperature = parseFloat((23 + Math.random() * 16).toFixed(1));
            state.humidity = Math.floor(55 + Math.random() * 15);
            state.ldr = Math.floor(100 + Math.random() * 600);

            if (state.autoMode) {
                if (state.temperature <= 25) {
                    state.fanSpeed = 0; state.fanOn = false;
                } else if (state.temperature >= 38) {
                    state.fanSpeed = 100; state.fanOn = true;
                } else {
                    state.fanSpeed = Math.round(((state.temperature - 25) / (38 - 25)) * 70 + 30);
                    state.fanOn = true;
                }
                fanToggle.checked = state.fanOn;
                document.getElementById('fan-toggle-text').textContent = state.fanOn ? 'ON' : 'OFF';
                document.getElementById('fan-toggle-text').className = 'toggle-text ' + (state.fanOn ? 'on' : 'off');
                fanSlider.value = state.fanSpeed;
                fanSlider.style.setProperty('--val', state.fanSpeed + '%');
                document.getElementById('fan-speed-val').textContent = state.fanSpeed + '%';

                state.lightOn = (state.ldr < 200);
                lightToggle.checked = state.lightOn;
                document.getElementById('light-toggle-text').textContent = state.lightOn ? 'ON' : 'OFF';
                document.getElementById('light-toggle-text').className = 'toggle-text ' + (state.lightOn ? 'on' : 'off');
            }

            const now = new Date();
            const timeLabel = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            state.chartData.temp.push(state.temperature);
            state.chartData.humidity.push(state.humidity);
            state.chartData.ldr.push(state.ldr);
            state.chartData.labels.push(timeLabel);
            if (state.chartData.temp.length > 20) {
                state.chartData.temp.shift();
                state.chartData.humidity.shift();
                state.chartData.ldr.shift();
                state.chartData.labels.shift();
            }

            updateSensorCards();
            updateFanGauge();
            updateFooter();
            drawChart('live-chart', state.chartData, state.chartData.labels);
        }, 3000);
    }

    // ── Initial Render ──
    updateSensorCards();
    updateFanGauge();
    updateFooter();

    // Start polling Django API every 3 seconds
    pollState();
    pollInterval = setInterval(pollState, 3000);

    setTimeout(() => {
        drawChart('live-chart', state.chartData, state.chartData.labels);
    }, 150);

    window.addEventListener('resize', () => {
        drawChart('live-chart', state.chartData, state.chartData.labels);
    });
});
