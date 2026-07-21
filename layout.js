/**
 * layout.js
 * Contains the spatial coordinates and metadata for all sensors.
 * This is loaded as a global script so that it works locally in MS Edge (file://) without CORS issues.
 */

window.sensorLayout = {
  // Dimensions of the background image
  imageWidth: 1600,
  imageHeight: 1000,
  imageUrl: "src/assets/images/industrial_layout_1784575318588.jpg",

  // Sensor definitions
  sensors: [
    // --- TANKS (Analogue, defined by x1, y1, x2, y2 bounds) ---
    {
      id: "T101",
      name: "Chemical Intake Tank",
      purpose: "Stores raw chemical reactant",
      type: "analogue",
      shape: "tank",
      // Pixel coordinates (x1, y1, x2, y2)
      x1: 180,
      y1: 300,
      x2: 320,
      y2: 700,
      units: "%",
      limits: {
        lowLimit: 5.0,
        warnLow: 15.0,
        warnHigh: 85.0,
        highLimit: 95.0
      }
    },
    {
      id: "T102",
      name: "Neutralization Reactor",
      purpose: "Main reaction vessel for neutralization",
      type: "analogue",
      shape: "tank",
      x1: 680,
      y1: 300,
      x2: 840,
      y2: 700,
      units: "%",
      limits: {
        lowLimit: 10.0,
        warnLow: 20.0,
        warnHigh: 80.0,
        highLimit: 90.0
      }
    },
    {
      id: "T103",
      name: "Effluent Holding Tank",
      purpose: "Buffers neutralized output before release",
      type: "analogue",
      shape: "tank",
      x1: 1200,
      y1: 300,
      x2: 1340,
      y2: 700,
      units: "%",
      limits: {
        lowLimit: 5.0,
        warnLow: 10.0,
        warnHigh: 90.0,
        highLimit: 95.0
      }
    },

    // --- PUMPS (Digital, defined by center x, y) ---
    {
      id: "P101",
      name: "Acid Feed Pump",
      purpose: "Controls flow from Chemical Intake Tank (T101) to Reactor (T102)",
      type: "digital",
      shape: "pump",
      x: 480,
      y: 520,
      states: {
        0: "Stopped",
        1: "Running",
        2: "Tripped"
      },
      units: ""
    },
    {
      id: "P102",
      name: "Discharge Pump",
      purpose: "Pumps neutralized liquid to Effluent Tank (T103)",
      type: "digital",
      shape: "pump",
      x: 1000,
      y: 520,
      states: {
        0: "Stopped",
        1: "Running",
        2: "Tripped"
      },
      units: ""
    },

    // --- PIPELINE METERS (Analogue, defined by center x, y) ---
    {
      id: "FT101",
      name: "Reactant Flow Meter",
      purpose: "Measures fluid flow in the feed line",
      type: "analogue",
      shape: "dial",
      x: 480,
      y: 400,
      units: "m³/h",
      limits: {
        lowLimit: 0.0,
        warnLow: 2.0,
        warnHigh: 22.0,
        highLimit: 25.0
      }
    },
    {
      id: "TT102",
      name: "Reactor Temp Indicator",
      purpose: "Measures neutralizing process temperature",
      type: "analogue",
      shape: "dial",
      x: 760,
      y: 450,
      units: "°C",
      limits: {
        lowLimit: 10.0,
        warnLow: 15.0,
        warnHigh: 65.0,
        highLimit: 75.0
      }
    },
    {
      id: "PT102",
      name: "Reactor Pressure Sensor",
      purpose: "Measures pressure inside Neutralization Reactor",
      type: "analogue",
      shape: "dial",
      x: 760,
      y: 550,
      units: "bar",
      limits: {
        lowLimit: 0.1,
        warnLow: 0.3,
        warnHigh: 3.5,
        highLimit: 4.0
      }
    },
    {
      id: "FT102",
      name: "Effluent Discharge Flow",
      purpose: "Measures outflow rate to the buffer tank",
      type: "analogue",
      shape: "dial",
      x: 1000,
      y: 400,
      units: "m³/h",
      limits: {
        lowLimit: 0.0,
        warnLow: 1.0,
        warnHigh: 24.0,
        highLimit: 28.0
      }
    },
    {
      id: "PH102",
      name: "Reactor pH Monitor",
      purpose: "Measures pH level in Neutralization Reactor",
      type: "analogue",
      shape: "dial",
      x: 880,
      y: 450,
      units: "pH",
      limits: {
        lowLimit: 2.0,
        warnLow: 5.5,
        warnHigh: 8.5,
        highLimit: 12.0
      }
    },

    // --- VALVES (Digital, defined by center x, y) ---
    {
      id: "V101",
      name: "Feed Control Valve",
      purpose: "Enables or isolates flow into Neutralization Reactor T102",
      type: "digital",
      shape: "valve",
      x: 480,
      y: 250,
      orientation: "horizontal",
      states: {
        0: "Closed",
        1: "Open",
        2: "Travel"
      },
      units: ""
    },
    {
      id: "V102",
      name: "Discharge Control Valve",
      purpose: "Enables or isolates discharge flow into Effluent Holding Tank T103",
      type: "digital",
      shape: "valve",
      x: 1000,
      y: 250,
      orientation: "horizontal",
      states: {
        0: "Closed",
        1: "Open",
        2: "Travel"
      },
      units: ""
    }
  ]
};
