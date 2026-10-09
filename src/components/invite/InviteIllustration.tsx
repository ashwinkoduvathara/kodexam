/** Decorative illustration (laptop with an exam, a shield, plants). Purely presentational. */
export function InviteIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 330" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="kp-inv-leaf" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#bfe9d8" />
          <stop offset="1" stopColor="#8fd5ba" />
        </linearGradient>
        <linearGradient id="kp-inv-shield" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#22b07d" />
          <stop offset="1" stopColor="#0f7a55" />
        </linearGradient>
      </defs>
      <circle cx="160" cy="210" r="120" fill="#e9f7f1" />
      <circle cx="520" cy="150" r="100" fill="#eef8f4" />
      <ellipse cx="330" cy="312" rx="300" ry="12" fill="#e2ebe7" />

      {/* plant + books */}
      <g>
        <rect x="18" y="262" width="150" height="20" rx="6" fill="#cfe9dd" />
        <rect x="30" y="242" width="130" height="20" rx="6" fill="#e3f3ec" />
        <rect x="40" y="226" width="110" height="16" rx="6" fill="#bfe1d2" />
        {[
          [70, 150, -30],
          [95, 130, -8],
          [120, 140, 18],
          [140, 165, 38],
          [55, 180, -50],
        ].map(([x, y, r], i) => (
          <ellipse
            key={i}
            cx={x}
            cy={y}
            rx="18"
            ry="46"
            fill="url(#kp-inv-leaf)"
            transform={`rotate(${r} ${x} ${y + 40})`}
          />
        ))}
        <rect x="88" y="196" width="22" height="34" rx="4" fill="#9fd3bd" />
      </g>

      {/* laptop */}
      <g>
        <rect x="190" y="40" width="300" height="210" rx="14" fill="#1e3a6b" />
        <rect x="202" y="52" width="276" height="186" rx="8" fill="#f8fbff" />
        <rect x="214" y="64" width="150" height="162" rx="8" fill="#ffffff" stroke="#e5ecf3" />
        <rect
          x="226"
          y="78"
          width="16"
          height="16"
          rx="4"
          fill="none"
          stroke="#c9d3df"
          strokeWidth="2"
        />
        <rect x="250" y="80" width="100" height="5" rx="2.5" fill="#dfe6ee" />
        <rect x="250" y="89" width="70" height="4" rx="2" fill="#e8edf3" />
        <rect x="222" y="104" width="136" height="22" rx="6" fill="#d7f2e6" />
        <circle cx="236" cy="115" r="8" fill="#0f7a55" />
        <text x="236" y="118.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">
          A
        </text>
        <rect x="250" y="113" width="96" height="4" rx="2" fill="#22b07d" />
        {["B", "C", "D"].map((l, i) => (
          <g key={l}>
            <circle cx="236" cy={145 + i * 26} r="8" fill="#f1f4f8" />
            <text
              x="236"
              y={148.5 + i * 26}
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              fill="#111e38"
            >
              {l}
            </text>
            <rect x="250" y={143 + i * 26} width={90 - i * 12} height="4" rx="2" fill="#e3e9f0" />
          </g>
        ))}
        <rect x="374" y="64" width="92" height="162" rx="8" fill="#ffffff" stroke="#e5ecf3" />
        <rect x="384" y="74" width="30" height="5" rx="2.5" fill="#dfe6ee" />
        {Array.from({ length: 12 }, (_, i) => (
          <rect
            key={i}
            x={384 + (i % 3) * 25}
            y={88 + Math.floor(i / 3) * 24}
            width="18"
            height="16"
            rx="4"
            fill="#e8eef5"
          />
        ))}
        <path d="M160 250 h360 l-18 22 h-324 z" fill="#d9e1ea" />
        <rect x="300" y="250" width="80" height="6" rx="3" fill="#c3cdd8" />
      </g>

      {/* shield */}
      <g>
        <circle cx="470" cy="232" r="58" fill="#ffffff" stroke="#e5f2ec" strokeWidth="3" />
        <path
          d="M470 192 l34 12 v24 c0 22 -14 38 -34 46 c-20 -8 -34 -24 -34 -46 v-24 z"
          fill="url(#kp-inv-shield)"
        />
        <path
          d="M455 232 l11 11 l20 -22"
          fill="none"
          stroke="#ffffff"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
