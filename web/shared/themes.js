// Themes d'Audora, partages par le PC (web/) et l'appli Android (copie a la construction de l'APK).
// c = [fond, panneaux, relief, lignes, texte, texte 2, texte 3, accent, accent survol, texte sur accent]
// "chameleon" : l'accent prend la couleur de la pochette en cours.
(function (global) {
  "use strict";
  global.AudoraThemes = [
  { id: "prune", name: "Prune", dark: true, c: ["#17121f", "#1f1929", "#2a2236", "#3a3048", "#f4effa", "#b3a8c6", "#7d7290", "#ffb547", "#ffc369", "#2b1a00"] },
  { id: "cameleon", name: "Caméléon", dark: true, c: ["#141416", "#1c1c20", "#26262b", "#36363d", "#f1f1f4", "#a9a9b3", "#71717b", "chameleon", "", "#111111"] },
  { id: "minuit", name: "Minuit", dark: true, c: ["#0f1420", "#161d2c", "#1f2839", "#2c3850", "#eef3fb", "#9fb0c8", "#67788f", "#5ad1e6", "#7fdcec", "#04232a"] },
  { id: "ocean", name: "Océan", dark: true, c: ["#0d1a1d", "#132428", "#1b3136", "#284449", "#e8f6f6", "#9dbcbd", "#648385", "#3ee0c5", "#6ae8d3", "#03241f"] },
  { id: "foret", name: "Forêt", dark: true, c: ["#111a15", "#17231c", "#203027", "#2d4136", "#edf5ef", "#a3b8aa", "#6c8274", "#8fd694", "#a8e0ab", "#0d2a10"] },
  { id: "braise", name: "Braise", dark: true, c: ["#1a1412", "#231b18", "#2e2420", "#42342e", "#f8efe9", "#c2ada2", "#86736a", "#ff8a4c", "#ffa173", "#2e1205"] },
  { id: "rubis", name: "Rubis", dark: true, c: ["#141010", "#1d1717", "#282020", "#3a2e2e", "#f7eeee", "#bfa9a9", "#826d6d", "#ff5a52", "#ff7b74", "#2d0402"] },
  { id: "sakura", name: "Sakura", dark: true, c: ["#1c1317", "#261a20", "#33232b", "#48323d", "#fbeef3", "#c9a9b6", "#8c6f7b", "#ff8fb8", "#ffa9c8", "#330a1b"] },
  { id: "neon", name: "Néon", dark: true, c: ["#120b1f", "#1a1030", "#251843", "#3a2766", "#f3eaff", "#b4a3d6", "#7a6a9c", "#ff4fd8", "#ff7be2", "#2b0026"] },
  { id: "graphite", name: "Graphite", dark: true, c: ["#151515", "#1d1d1d", "#272727", "#363636", "#f2f2f2", "#a8a8a8", "#6e6e6e", "#e8e8e8", "#ffffff", "#111111"] },
  { id: "oled", name: "Noir total", dark: true, c: ["#000000", "#0a0a0a", "#161616", "#262626", "#ffffff", "#a3a3a3", "#666666", "#ffb547", "#ffc369", "#2b1a00"] },
  { id: "cafe", name: "Café crème", dark: false, c: ["#f6f1ea", "#fffdf9", "#ece4d8", "#ddd2c3", "#2a211b", "#6d5f53", "#9c8e81", "#b0642a", "#c2753a", "#fff8f0"] },
  { id: "lavande", name: "Lavande", dark: false, c: ["#f4f1fa", "#ffffff", "#e8e2f3", "#d6cde8", "#231c33", "#625878", "#958ba8", "#7b4fe0", "#8d66e8", "#ffffff"] },
  { id: "menthe", name: "Menthe", dark: false, c: ["#eef6f2", "#ffffff", "#dfece6", "#c8ddd3", "#14261e", "#4f665b", "#84998f", "#1f9e6e", "#26b27d", "#ffffff"] },
  { id: "papier", name: "Papier", dark: false, c: ["#f7f7f8", "#ffffff", "#ececee", "#dcdce0", "#18181b", "#5f5f68", "#93939c", "#e2513f", "#ea6a59", "#ffffff"] },
];
})(typeof window !== "undefined" ? window : globalThis);
