/**
 * App.js
 * Core application controller. Handles Leaflet map setup, sensor overlays,
 * JSON reading, playback engine, alarm evaluation, and dynamic scaling.
 */

// Global state variables
let map = null;
let imageOverlay = null;
let timelineData = []; // Array of { datetime, sensorValues: { id: { value, flag } } }
let currentStepIndex = 0;
let isPlaying = false;
let playbackIntervalId = null;
let playbackSpeedMs = 1000; // default 1 step per second
let activeMarkers = {}; // maps sensorId -> { marker, element }
let defaultZoom = 0;

// On document load
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  setupEventListeners();
  loadDemoData(); // Load high quality demo dataset automatically so the app is active on startup
});

/**
 * Initialize Leaflet Map with Simple Coordinate Reference System (CRS)
 */
function initMap() {
  const layout = window.sensorLayout;
  if (!layout) {
    console.error("Sensor layout metadata not found!");
    return;
  }

  // Create map using Leaflet's Simple CRS (pixels correspond directly to lat/lng)
  map = L.map("map", {
    crs: L.CRS.Simple,
    zoomControl: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    boxZoom: true,
    touchZoom: true,
    keyboard: true,
    dragging: true,
    attributionControl: false
  });

  // Define bounds based on layout dimensions
  const bounds = [[0, 0], [layout.imageHeight, layout.imageWidth]];
  const latLngBounds = L.latLngBounds(bounds);

  // Place greyscale schematic image overlay
  imageOverlay = L.imageOverlay(layout.imageUrl, latLngBounds).addTo(map);

  // Set view to center of schematic
  map.fitBounds(latLngBounds);
  defaultZoom = map.getZoom();

  // Set bounds for zooming in and out
  map.setMinZoom(defaultZoom - 1);
  map.setMaxZoom(defaultZoom + 2);

  // Set strict panning bounds so user doesn't drag schematic completely out of view
  map.setMaxBounds(latLngBounds.pad(0.1));

  // Initialize CSS Zoom scale
  updateZoomScale();

  // Listen for zooms to dynamically scale sensor sizes
  map.on("zoomend", () => {
    updateZoomScale();
  });

  // Create sensor markers on the map
  createSensors(layout.sensors);
}

/**
 * Calculate and set CSS variable '--zoom-scale' so that HTML sensors grow/shrink with zoom
 */
function updateZoomScale() {
  if (!map) return;
  const currentZoom = map.getZoom();
  // Compute scale multiplier based on zoom level relative to default fit zoom.
  // Leaflet zooms in powers of 2.
  const scale = Math.pow(2, currentZoom - defaultZoom);
  document.documentElement.style.setProperty("--zoom-scale", scale.toFixed(3));
}

/**
 * Instantiate Leaflet markers for each sensor
 */
function createSensors(sensors) {
  const layout = window.sensorLayout || { imageHeight: 1000 };
  sensors.forEach(sensor => {
    let position, iconSize, className;

    if (sensor.shape === "tank") {
      // For tanks, calculate size and center coordinates
      const width = sensor.x2 - sensor.x1;
      const height = sensor.y2 - sensor.y1;
      
      // Center position in Leaflet coordinates [Y, X]
      // Invert Y coordinate because Leaflet Y-axis increases upwards while pixel coordinates increase downwards
      const centerY = layout.imageHeight - (sensor.y1 + height / 2);
      const centerX = sensor.x1 + width / 2;
      position = [centerY, centerX];
      iconSize = [width, height];
      className = "tank-icon-container";
    } else {
      // For point sensors, center on coordinates [Y, X]
      // Invert Y coordinate because Leaflet Y-axis increases upwards
      position = [layout.imageHeight - sensor.y, sensor.x];
      
      let width = 80;
      let height = 80;
      if (sensor.shape === "pump") {
        width = sensor.width || 48;
        height = sensor.height || 48;
      } else if (sensor.shape === "valve") {
        width = sensor.width || 54;
        height = sensor.height || 36;
      } else if (sensor.shape === "dial") {
        width = sensor.width || 85;
        height = sensor.height || 65;
      }
      
      iconSize = [width, height];
      className = "point-icon-container";
    }

    // Generate specific initial HTML structure based on sensor shape
    const htmlContent = generateSensorHTML(sensor);

    const customIcon = L.divIcon({
      html: htmlContent,
      className: className,
      iconSize: iconSize,
      iconAnchor: [iconSize[0] / 2, iconSize[1] / 2]
    });

    const marker = L.marker(position, { icon: customIcon }).addTo(map);

    // Bind custom styled metadata tooltips
    const tooltipContent = generateTooltipHTML(sensor, null, null);
    marker.bindTooltip(tooltipContent, {
      className: "custom-tooltip",
      direction: "right",
      offset: [20, 0]
    });

    // Store reference to marker so we can update its contents later
    activeMarkers[sensor.id] = {
      marker: marker,
      sensor: sensor,
      width: iconSize[0],
      height: iconSize[1]
    };
  });
}

/**
 * Generate primary HTML markup for the sensor divs
 */
function generateSensorHTML(sensor) {
  if (sensor.shape === "tank") {
    const width = sensor.x2 - sensor.x1;
    const height = sensor.y2 - sensor.y1;
    return `
      <div id="wrapper-${sensor.id}" class="sensor-wrapper state-inhibit" style="--tank-width: ${width}px; --tank-height: ${height}px;">
        <div id="flag-${sensor.id}" class="flag-indicator pulse-stale"></div>
        <div class="tank-shell">
          <div id="fluid-${sensor.id}" class="tank-fluid" style="height: 0%;"></div>
          <div class="tank-scale">
            <div class="scale-tick major"></div>
            <div class="scale-tick"></div>
            <div class="scale-tick"></div>
            <div class="scale-tick"></div>
            <div class="scale-tick major"></div>
            <div class="scale-tick"></div>
            <div class="scale-tick"></div>
            <div class="scale-tick"></div>
            <div class="scale-tick major"></div>
          </div>
          <div class="tank-overlay">
            <div class="tank-id">${sensor.id}</div>
            <div id="value-${sensor.id}" class="tank-value">---</div>
            <div class="tank-unit">${sensor.units}</div>
          </div>
        </div>
      </div>
    `;
  } else if (sensor.shape === "pump") {
    const width = sensor.width || 48;
    const height = sensor.height || 48;
    return `
      <div id="wrapper-${sensor.id}" class="sensor-wrapper stopped" style="--pump-width: ${width}px; --pump-height: ${height}px;">
        <div id="flag-${sensor.id}" class="flag-indicator pulse-stale"></div>
        <div class="pump-body">
          <div class="pump-impeller">
            <!-- Simple 3-blade pump impeller SVG -->
            <svg viewBox="0 0 100 100" fill="currentColor">
              <circle cx="50" cy="50" r="12" />
              <path d="M50,15 C56,15 58,28 50,38 C42,28 44,15 50,15 Z" />
              <path d="M19.7,67.5 C22.7,62.3 34.6,60.5 40.4,68.5 C34.6,76.5 22.7,72.7 19.7,67.5 Z" />
              <path d="M80.3,67.5 C77.3,72.7 65.4,76.5 59.6,68.5 C65.4,60.5 77.3,62.3 80.3,67.5 Z" />
            </svg>
          </div>
          <div class="pump-label">${sensor.id}</div>
        </div>
      </div>
    `;
  } else if (sensor.shape === "valve") {
    const width = sensor.width || 54;
    const height = sensor.height || 36;
    const orientationClass = sensor.orientation === "vertical" ? "vertical" : "horizontal";
    return `
      <div id="wrapper-${sensor.id}" class="sensor-wrapper valve-closed" style="--valve-width: ${width}px; --valve-height: ${height}px;">
        <div id="flag-${sensor.id}" class="flag-indicator pulse-stale"></div>
        <div class="valve-body ${orientationClass}">
          <svg viewBox="0 0 100 60" fill="currentColor">
            <path d="M10 10 L45 30 L10 50 Z" />
            <path d="M90 10 L55 30 L90 50 Z" />
            <circle cx="50" cy="30" r="10" />
            <path d="M50 20 L50 6" stroke="currentColor" stroke-width="4" />
            <line x1="38" y1="6" x2="62" y2="6" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
          </svg>
          <div class="valve-label">${sensor.id}</div>
        </div>
      </div>
    `;
  } else {
    // Dials and Meters (Analogue pipeline cards)
    const width = sensor.width || 85;
    const height = sensor.height || 65;
    return `
      <div id="wrapper-${sensor.id}" class="sensor-wrapper state-inhibit" style="--dial-width: ${width}px; --dial-height: ${height}px;">
        <div id="flag-${sensor.id}" class="flag-indicator pulse-stale"></div>
        <div class="dial-card">
          <div class="dial-id">${sensor.id}</div>
          <div class="dial-value-row">
            <span id="value-${sensor.id}" class="dial-value">---</span>
            <span class="dial-unit">${sensor.units}</span>
          </div>
          <div class="sliding-scale-container">
            <div id="bar-${sensor.id}" class="sliding-scale-fill" style="width: 0%;"></div>
          </div>
        </div>
      </div>
    `;
  }
}

/**
 * Setup layout of custom Metadata tooltips
 */
function generateTooltipHTML(sensor, currentValue, currentFlag) {
  const valText = currentValue !== null ? `${currentValue} ${sensor.units || ""}` : "No Data";
  const flagText = currentFlag || "STALE";
  let flagClass = "flag-ok";
  
  if (flagText.toUpperCase().includes("WARN")) flagClass = "flag-warn";
  else if (flagText.toUpperCase().includes("ALARM") || flagText.toUpperCase().includes("TRIP")) flagClass = "flag-alarm";
  else if (flagText.toUpperCase().includes("INHIBIT") || flagText.toUpperCase().includes("STALE")) flagClass = "tooltip-lbl";

  let limitRows = "";
  if (sensor.limits) {
    limitRows = `
      <div class="tooltip-row"><span class="tooltip-lbl">Hi-Alarm:</span><span class="tooltip-val">${sensor.limits.highLimit}</span></div>
      <div class="tooltip-row"><span class="tooltip-lbl">Hi-Warning:</span><span class="tooltip-val">${sensor.limits.warnHigh}</span></div>
      <div class="tooltip-row"><span class="tooltip-lbl">Lo-Warning:</span><span class="tooltip-val">${sensor.limits.warnLow}</span></div>
      <div class="tooltip-row"><span class="tooltip-lbl">Lo-Alarm:</span><span class="tooltip-val">${sensor.limits.lowLimit}</span></div>
    `;
  } else if (sensor.states) {
    limitRows = `
      <div class="tooltip-row">
        <span class="tooltip-lbl">States:</span>
        <span class="tooltip-val" style="font-size:0.7rem;">
          ${Object.entries(sensor.states).map(([k, v]) => `${k}:${v}`).join(", ")}
        </span>
      </div>
    `;
  }

  return `
    <div class="tooltip-title">${sensor.name}</div>
    <div class="tooltip-row"><span class="tooltip-lbl">Purpose:</span><span class="tooltip-val" style="font-weight:400; font-size:0.75rem;">${sensor.purpose}</span></div>
    <div class="tooltip-row"><span class="tooltip-lbl">Type:</span><span class="tooltip-val">${sensor.type.toUpperCase()}</span></div>
    <div class="tooltip-row" style="margin-top:6px; border-top:1px solid #334155; padding-top:4px;">
      <span class="tooltip-lbl" style="font-weight:700;">Current Value:</span>
      <span class="tooltip-val" style="font-weight:700; color:#ffffff;">${valText}</span>
    </div>
    <div class="tooltip-row">
      <span class="tooltip-lbl" style="font-weight:700;">Status Flag:</span>
      <span class="tooltip-val ${flagClass}" style="font-weight:700;">${flagText}</span>
    </div>
    <div style="margin-top:6px; border-top:1px solid #334155; padding-top:4px; font-size:0.7rem;">
      ${limitRows}
    </div>
  `;
}

/**
 * Event Listeners configuration
 */
function setupEventListeners() {
  // JSON File Reader Button
  const fileInput = document.getElementById("json-file-input");
  if (fileInput) {
    fileInput.addEventListener("change", handleFileSelect);
  }

  // Playback Control buttons
  document.getElementById("btn-play").addEventListener("click", togglePlay);
  document.getElementById("btn-prev").addEventListener("click", stepPrevious);
  document.getElementById("btn-next").addEventListener("click", stepNext);
  document.getElementById("btn-reset").addEventListener("click", resetPlayback);

  // Time Slider
  const slider = document.getElementById("time-slider");
  slider.addEventListener("input", (e) => {
    currentStepIndex = parseInt(e.target.value, 10);
    updateFrame();
  });

  // Speed selection dropdown
  const speedSelect = document.getElementById("speed-multiplier");
  speedSelect.addEventListener("change", (e) => {
    const val = parseFloat(e.target.value);
    playbackSpeedMs = 1000 / val;
    if (isPlaying) {
      pause();
      play();
    }
  });

  // Collapsible Legend toggle logic (Google Maps layers style)
  const legendToggle = document.getElementById("btn-legend-toggle");
  const legendClose = document.getElementById("btn-legend-close");
  const legendPanel = document.getElementById("map-legend");

  if (legendToggle && legendPanel) {
    legendToggle.addEventListener("click", () => {
      const isOpen = legendPanel.classList.toggle("open");
      legendToggle.classList.toggle("active", isOpen);
    });
  }

  if (legendClose && legendToggle && legendPanel) {
    legendClose.addEventListener("click", () => {
      legendPanel.classList.remove("open");
      legendToggle.classList.remove("active");
    });
  }

  // Demo Generator is now a direct static anchor link pointing to industrial_sensor_timeseries.json
}

/**
 * Handle user uploaded timeseries JSON files
 */
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      processTimeseriesData(parsed);
      
      // Update header banner style to reflect file loaded
      document.getElementById("loaded-status").classList.add("loaded");
      document.getElementById("loaded-status-text").innerText = `Active: ${file.name}`;
      
      // Reset map view
      const bounds = [[0, 0], [window.sensorLayout.imageHeight, window.sensorLayout.imageWidth]];
      map.fitBounds(bounds);
    } catch (err) {
      alert("Invalid JSON format. Please ensure the file is valid JSON. Error: " + err.message);
    }
  };
  reader.readAsText(file);
}

/**
 * Intelligent JSON normalizer supporting flat and nested telemetry shapes
 */
function processTimeseriesData(raw) {
  if (!Array.isArray(raw)) {
    alert("Data must be an array of objects!");
    return;
  }

  timelineData = [];

  // Check structure:
  // Option A (User's described schema): [{datetime: "...", sensorId: 'A1', value: 23.5, flag: 'OK'}]
  // Let's group flat readings by their datetime
  if (raw.length > 0 && (raw[0].sensorId !== undefined || raw[0].sensor !== undefined)) {
    const grouped = {};
    raw.forEach(item => {
      const dt = item.datetime || item.timestamp;
      const sId = item.sensorId || item.sensor;
      if (!dt || !sId) return;

      if (!grouped[dt]) {
        grouped[dt] = {};
      }
      grouped[dt][sId] = {
        value: item.value,
        flag: item.flag || "OK"
      };
    });

    // Translate grouped object to timeline array, sorting chronologically
    const sortedTimes = Object.keys(grouped).sort();
    sortedTimes.forEach(dt => {
      timelineData.push({
        datetime: dt,
        sensorValues: grouped[dt]
      });
    });
  } 
  // Option B: Nested format [{datetime: "...", values: { "T101": { value: 12, flag: "OK" } } }]
  else if (raw.length > 0 && raw[0].datetime !== undefined) {
    // Already structured
    timelineData = raw.map(step => {
      return {
        datetime: step.datetime,
        sensorValues: step.sensorValues || step.values || {}
      };
    }).sort((a, b) => a.datetime.localeCompare(b.datetime));
  } else {
    alert("Unsupported JSON structure. Try loading the generated demo dataset first.");
    return;
  }

  if (timelineData.length === 0) {
    alert("No valid timestamps could be processed from the uploaded file.");
    return;
  }

  // Setup playback range
  currentStepIndex = 0;
  isPlaying = false;
  pause();

  const slider = document.getElementById("time-slider");
  slider.max = timelineData.length - 1;
  slider.value = 0;
  slider.disabled = false;

  document.getElementById("btn-play").disabled = false;
  document.getElementById("btn-prev").disabled = false;
  document.getElementById("btn-next").disabled = false;
  document.getElementById("btn-reset").disabled = false;

  updateFrame();
}

/**
 * Main Playback loop ticks
 */
function play() {
  if (playbackIntervalId) clearInterval(playbackIntervalId);
  playbackIntervalId = setInterval(() => {
    if (currentStepIndex >= timelineData.length - 1) {
      pause();
      return;
    }
    currentStepIndex++;
    updateFrame();
  }, playbackSpeedMs);
}

function pause() {
  if (playbackIntervalId) {
    clearInterval(playbackIntervalId);
    playbackIntervalId = null;
  }
  isPlaying = false;
  document.getElementById("btn-play").innerHTML = `
    <!-- Play Icon SVG -->
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
  `;
}

function togglePlay() {
  if (timelineData.length === 0) return;
  isPlaying = !isPlaying;
  if (isPlaying) {
    document.getElementById("btn-play").innerHTML = `
      <!-- Pause Icon SVG -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>
    `;
    play();
  } else {
    pause();
  }
}

function stepNext() {
  if (timelineData.length === 0 || currentStepIndex >= timelineData.length - 1) return;
  pause();
  currentStepIndex++;
  updateFrame();
}

function stepPrevious() {
  if (timelineData.length === 0 || currentStepIndex <= 0) return;
  pause();
  currentStepIndex--;
  updateFrame();
}

function resetPlayback() {
  if (timelineData.length === 0) return;
  pause();
  currentStepIndex = 0;
  updateFrame();
}

/**
 * Redraw all active sensor overlays with values at the current timestamp
 */
function updateFrame() {
  if (timelineData.length === 0) return;

  const currentFrame = timelineData[currentStepIndex];
  if (!currentFrame) return;

  // Update slider position
  const slider = document.getElementById("time-slider");
  slider.value = currentStepIndex;

  // Format and update Timestamp visual ticker
  const rawDt = currentFrame.datetime;
  // Parse simple format "20260513T1400:00" or similar
  let formattedTime = rawDt;
  if (rawDt.length >= 15) {
    const yr = rawDt.substring(0, 4);
    const mo = rawDt.substring(4, 6);
    const dy = rawDt.substring(6, 8);
    const tm = rawDt.substring(9);
    formattedTime = `${yr}-${mo}-${dy} ${tm}`;
  }
  document.getElementById("time-ticker").innerText = `${formattedTime} (${currentStepIndex + 1}/${timelineData.length})`;

  // Alarms array for summary bar
  const currentAlarms = [];

  // Update each sensor on the map
  Object.keys(activeMarkers).forEach(sensorId => {
    const markerData = activeMarkers[sensorId];
    const sensor = markerData.sensor;
    const marker = markerData.marker;
    
    // Default fallback values if this sensor isn't present in this specific frame
    let valObj = currentFrame.sensorValues[sensorId];
    let val = null;
    let flag = "STALE";

    if (valObj !== undefined) {
      val = valObj.value;
      flag = valObj.flag || "OK";
    }

    // Determine state class for visual bodies based on measurement levels and limits (NOT flag!)
    let stateClass = "state-ok";
    let isAlarm = false;

    if (val === null) {
      stateClass = "state-inhibit";
    } else if (sensor.limits) {
      const limits = sensor.limits;
      if (val < limits.lowLimit || val > limits.highLimit) {
        stateClass = "state-danger";
        isAlarm = true;
      } else if (val < limits.warnLow || val > limits.warnHigh) {
        stateClass = "state-warning";
      }
    } else if (sensor.shape === "pump") {
      if (val === 2 || val === "2" || val === "Tripped") {
        stateClass = "state-danger";
        isAlarm = true;
      } else if (val === 0 || val === "0" || val === "Stopped") {
        stateClass = "state-inhibit";
      }
    } else if (sensor.shape === "valve") {
      if (val === 2 || val === "2" || val === "Travel") {
        stateClass = "state-warning";
      } else if (val === 0 || val === "0" || val === "Closed") {
        stateClass = "state-inhibit";
      }
    }

    // Determine if we log this to the active alarms list
    const hasLimitViolation = sensor.limits && val !== null && (val < sensor.limits.warnLow || val > sensor.limits.warnHigh);
    const hasFlagIssue = flag && flag !== "OK";
    if (isAlarm || hasLimitViolation || hasFlagIssue || flag === "Tripped") {
      currentAlarms.push({ id: sensorId, name: sensor.name, flag: flag, value: val, units: sensor.units });
    }

    // UPDATE DOM elements directly inside Leaflet marker overlays to maintain smooth high-performance renders
    const wrapper = document.getElementById(`wrapper-${sensorId}`);
    if (wrapper) {
      // 1. Reset and apply correct state classes
      wrapper.className = `sensor-wrapper ${stateClass}`;

      // Update top-right flag indicators based on flag status
      const flagEl = document.getElementById(`flag-${sensorId}`);
      if (flagEl) {
        flagEl.className = "flag-indicator"; // reset
        if (flag === "OK") {
          flagEl.classList.add("pulse-ok");
        } else if (flag === "Inhibit" || flag === "Muted" || flag.includes("Inhibit")) {
          flagEl.classList.add("pulse-inhibit");
        } else if (flag.includes("Alarm") || flag.includes("Trip") || flag === "Tripped" || flag === "Scan Bad" || flag.includes("Bad") || flag === "Fault") {
          flagEl.classList.add("pulse-trip");
        } else {
          flagEl.classList.add("pulse-stale");
        }
      }

      // 2. Shape-specific structural updates
      if (sensor.shape === "tank") {
        const fluid = document.getElementById(`fluid-${sensorId}`);
        const valText = document.getElementById(`value-${sensorId}`);
        
        if (fluid && valText) {
          // Represent value percentage (usually levels are 0-100)
          let pct = 0;
          if (val !== null && !isNaN(val)) {
            pct = Math.min(100, Math.max(0, val));
            valText.innerText = val.toFixed(1);
          } else {
            valText.innerText = val !== null ? val : "---";
          }
          fluid.style.height = `${pct}%`;
        }
      } 
      else if (sensor.shape === "pump") {
        // Pump states: 0 - Stopped, 1 - Running, 2 - Tripped
        wrapper.classList.remove("stopped", "running", "tripped");
        
        let labelDesc = "STALE";
        if (val === 0 || val === "0" || val === "Stopped" || val === "Off") {
          wrapper.classList.add("stopped");
          labelDesc = "STOPPED";
        } else if (val === 1 || val === "1" || val === "Running" || val === "On") {
          wrapper.classList.add("running");
          labelDesc = "RUNNING";
        } else if (val === 2 || val === "2" || val === "Tripped") {
          wrapper.classList.add("tripped");
          labelDesc = "TRIPPED";
        }
        
        const label = wrapper.querySelector(".pump-label");
        if (label) {
          label.innerText = `${sensorId}: ${labelDesc}`;
        }
      } 
      else if (sensor.shape === "valve") {
        // Valve states: 0 - Closed, 1 - Open, 2 - Travel
        wrapper.classList.remove("valve-closed", "valve-open", "valve-travel");
        
        let labelDesc = "CLOSED";
        if (val === 0 || val === "0" || val === "Closed") {
          wrapper.classList.add("valve-closed");
          labelDesc = "CLOSED";
        } else if (val === 1 || val === "1" || val === "Open") {
          wrapper.classList.add("valve-open");
          labelDesc = "OPEN";
        } else if (val === 2 || val === "2" || val === "Travel") {
          wrapper.classList.add("valve-travel");
          labelDesc = "TRAVEL";
        } else {
          wrapper.classList.add("valve-closed");
          labelDesc = "CLOSED";
        }
        
        const label = wrapper.querySelector(".valve-label");
        if (label) {
          label.innerText = `${sensorId}: ${labelDesc}`;
        }
      }
      else {
        // Pipeline indicators (Dials)
        const valText = document.getElementById(`value-${sensorId}`);
        const bar = document.getElementById(`bar-${sensorId}`);
        
        if (valText && bar) {
          if (val !== null && !isNaN(val)) {
            valText.innerText = val.toFixed(1);
            
            // Calculate scale indicator percentage
            let scalePct = 50; // default middle
            if (sensor.limits) {
              const minRange = sensor.limits.lowLimit - 1.0;
              const maxRange = sensor.limits.highLimit + 1.0;
              scalePct = ((val - minRange) / (maxRange - minRange)) * 100;
              scalePct = Math.min(100, Math.max(0, scalePct));
            }
            bar.style.width = `${scalePct}%`;
          } else {
            valText.innerText = val !== null ? val : "---";
            bar.style.width = "0%";
          }
        }
      }
    }

    // 3. Dynamically update binding tooltips content
    const updatedTooltip = generateTooltipHTML(sensor, val, flag);
    marker.setTooltipContent(updatedTooltip);
  });

  // Redraw active alarms panels
  updateAlarmsDisplay(currentAlarms);
}

/**
 * Display active alarms listed in the footer panel
 */
function updateAlarmsDisplay(alarms) {
  const badge = document.getElementById("alarm-badge-count");
  const container = document.getElementById("alarm-scroll-container");

  if (!badge || !container) return;

  badge.innerText = `${alarms.length} Alerts`;
  if (alarms.length > 0) {
    badge.className = "alarm-count-badge alarm-active";
  } else {
    badge.className = "alarm-count-badge";
  }

  container.innerHTML = "";
  if (alarms.length === 0) {
    container.innerHTML = `<span style="color:#64748b; font-style:italic;">System operating within nominal thresholds.</span>`;
    return;
  }

  alarms.forEach(al => {
    const isDanger = al.flag.includes("Alarm") || al.flag.includes("Trip");
    const tagClass = isDanger ? "alarm-tag danger" : "alarm-tag";
    const el = document.createElement("div");
    el.className = tagClass;
    
    let labelVal = al.value;
    if (typeof labelVal === "number") labelVal = labelVal.toFixed(1);
    
    el.innerHTML = `<strong>${al.id}</strong>: ${al.flag} (${labelVal} ${al.units || ""})`;
    container.appendChild(el);
  });
}

/**
 * Generate fully operational mock timeseries JSON data
 */
function createDemoDataset() {
  const dataset = [];
  const totalSteps = 60; // 60 chronological timeslots
  const layout = window.sensorLayout;

  // Let's seed initial values for simulation loops
  let t101_level = 90.0; // Starts full, depletes
  let t102_level = 15.0; // Starts empty, reacts
  let t103_level = 5.0;  // Starts empty, fills up
  
  let pump1_state = 1; // Running initially
  let pump2_state = 0; // Stopped initially

  let baseTime = new Date(2026, 4, 13, 14, 0, 0); // 2026-05-13 14:00:00

  for (let i = 0; i < totalSteps; i++) {
    const timestamp = new Date(baseTime.getTime() + i * 10 * 60 * 1000); // steps of 10 minutes
    
    // Format timestamp as YYYYMMDDThhmm:ss as user specified
    const yr = timestamp.getFullYear();
    const mo = String(timestamp.getMonth() + 1).padStart(2, '0');
    const dy = String(timestamp.getDate()).padStart(2, '0');
    const hr = String(timestamp.getHours()).padStart(2, '0');
    const mn = String(timestamp.getMinutes()).padStart(2, '0');
    const datetimeStr = `${yr}${mo}${dy}T${hr}${mn}:00`;

    // Process fluid mechanics simulation
    if (pump1_state === 1) {
      t101_level -= 1.2 + Math.random() * 0.3;
      t102_level += 0.8 + Math.random() * 0.2;
    }
    if (pump2_state === 1) {
      t102_level -= 1.0 + Math.random() * 0.3;
      t103_level += 0.9 + Math.random() * 0.2;
    }

    // Bounds clamps
    t101_level = Math.max(0, Math.min(100, t101_level));
    t102_level = Math.max(0, Math.min(100, t102_level));
    t103_level = Math.max(0, Math.min(100, t103_level));

    // Pump controller logical simulation
    // If reactor T102 gets too full, turn on pump 2 and keep pump 1 running
    if (t102_level > 75) {
      pump2_state = 1;
    }
    // If intake T101 is getting low (e.g. < 20%), trigger a Warn Low, and if < 8% shut down Pump 1
    if (t101_level < 8.0) {
      pump1_state = 0; // stopped
    }
    
    // Add an event where Pump 2 trips temporarily around step 40 for dramatic effect
    if (i >= 38 && i <= 44) {
      pump2_state = 2; // Tripped alarm!
      t102_level += 0.6; // reactor builds up level
    } else if (i === 45) {
      pump2_state = 1; // operator resets pump, runs again
    }

    // Evaluate flags for each sensor to inject alarm codes realistically
    const sensorValues = {};

    layout.sensors.forEach(sensor => {
      let val = null;
      let flag = "OK";

      if (sensor.id === "T101") {
        val = t101_level;
        if (val < sensor.limits.lowLimit) flag = "Alarm Low";
        else if (val < sensor.limits.warnLow) flag = "Warning Low";
      } 
      else if (sensor.id === "T102") {
        val = t102_level;
        // Inject an independent flag occasionally (nominal level but Inhibit flag)
        if (i >= 12 && i <= 18) {
          flag = "Inhibit";
        } else {
          if (val > sensor.limits.highLimit) flag = "Alarm High";
          else if (val > sensor.limits.warnHigh) flag = "Warning High";
        }
      } 
      else if (sensor.id === "T103") {
        val = t103_level;
        if (val > sensor.limits.highLimit) flag = "Alarm High";
        else if (val > sensor.limits.warnHigh) flag = "Warning High";
      } 
      else if (sensor.id === "P101") {
        val = pump1_state;
        flag = pump1_state === 2 ? "Tripped" : "OK";
      } 
      else if (sensor.id === "P102") {
        val = pump2_state;
        flag = pump2_state === 2 ? "Tripped" : "OK";
      } 
      else if (sensor.id === "V101") {
        // Feed valve is open when pump 1 is running, closed when stopped, 2 when transitional
        val = pump1_state === 1 ? 1 : 0;
        if (i === 11 || i === 46) {
          val = 2; // transitional travel state
        }
        // Inject an independent flag (Scan Bad)
        if (i >= 24 && i <= 30) {
          flag = "Scan Bad";
        } else {
          flag = "OK";
        }
      }
      else if (sensor.id === "V102") {
        // Discharge valve is open when pump 2 is running, closed when stopped, 2 when transitional
        val = pump2_state === 1 ? 1 : 0;
        if (i === 37 || i === 45) {
          val = 2; // transitional travel state
        }
        // Inject an independent flag (Inhibit)
        if (i >= 50 && i <= 55) {
          flag = "Inhibit";
        } else {
          flag = "OK";
        }
      }
      else if (sensor.id === "FT101") {
        // Flow is active only when pump 1 is on and V101 is open
        const isFlowing = pump1_state === 1;
        val = isFlowing ? (15.0 + Math.sin(i / 3) * 4 + Math.random()) : 0.0;
        if (isFlowing && val > sensor.limits.warnHigh) flag = "Warning High";
      } 
      else if (sensor.id === "FT102") {
        const isFlowing = pump2_state === 1;
        val = isFlowing ? (18.0 + Math.cos(i / 4) * 3 + Math.random()) : 0.0;
        if (isFlowing && val > sensor.limits.warnHigh) flag = "Warning High";
      } 
      else if (sensor.id === "TT102") {
        // Temperature rises during neutralization reaction inside T102
        val = 20.0 + (t102_level * 0.45) + Math.sin(i / 2) * 2;
        if (val > sensor.limits.highLimit) flag = "Alarm High";
        else if (val > sensor.limits.warnHigh) flag = "Warning High";
      } 
      else if (sensor.id === "PT102") {
        // Pressure rises slightly with temperature
        val = 0.5 + (t102_level * 0.035) + (pump2_state === 2 ? 0.8 : 0);
        if (val > sensor.limits.highLimit) flag = "Alarm High";
        else if (val > sensor.limits.warnHigh) flag = "Warning High";
      } 
      else if (sensor.id === "PH102") {
        // pH starts basic and neutralizes down
        val = 11.0 - (i * 0.1) + Math.random() * 0.15;
        if (val < 2.0) val = 2.0;
        if (val < sensor.limits.warnLow) flag = "Warning Low";
        else if (val > sensor.limits.warnHigh) flag = "Warning High";
      }

      sensorValues[sensor.id] = {
        value: val,
        flag: flag
      };
    });

    dataset.push({
      datetime: datetimeStr,
      sensorValues: sensorValues
    });
  }

  return dataset;
}

/**
 * Seed simulation on load automatically
 */
function loadDemoData() {
  const demoData = createDemoDataset();
  processTimeseriesData(demoData);
  document.getElementById("loaded-status").classList.add("loaded");
  document.getElementById("loaded-status-text").innerText = "Active: Simulated Real-Time Feeds";
}

/**
 * Handle generation of downloadable JSON file for the user
 */
function generateAndDownloadDemoJSON() {
  try {
    const demoData = createDemoDataset();
    const jsonString = JSON.stringify(demoData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = url;
    downloadAnchor.download = "industrial_sensor_timeseries.json";
    
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    
    // Asynchronous cleanup
    setTimeout(() => {
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (err) {
    console.error("Failed to generate or download JSON:", err);
    alert("Unable to download the generated file: " + err.message);
  }
}
