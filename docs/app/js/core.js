// TermDeck frontend: storage-key migration, ICON set, theme registry, DOM refs, platform labels, small DOM helpers.
// One of the classic scripts in public/js/, loaded in order by index.html and sharing one global scope.
"use strict";

/* Storage keys are td.<name>.v<N>. Older builds spelled a few differently; carry each over once (the old key goes). */
try{
  for(const [from,to] of [["td-hidden","td.treeHidden.v1"],["td-follow","td.treeFollow.v1"],["td-tour-done","td.tourDone.v1"],["td-pal-recent","td.palRecent.v1"],["td_ov_filter","td.ovFilter.v1"]]){
    const v=localStorage.getItem(from); if(v===null) continue;
    if(localStorage.getItem(to)===null) localStorage.setItem(to,v);
    localStorage.removeItem(from);
  }
}catch{}

/* Inline Lucide icons (MIT) for small controls — monochrome via currentColor, sized 1em by CSS. */
const ICON={
  monitor:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  globe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  x:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  warn:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  up:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
  down:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  caret:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  home:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 12 9-9 9 9M5 10v10h14V10"/></svg>',
  plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  cast:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  castOff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M2 2l20 20"/></svg>',
  reveal:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  hourglass:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.42A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.42A2 2 0 0 0 17 6.17V2"/></svg>',
  moveTo:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2M2 13h10M9 16l3-3-3-3"/></svg>',
  terminal:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 6-6-6-6M12 19h8"/></svg>',
  log:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/></svg>',
  grid:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>',
  sidebar:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v16H3zM9 4v16"/></svg>',
  search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  theme:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 2-2 2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 9 9 0 0 0-9-8z"/><circle cx="7.5" cy="10.5" r=".6"/><circle cx="12" cy="7.5" r=".6"/><circle cx="16.5" cy="10.5" r=".6"/></svg>',
  folderPlus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v4M10 13h4"/></svg>',
  folder:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  keyboard:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8"/></svg>',
  snippet:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  gamepad:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01M17 5H7a5 5 0 0 0-5 5l1.5 7a2.5 2.5 0 0 0 4.6.8L9 15h6l.9 2.8a2.5 2.5 0 0 0 4.6-.8L22 10a5 5 0 0 0-5-5z"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5"/></svg>',
  branch:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
  file:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg>',
  bot:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
  eye:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.6 3.4M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9 9 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg>',
  more:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  locate:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  arrowUp:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  pin:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3-1-6z"/></svg>',
  collapse:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M16 9l-3 3 3 3"/></svg>',
  move:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M15 19l-3 3-3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/></svg>',
};

/* ════════════════════════════════════════════════
   THEME REGISTRY
   ════════════════════════════════════════════════ */
function mkT(name,ui,xterm,dots){return{name,ui,xterm,dots};}
const THEMES={
  console:mkT("Console",{"--bg":"#0b0f14","--grid":"#101820","--panel":"#121a23","--panel-2":"#0e151d","--line":"#1f2c39","--line-soft":"#17222d","--text":"#c9d4de","--muted":"#66798a","--accent":"#4fd6be","--accent-dim":"#2b7d70","--head-a":"#16212c","--head-b":"#111b24","--chip-bg":"#16212c","--chip-active":"#1a2a33","--btn-bg":"#16212c","--win-body":"#05090d","--ptab-hover":"#131c25"},{background:"#05090d",foreground:"#c9d4de",cursor:"#4fd6be",cursorAccent:"#05090d",selectionBackground:"#25506a",black:"#0b0f14",brightBlack:"#3a4a58",red:"#e0655f",brightRed:"#ff8a83",green:"#46d17f",brightGreen:"#7ff0a8",yellow:"#e0a94e",brightYellow:"#f3cf82",blue:"#5aa9e6",brightBlue:"#8fc9ff",magenta:"#b98fe6",brightMagenta:"#d3b6ff",cyan:"#4fd6be",brightCyan:"#8ef0e0",white:"#c9d4de",brightWhite:"#eef4f8"},["#05090d","#4fd6be","#46d17f","#5aa9e6"]),
  dracula:mkT("Dracula",{"--bg":"#1e1f29","--grid":"#252636","--panel":"#282a36","--panel-2":"#21222c","--line":"#44475a","--line-soft":"#383a4a","--text":"#f8f8f2","--muted":"#6272a4","--accent":"#bd93f9","--accent-dim":"#7c5cbf","--head-a":"#2d2f3f","--head-b":"#252636","--chip-bg":"#282a36","--chip-active":"#323342","--btn-bg":"#282a36","--win-body":"#191a24","--ptab-hover":"#252636"},{background:"#191a24",foreground:"#f8f8f2",cursor:"#f8f8f2",cursorAccent:"#191a24",selectionBackground:"#44475a",black:"#21222c",brightBlack:"#6272a4",red:"#ff5555",brightRed:"#ff6e6e",green:"#50fa7b",brightGreen:"#69ff94",yellow:"#f1fa8c",brightYellow:"#ffffa5",blue:"#bd93f9",brightBlue:"#d6acff",magenta:"#ff79c6",brightMagenta:"#ff92df",cyan:"#8be9fd",brightCyan:"#a4ffff",white:"#f8f8f2",brightWhite:"#ffffff"},["#191a24","#bd93f9","#ff79c6","#50fa7b"]),
  nord:mkT("Nord",{"--bg":"#242933","--grid":"#2a303d","--panel":"#2e3440","--panel-2":"#272c38","--line":"#3b4252","--line-soft":"#333a47","--text":"#eceff4","--muted":"#4c566a","--accent":"#88c0d0","--accent-dim":"#5a8fa0","--head-a":"#353c4a","--head-b":"#2c3340","--chip-bg":"#2e3440","--chip-active":"#3b4252","--btn-bg":"#2e3440","--win-body":"#1e222c","--ptab-hover":"#2a303d"},{background:"#1e222c",foreground:"#d8dee9",cursor:"#88c0d0",cursorAccent:"#1e222c",selectionBackground:"#434c5e",black:"#3b4252",brightBlack:"#4c566a",red:"#bf616a",brightRed:"#bf616a",green:"#a3be8c",brightGreen:"#a3be8c",yellow:"#ebcb8b",brightYellow:"#ebcb8b",blue:"#81a1c1",brightBlue:"#81a1c1",magenta:"#b48ead",brightMagenta:"#b48ead",cyan:"#88c0d0",brightCyan:"#8fbcbb",white:"#e5e9f0",brightWhite:"#eceff4"},["#1e222c","#88c0d0","#a3be8c","#b48ead"]),
  tokyoNight:mkT("Tokyo Night",{"--bg":"#13141e","--grid":"#181921","--panel":"#1a1b2e","--panel-2":"#16172a","--line":"#24253a","--line-soft":"#1e1f30","--text":"#c0caf5","--muted":"#565f89","--accent":"#7aa2f7","--accent-dim":"#3d5cbf","--head-a":"#1e2030","--head-b":"#181926","--chip-bg":"#1a1b2e","--chip-active":"#24253a","--btn-bg":"#1a1b2e","--win-body":"#0d0e17","--ptab-hover":"#181926"},{background:"#0d0e17",foreground:"#c0caf5",cursor:"#c0caf5",cursorAccent:"#0d0e17",selectionBackground:"#28344a",black:"#15161e",brightBlack:"#414868",red:"#f7768e",brightRed:"#f7768e",green:"#9ece6a",brightGreen:"#9ece6a",yellow:"#e0af68",brightYellow:"#e0af68",blue:"#7aa2f7",brightBlue:"#7aa2f7",magenta:"#bb9af7",brightMagenta:"#bb9af7",cyan:"#7dcfff",brightCyan:"#7dcfff",white:"#a9b1d6",brightWhite:"#c0caf5"},["#0d0e17","#7aa2f7","#bb9af7","#7dcfff"]),
  rosePine:mkT("Rose Pine",{"--bg":"#191724","--grid":"#1e1b30","--panel":"#1f1d2e","--panel-2":"#1a1826","--line":"#2a2837","--line-soft":"#24222f","--text":"#e0def4","--muted":"#6e6a86","--accent":"#c4a7e7","--accent-dim":"#7a5b99","--head-a":"#26243a","--head-b":"#1f1d2e","--chip-bg":"#1f1d2e","--chip-active":"#2a2837","--btn-bg":"#1f1d2e","--win-body":"#120f1d","--ptab-hover":"#1e1b30"},{background:"#120f1d",foreground:"#e0def4",cursor:"#c4a7e7",cursorAccent:"#120f1d",selectionBackground:"#2a273f",black:"#191724",brightBlack:"#6e6a86",red:"#eb6f92",brightRed:"#eb6f92",green:"#9ccfd8",brightGreen:"#9ccfd8",yellow:"#f6c177",brightYellow:"#f6c177",blue:"#31748f",brightBlue:"#3e9ab5",magenta:"#c4a7e7",brightMagenta:"#c4a7e7",cyan:"#9ccfd8",brightCyan:"#9ccfd8",white:"#e0def4",brightWhite:"#ffffff"},["#120f1d","#c4a7e7","#eb6f92","#9ccfd8"]),
  catppuccin:mkT("Catppuccin",{"--bg":"#181825","--grid":"#1e1e2e","--panel":"#1e1e2e","--panel-2":"#181825","--line":"#313244","--line-soft":"#292938","--text":"#cdd6f4","--muted":"#7f849c","--accent":"#89b4fa","--accent-dim":"#4a6fa5","--head-a":"#24273a","--head-b":"#1e2030","--chip-bg":"#1e1e2e","--chip-active":"#313244","--btn-bg":"#1e1e2e","--win-body":"#11111b","--ptab-hover":"#1a1a28"},{background:"#11111b",foreground:"#cdd6f4",cursor:"#f5e0dc",cursorAccent:"#11111b",selectionBackground:"#313244",black:"#45475a",brightBlack:"#585b70",red:"#f38ba8",brightRed:"#f38ba8",green:"#a6e3a1",brightGreen:"#a6e3a1",yellow:"#f9e2af",brightYellow:"#f9e2af",blue:"#89b4fa",brightBlue:"#89b4fa",magenta:"#cba6f7",brightMagenta:"#cba6f7",cyan:"#89dceb",brightCyan:"#89dceb",white:"#bac2de",brightWhite:"#a6adc8"},["#11111b","#89b4fa","#cba6f7","#a6e3a1"]),
  oneDark:mkT("One Dark",{"--bg":"#21252b","--grid":"#272b33","--panel":"#282c34","--panel-2":"#21252b","--line":"#353b45","--line-soft":"#2e343e","--text":"#abb2bf","--muted":"#5c6370","--accent":"#61afef","--accent-dim":"#3573a5","--head-a":"#30353f","--head-b":"#282c34","--chip-bg":"#282c34","--chip-active":"#353b45","--btn-bg":"#282c34","--win-body":"#1b1f23","--ptab-hover":"#272b33"},{background:"#1b1f23",foreground:"#abb2bf",cursor:"#528bff",cursorAccent:"#1b1f23",selectionBackground:"#3e4451",black:"#282c34",brightBlack:"#5c6370",red:"#e06c75",brightRed:"#e06c75",green:"#98c379",brightGreen:"#98c379",yellow:"#e5c07b",brightYellow:"#e5c07b",blue:"#61afef",brightBlue:"#61afef",magenta:"#c678dd",brightMagenta:"#c678dd",cyan:"#56b6c2",brightCyan:"#56b6c2",white:"#abb2bf",brightWhite:"#c8ccd4"},["#1b1f23","#61afef","#c678dd","#98c379"]),
  gruvbox:mkT("Gruvbox Dark",{"--bg":"#1d2021","--grid":"#24282a","--panel":"#282828","--panel-2":"#1d2021","--line":"#3c3836","--line-soft":"#32302f","--text":"#ebdbb2","--muted":"#7c6f64","--accent":"#fabd2f","--accent-dim":"#a07800","--head-a":"#32302f","--head-b":"#28261f","--chip-bg":"#282828","--chip-active":"#3c3836","--btn-bg":"#282828","--win-body":"#141617","--ptab-hover":"#24282a"},{background:"#141617",foreground:"#ebdbb2",cursor:"#fabd2f",cursorAccent:"#141617",selectionBackground:"#3c3836",black:"#282828",brightBlack:"#928374",red:"#cc241d",brightRed:"#fb4934",green:"#98971a",brightGreen:"#b8bb26",yellow:"#d79921",brightYellow:"#fabd2f",blue:"#458588",brightBlue:"#83a598",magenta:"#b16286",brightMagenta:"#d3869b",cyan:"#689d6a",brightCyan:"#8ec07c",white:"#a89984",brightWhite:"#ebdbb2"},["#141617","#fabd2f","#b8bb26","#fb4934"]),
  monokai:mkT("Monokai",{"--bg":"#1e1e1e","--grid":"#252525","--panel":"#272822","--panel-2":"#1e1e1e","--line":"#383830","--line-soft":"#303028","--text":"#f8f8f2","--muted":"#75715e","--accent":"#a6e22e","--accent-dim":"#5c8004","--head-a":"#303028","--head-b":"#272820","--chip-bg":"#272822","--chip-active":"#383830","--btn-bg":"#272822","--win-body":"#141414","--ptab-hover":"#252520"},{background:"#141414",foreground:"#f8f8f2",cursor:"#f8f8f0",cursorAccent:"#141414",selectionBackground:"#49483e",black:"#272822",brightBlack:"#75715e",red:"#f92672",brightRed:"#f92672",green:"#a6e22e",brightGreen:"#a6e22e",yellow:"#e6db74",brightYellow:"#e6db74",blue:"#66d9ef",brightBlue:"#66d9ef",magenta:"#ae81ff",brightMagenta:"#ae81ff",cyan:"#a1efe4",brightCyan:"#a1efe4",white:"#f8f8f2",brightWhite:"#f9f8f5"},["#141414","#a6e22e","#f92672","#e6db74"]),
  synthwave:mkT("Synthwave",{"--bg":"#1a1333","--grid":"#1f183c","--panel":"#241b3d","--panel-2":"#1e1637","--line":"#3a2d6e","--line-soft":"#2d2255","--text":"#f8e7ff","--muted":"#8b5fb3","--accent":"#f97ef8","--accent-dim":"#a043a0","--head-a":"#2a1e4a","--head-b":"#21173c","--chip-bg":"#241b3d","--chip-active":"#3a2d6e","--btn-bg":"#241b3d","--win-body":"#110d26","--ptab-hover":"#1f183c"},{background:"#110d26",foreground:"#f8e7ff",cursor:"#f97ef8",cursorAccent:"#110d26",selectionBackground:"#3a2d6e",black:"#1a1333",brightBlack:"#5c4a8a",red:"#fe4450",brightRed:"#ff7b83",green:"#72f1b8",brightGreen:"#b0f5d8",yellow:"#fede5d",brightYellow:"#ffe99c",blue:"#36f9f6",brightBlue:"#8dfcfa",magenta:"#f97ef8",brightMagenta:"#fcb8fc",cyan:"#03edf9",brightCyan:"#7ef8fe",white:"#f8e7ff",brightWhite:"#ffffff"},["#110d26","#f97ef8","#72f1b8","#fede5d"]),
  kanagawa:mkT("Kanagawa",{"--bg":"#16161d","--grid":"#1a1a22","--panel":"#1f1f28","--panel-2":"#1a1a22","--line":"#2a2a37","--line-soft":"#24242e","--text":"#dcd7ba","--muted":"#54546d","--accent":"#7e9cd8","--accent-dim":"#4a6099","--head-a":"#2a2a37","--head-b":"#22222e","--chip-bg":"#1f1f28","--chip-active":"#2a2a37","--btn-bg":"#1f1f28","--win-body":"#0d0c0c","--ptab-hover":"#1a1a22"},{background:"#0d0c0c",foreground:"#dcd7ba",cursor:"#c8c093",cursorAccent:"#0d0c0c",selectionBackground:"#2d4f67",black:"#16161d",brightBlack:"#727169",red:"#c34043",brightRed:"#e82424",green:"#76946a",brightGreen:"#98bb6c",yellow:"#c0a36e",brightYellow:"#e6c384",blue:"#7e9cd8",brightBlue:"#7fb4ca",magenta:"#957fb8",brightMagenta:"#938aa9",cyan:"#6a9589",brightCyan:"#7aa89f",white:"#c8c093",brightWhite:"#dcd7ba"},["#0d0c0c","#7e9cd8","#957fb8","#76946a"]),
  github:mkT("GitHub Dark",{"--bg":"#0d1117","--grid":"#131921","--panel":"#161b22","--panel-2":"#0d1117","--line":"#21262d","--line-soft":"#1c2128","--text":"#e6edf3","--muted":"#6e7681","--accent":"#58a6ff","--accent-dim":"#1f4e9c","--head-a":"#1c2128","--head-b":"#161b22","--chip-bg":"#161b22","--chip-active":"#21262d","--btn-bg":"#161b22","--win-body":"#090d12","--ptab-hover":"#131921"},{background:"#090d12",foreground:"#e6edf3",cursor:"#58a6ff",cursorAccent:"#090d12",selectionBackground:"#1f6feb66",black:"#484f58",brightBlack:"#6e7681",red:"#ff7b72",brightRed:"#ffa198",green:"#3fb950",brightGreen:"#56d364",yellow:"#d29922",brightYellow:"#e3b341",blue:"#58a6ff",brightBlue:"#79c0ff",magenta:"#bc8cff",brightMagenta:"#d2a8ff",cyan:"#39c5cf",brightCyan:"#56d4dd",white:"#b1bac4",brightWhite:"#f0f6fc"},["#090d12","#58a6ff","#3fb950","#bc8cff"]),
  everforest:mkT("Everforest",{"--bg":"#272e33","--grid":"#2d3439","--panel":"#2d353b","--panel-2":"#272e33","--line":"#374145","--line-soft":"#323a3e","--text":"#d3c6aa","--muted":"#7a8478","--accent":"#83c092","--accent-dim":"#4a7d59","--head-a":"#343d41","--head-b":"#2e363a","--chip-bg":"#2d353b","--chip-active":"#374145","--btn-bg":"#2d353b","--win-body":"#1e2326","--ptab-hover":"#2d3439"},{background:"#1e2326",foreground:"#d3c6aa",cursor:"#d3c6aa",cursorAccent:"#1e2326",selectionBackground:"#374145",black:"#343d46",brightBlack:"#868d80",red:"#e67e80",brightRed:"#e67e80",green:"#a7c080",brightGreen:"#a7c080",yellow:"#dbbc7f",brightYellow:"#dbbc7f",blue:"#7fbbb3",brightBlue:"#7fbbb3",magenta:"#d699b6",brightMagenta:"#d699b6",cyan:"#83c092",brightCyan:"#83c092",white:"#d3c6aa",brightWhite:"#d3c6aa"},["#1e2326","#83c092","#a7c080","#e67e80"]),
  amoled:mkT("AMOLED Black",{"--bg":"#000000","--grid":"#0a0a0a","--panel":"#0d0d0d","--panel-2":"#000000","--line":"#1a1a1a","--line-soft":"#141414","--text":"#e0e0e0","--muted":"#555555","--accent":"#00e5ff","--accent-dim":"#007a99","--head-a":"#111111","--head-b":"#0a0a0a","--chip-bg":"#0d0d0d","--chip-active":"#1a1a1a","--btn-bg":"#0d0d0d","--win-body":"#000000","--ptab-hover":"#0a0a0a"},{background:"#000000",foreground:"#e0e0e0",cursor:"#00e5ff",cursorAccent:"#000000",selectionBackground:"#1a1a1a",black:"#000000",brightBlack:"#555555",red:"#ff4444",brightRed:"#ff6666",green:"#00e676",brightGreen:"#33ff8a",yellow:"#ffea00",brightYellow:"#ffef33",blue:"#448aff",brightBlue:"#6699ff",magenta:"#e040fb",brightMagenta:"#ea80fc",cyan:"#00e5ff",brightCyan:"#33eeff",white:"#e0e0e0",brightWhite:"#ffffff"},["#000000","#00e5ff","#00e676","#448aff"]),
  highContrast:mkT("High Contrast",{"--bg":"#000000","--grid":"#111111","--panel":"#111111","--panel-2":"#000000","--line":"#ffffff","--line-soft":"#cccccc","--text":"#ffffff","--muted":"#aaaaaa","--accent":"#ffff00","--accent-dim":"#aaaa00","--head-a":"#222222","--head-b":"#111111","--chip-bg":"#111111","--chip-active":"#333333","--btn-bg":"#222222","--win-body":"#000000","--ptab-hover":"#111111"},{background:"#000000",foreground:"#ffffff",cursor:"#ffff00",cursorAccent:"#000000",selectionBackground:"#444444",black:"#000000",brightBlack:"#666666",red:"#ff0000",brightRed:"#ff3333",green:"#00ff00",brightGreen:"#33ff33",yellow:"#ffff00",brightYellow:"#ffff33",blue:"#3399ff",brightBlue:"#66b3ff",magenta:"#ff00ff",brightMagenta:"#ff33ff",cyan:"#00ffff",brightCyan:"#33ffff",white:"#ffffff",brightWhite:"#ffffff"},["#000000","#ffff00","#00ff00","#00ffff"]),
  matrix:mkT("Matrix",{"--bg":"#000000","--grid":"#030a03","--panel":"#061006","--panel-2":"#030803","--line":"#0a2a0a","--line-soft":"#071807","--text":"#00ff41","--muted":"#0a5a0a","--accent":"#00ff41","--accent-dim":"#006618","--head-a":"#061a06","--head-b":"#041204","--chip-bg":"#061006","--chip-active":"#0a2a0a","--btn-bg":"#061006","--win-body":"#000000","--ptab-hover":"#030a03"},{background:"#000000",foreground:"#00ff41",cursor:"#00ff41",cursorAccent:"#000000",selectionBackground:"#003b00",black:"#000000",brightBlack:"#004d00",red:"#00c934",brightRed:"#00ff41",green:"#00ff41",brightGreen:"#5cff8c",yellow:"#00ff41",brightYellow:"#5cff8c",blue:"#00ff41",brightBlue:"#5cff8c",magenta:"#00ff41",brightMagenta:"#5cff8c",cyan:"#00ff41",brightCyan:"#5cff8c",white:"#00ff41",brightWhite:"#c9ffd9"},["#000000","#00ff41","#5cff8c","#007700"]),
  amber:mkT("Amber CRT",{"--bg":"#0b0704","--grid":"#100c06","--panel":"#120e07","--panel-2":"#0b0704","--line":"#3a2a0a","--line-soft":"#2a1d06","--text":"#ffb000","--muted":"#7a5520","--accent":"#ffb000","--accent-dim":"#7a5a00","--head-a":"#1e1508","--head-b":"#150e04","--chip-bg":"#120e07","--chip-active":"#3a2a0a","--btn-bg":"#120e07","--win-body":"#040200","--ptab-hover":"#100c06"},{background:"#040200",foreground:"#ffb000",cursor:"#ffb000",cursorAccent:"#040200",selectionBackground:"#3a2a00",black:"#100a00",brightBlack:"#5c4a1c",red:"#ff8f00",brightRed:"#ffb000",green:"#ffb000",brightGreen:"#ffcf5c",yellow:"#ffb000",brightYellow:"#ffd76a",blue:"#ffb000",brightBlue:"#ffcf5c",magenta:"#ffb000",brightMagenta:"#ffcf5c",cyan:"#ffb000",brightCyan:"#ffcf5c",white:"#ffb000",brightWhite:"#ffe9b3"},["#040200","#ffb000","#ffcf5c","#ff8f00"]),

  // ── Light themes ──
  githubLight:mkT("GitHub Light",{"--bg":"#f6f8fa","--grid":"#eaeef2","--panel":"#ffffff","--panel-2":"#f6f8fa","--line":"#d0d7de","--line-soft":"#e1e4e8","--text":"#1f2328","--muted":"#656d76","--accent":"#0969da","--accent-dim":"#a6c8f0","--head-a":"#f6f8fa","--head-b":"#eaeef2","--chip-bg":"#f6f8fa","--chip-active":"#eaeef2","--btn-bg":"#f6f8fa","--win-body":"#ffffff","--ptab-hover":"#eaeef2"},{background:"#ffffff",foreground:"#1f2328",cursor:"#0969da",cursorAccent:"#ffffff",selectionBackground:"#0969da33",black:"#24292f",brightBlack:"#57606a",red:"#cf222e",brightRed:"#a40e26",green:"#1a7f37",brightGreen:"#116329",yellow:"#9a6700",brightYellow:"#7d4e00",blue:"#0969da",brightBlue:"#0550ae",magenta:"#8250df",brightMagenta:"#6639ba",cyan:"#1b7c83",brightCyan:"#3192aa",white:"#6e7781",brightWhite:"#24292f"},["#ffffff","#0969da","#1a7f37","#8250df"]),
  solarizedLight:mkT("Solarized Light",{"--bg":"#eee8d5","--grid":"#e4dcc3","--panel":"#fdf6e3","--panel-2":"#eee8d5","--line":"#d6cfb8","--line-soft":"#e0d9c0","--text":"#586e75","--muted":"#93a1a1","--accent":"#268bd2","--accent-dim":"#93c4e8","--head-a":"#eee8d5","--head-b":"#e4dcc3","--chip-bg":"#eee8d5","--chip-active":"#e0d9c0","--btn-bg":"#eee8d5","--win-body":"#fdf6e3","--ptab-hover":"#e4dcc3"},{background:"#fdf6e3",foreground:"#657b83",cursor:"#586e75",cursorAccent:"#fdf6e3",selectionBackground:"#eee8d5",black:"#073642",brightBlack:"#002b36",red:"#dc322f",brightRed:"#cb4b16",green:"#859900",brightGreen:"#586e75",yellow:"#b58900",brightYellow:"#657b83",blue:"#268bd2",brightBlue:"#839496",magenta:"#d33682",brightMagenta:"#6c71c4",cyan:"#2aa198",brightCyan:"#93a1a1",white:"#eee8d5",brightWhite:"#fdf6e3"},["#fdf6e3","#268bd2","#859900","#d33682"]),
  oneLight:mkT("One Light",{"--bg":"#f0f0f1","--grid":"#e8e8ea","--panel":"#fafafa","--panel-2":"#f0f0f1","--line":"#d4d4d6","--line-soft":"#e1e1e3","--text":"#383a42","--muted":"#a0a1a7","--accent":"#4078f2","--accent-dim":"#a9c2f8","--head-a":"#f0f0f1","--head-b":"#e8e8ea","--chip-bg":"#f0f0f1","--chip-active":"#e1e1e3","--btn-bg":"#f0f0f1","--win-body":"#fafafa","--ptab-hover":"#e8e8ea"},{background:"#fafafa",foreground:"#383a42",cursor:"#4078f2",cursorAccent:"#fafafa",selectionBackground:"#d0d0d0",black:"#383a42",brightBlack:"#a0a1a7",red:"#e45649",brightRed:"#e45649",green:"#50a14f",brightGreen:"#50a14f",yellow:"#c18401",brightYellow:"#c18401",blue:"#4078f2",brightBlue:"#4078f2",magenta:"#a626a4",brightMagenta:"#a626a4",cyan:"#0184bc",brightCyan:"#0184bc",white:"#a0a1a7",brightWhite:"#383a42"},["#fafafa","#4078f2","#50a14f","#a626a4"]),
  catppuccinLatte:mkT("Catppuccin Latte",{"--bg":"#e6e9ef","--grid":"#dce0e8","--panel":"#eff1f5","--panel-2":"#e6e9ef","--line":"#ccd0da","--line-soft":"#dce0e8","--text":"#4c4f69","--muted":"#8c8fa1","--accent":"#1e66f5","--accent-dim":"#a6c0fb","--head-a":"#e6e9ef","--head-b":"#dce0e8","--chip-bg":"#e6e9ef","--chip-active":"#ccd0da","--btn-bg":"#e6e9ef","--win-body":"#eff1f5","--ptab-hover":"#dce0e8"},{background:"#eff1f5",foreground:"#4c4f69",cursor:"#dc8a78",cursorAccent:"#eff1f5",selectionBackground:"#ccd0da",black:"#5c5f77",brightBlack:"#6c6f85",red:"#d20f39",brightRed:"#d20f39",green:"#40a02b",brightGreen:"#40a02b",yellow:"#df8e1d",brightYellow:"#df8e1d",blue:"#1e66f5",brightBlue:"#1e66f5",magenta:"#8839ef",brightMagenta:"#8839ef",cyan:"#179299",brightCyan:"#179299",white:"#acb0be",brightWhite:"#bcc0cc"},["#eff1f5","#1e66f5","#8839ef","#40a02b"]),
  rosePineDawn:mkT("Rose Pine Dawn",{"--bg":"#f2e9e1","--grid":"#ece0d6","--panel":"#fffaf3","--panel-2":"#faf4ed","--line":"#dfd8d0","--line-soft":"#ece0d6","--text":"#575279","--muted":"#9893a5","--accent":"#907aa9","--accent-dim":"#c9bcd8","--head-a":"#f2e9e1","--head-b":"#ece0d6","--chip-bg":"#f2e9e1","--chip-active":"#e4d8ce","--btn-bg":"#f2e9e1","--win-body":"#faf4ed","--ptab-hover":"#ece0d6"},{background:"#faf4ed",foreground:"#575279",cursor:"#907aa9",cursorAccent:"#faf4ed",selectionBackground:"#dfdad9",black:"#f2e9e1",brightBlack:"#9893a5",red:"#b4637a",brightRed:"#b4637a",green:"#56949f",brightGreen:"#56949f",yellow:"#ea9d34",brightYellow:"#ea9d34",blue:"#286983",brightBlue:"#286983",magenta:"#907aa9",brightMagenta:"#907aa9",cyan:"#d7827e",brightCyan:"#d7827e",white:"#575279",brightWhite:"#575279"},["#faf4ed","#907aa9","#b4637a","#56949f"]),
  gruvboxLight:mkT("Gruvbox Light",{"--bg":"#ebdbb2","--grid":"#e6d5a8","--panel":"#fbf1c7","--panel-2":"#f2e5bc","--line":"#d5c4a1","--line-soft":"#e0cfa0","--text":"#3c3836","--muted":"#7c6f64","--accent":"#b57614","--accent-dim":"#dcc48a","--head-a":"#ebdbb2","--head-b":"#e6d5a8","--chip-bg":"#ebdbb2","--chip-active":"#d5c4a1","--btn-bg":"#ebdbb2","--win-body":"#fbf1c7","--ptab-hover":"#e6d5a8"},{background:"#fbf1c7",foreground:"#3c3836",cursor:"#b57614",cursorAccent:"#fbf1c7",selectionBackground:"#d5c4a1",black:"#fbf1c7",brightBlack:"#928374",red:"#cc241d",brightRed:"#9d0006",green:"#98971a",brightGreen:"#79740e",yellow:"#d79921",brightYellow:"#b57614",blue:"#458588",brightBlue:"#076678",magenta:"#b16286",brightMagenta:"#8f3f71",cyan:"#689d6a",brightCyan:"#427b58",white:"#7c6f64",brightWhite:"#3c3836"},["#fbf1c7","#b57614","#98971a","#cc241d"]),
  paper:mkT("Paper",{"--bg":"#e7e0d0","--grid":"#ddd5c3","--panel":"#faf6ec","--panel-2":"#f1ebdc","--line":"#d8cfbb","--line-soft":"#e4dcc9","--text":"#33302b","--muted":"#8a8273","--accent":"#35638a","--accent-dim":"#a9bfd2","--head-a":"#f1ebdc","--head-b":"#e9e1d0","--chip-bg":"#efe8d8","--chip-active":"#e2d9c5","--btn-bg":"#efe8d8","--win-body":"#faf6ec","--ptab-hover":"#e9e1d0"},{background:"#faf6ec",foreground:"#33302b",cursor:"#35638a",cursorAccent:"#faf6ec",selectionBackground:"#d8c7a8",black:"#33302b",brightBlack:"#8a8273",red:"#a03232",brightRed:"#c14a4a",green:"#4f7a30",brightGreen:"#6b9640",yellow:"#a9781a",brightYellow:"#c8941f",blue:"#35638a",brightBlue:"#4f81a8",magenta:"#8a4d7a",brightMagenta:"#a86699",cyan:"#2f7d78",brightCyan:"#409a94",white:"#8a8273",brightWhite:"#33302b"},["#faf6ec","#35638a","#4f7a30","#8a4d7a"]),
};
const THEME_ORDER=["console","tokyoNight","dracula","catppuccin","rosePine","nord","oneDark","gruvbox","monokai","kanagawa","synthwave","everforest","github","amoled","highContrast","matrix","amber","githubLight","paper","solarizedLight","oneLight","catppuccinLatte","rosePineDawn","gruvboxLight"];
const THEME_STORE="td.theme.v2", STORE="td.state.v5", TREE_HIDDEN_STORE="td.treeHidden.v1", TREE_FOLLOW_STORE="td.treeFollow.v1";
let defaultThemeId="console";
try{const sv=localStorage.getItem(THEME_STORE);if(sv&&THEMES[sv])defaultThemeId=sv;}catch{}
// WCAG relative luminance and contrast ratio of #rrggbb colours.
function lum(hex){
  const c=[1,3,5].map((i)=>{const v=parseInt(hex.slice(i,i+2),16)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
// Readable text for accent-filled surfaces (primary button, hovered menu row): whichever of near-black / white has the higher WCAG contrast on the accent.
function onAccent(hex){
  const L=lum(hex);
  return 1.05/(L+.05)>(L+.05)/.05?"#ffffff":"#08120f";   // contrast vs white  >  contrast vs #08120f (L≈.005)
}
// Text tokens reach WCAG AA (4.5:1) on every surface they sit on. A theme whose --text/--muted is dimmer than that is
// lifted toward `pole` in 5% steps, so it keeps its tint and its muted-vs-text hierarchy as far as AA allows.
function readable(fg,bgs,pole){
  const mix=(t)=>"#"+[1,3,5].map((i)=>Math.round(parseInt(fg.slice(i,i+2),16)*(1-t)+parseInt(pole.slice(i,i+2),16)*t).toString(16).padStart(2,"0")).join("");
  for(let i=0;i<=20;i++){const c=mix(i/20);if(bgs.every((b)=>contrast(c,b)>=4.5))return c;}
  return pole;
}
const TEXT_SURFACES=["--bg","--panel","--panel-2","--win-body","--btn-bg","--chip-bg","--chip-active","--ptab-hover"];
function applyUITheme(id){
  const t=THEMES[id]||THEMES.console, u=t.ui, r=document.documentElement.style;
  Object.entries(u).forEach(([k,v])=>r.setProperty(k,v));
  r.setProperty("--on-accent",onAccent(u["--accent"]));
  const bgs=TEXT_SURFACES.map((k)=>u[k]).filter((v)=>/^#[0-9a-f]{6}$/i.test(v||""));
  const pole=lum(u["--panel"])<.18?"#ffffff":"#000000", text=readable(u["--text"],bgs,pole);
  r.setProperty("--text",text);
  r.setProperty("--muted",readable(u["--muted"],bgs,text));
  r.setProperty("--accent-text",readable(u["--accent"],bgs,pole));   // --accent stays as-is for fills, borders and glows
  const vars={}; for(const k of [...Object.keys(u),"--on-accent","--accent-text"]) vars[k]=r.getPropertyValue(k);
  try{localStorage.setItem("td.themevars.v1",JSON.stringify(vars));}catch{}   // read by the <head> script on the next load
}
applyUITheme(defaultThemeId);
requestAnimationFrame(()=>requestAnimationFrame(()=>document.documentElement.classList.remove("td-boot")));   // theme painted: transitions back on

/* ════════════════════════════════════════════════
   DOM REFS
   ════════════════════════════════════════════════ */
const desktop    = document.getElementById("desktop");
const dock       = document.getElementById("dock");
const dockTrack  = document.getElementById("dock-track");
const dockScroll = document.getElementById("dock-scroll");
const hint       = document.getElementById("hint");
const connEl     = document.getElementById("conn");
const connText   = document.getElementById("conn-text");
const modeEl     = document.getElementById("mode");
const snapEl     = document.getElementById("snap");
const guideV     = document.getElementById("guideV");
const guideH     = document.getElementById("guideH");
const cwdPop     = document.getElementById("cwd-pop");
const cwdInput   = document.getElementById("cwd-input");
const movePop    = document.getElementById("move-pop");
const moveList   = document.getElementById("move-list");
const themePop   = document.getElementById("theme-pop");
const themeGrid  = document.getElementById("theme-grid");
const themeLbl   = document.getElementById("theme-pop-label");
const themeHint  = document.getElementById("theme-pop-hint");
const themeSearch= document.getElementById("theme-search");
const themeClear = document.getElementById("theme-clear");
const themeReset = document.getElementById("theme-reset");
const themeBtn   = document.getElementById("theme-btn");
const agentBtn   = document.getElementById("agent-btn");
const agentBadge = document.getElementById("agent-badge");
const agentPop   = document.getElementById("agent-pop");
const agentList  = document.getElementById("agent-list");
const agentPopCount = document.getElementById("agent-pop-count");
const projectsBar= document.getElementById("projects");
const projTrack  = document.getElementById("proj-track");
const projScroll = document.getElementById("proj-scroll");
const paddBtn    = document.getElementById("padd"); paddBtn.innerHTML=ICON.plus;
const palOverlay = document.getElementById("pal-overlay");
const palette    = document.getElementById("palette");
const palInput   = document.getElementById("pal-input");
const palList    = document.getElementById("pal-list");
const scOverlay  = document.getElementById("sc-overlay");
const sidebar    = document.getElementById("sidebar");
const sbTitleEl  = document.getElementById("sb-title");
const treeEl     = document.getElementById("tree");
const toastsEl   = document.getElementById("toasts");
const sessSearch = document.getElementById("sess-search");
const ssInput    = document.getElementById("ss-input");
const ssCount    = document.getElementById("ss-count");
const searchBtn  = document.getElementById("search-btn");

// Live only when a real backend is reachable: served over http(s) AND not a static
// preview (github.io host, file://, or ?demo). Static hosts get demo mode, no shells.
const FORCE_DEMO = /\bdemo\b/.test(location.search) || /github\.io$/.test(location.hostname);
const LIVE = !FORCE_DEMO && (location.protocol==="http:"||location.protocol==="https:");
modeEl.textContent = LIVE ? "· live" : "· demo";
// Platform-correct shortcut labels: handlers accept metaKey||ctrlKey, so mac shows ⌘, others Ctrl.
const MAX_TERMS = 12;    // terminals (windows) per project
const MAX_PROJECTS = 10;  // project tabs
const MAC = /Mac/i.test(navigator.userAgentData?.platform||navigator.platform);
const MOD = MAC?"⌘":"Ctrl";
const OSKEY={"⌘":MOD,"⌃":MAC?"⌃":"Ctrl","⇧":MAC?"⇧":"Shift","⌥":MAC?"⌥":"Alt"};
function kbd(...keys){return keys.map(k=>OSKEY[k]||k).join(MAC?"":"+");}
// split a glyph combo ("⌘⌥P") into per-OS key tokens (["⌘","⌥","P"] / ["Ctrl","Alt","P"]) for <kbd> rendering
function osKeys(str){return [...str].map(ch=>OSKEY[ch]||ch);}
document.documentElement.classList.toggle("is-mac",MAC);

let instanceActive = true;   // false when another dashboard tab holds the lock (see single-instance guard)
let selfReload = false;      // true when we trigger location.reload() ourselves — suppresses the beforeunload prompt
let broadcastOn = false;     // when true, keystrokes in any terminal mirror to all live shells
// A tab Cast can reach: a real live shell, or a demo shell (echoes locally) so the showcase can demo Cast too.
const castable = (t)=>t.status==="live"||t.status==="demo";
const sessions    = new Map();
let order         = [];
const projects    = new Map();
let projectOrder  = [];
let activeProject = null;
let nameSeq=0, tabSeq=0, zTop=10, focusedId=null;
// last-used cwd is per-project: a new project starts fresh (~), never inherits another project's path
function curCwd(){return projects.get(activeProject)?.lastCwd||"";}
function setCwd(v){const p=projects.get(activeProject);if(p)p.lastCwd=v;}
let saveTimer=null, moveTargetSession=null, themeTargetSession=null;
let sidebarOpen=false, sessSearchOpen=false;


// Small DOM helpers, used everywhere (also while the later scripts load).
function el(tag,cls){const n=document.createElement(tag);if(cls)n.className=cls;return n;}
function wbtn(t){const b=el("button","wbtn");b.title=t;return b;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function pad(n){return String(n).padStart(2,"0");}
function newId(prefix){return(prefix||"s")+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
