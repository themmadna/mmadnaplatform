import React from 'react';

const CombatDNAVisual = ({ dna, currentTheme }) => {
  if (!dna) return null;

  const head = dna.avgHeadStrikes || 0;
  const body = dna.avgBodyStrikes || 0;
  const legs = dna.avgLegStrikes || 0;
  const grandTotal = head + body + legs || 1;

  const headPct = Math.round((head / grandTotal) * 100);
  const bodyPct = Math.round((body / grandTotal) * 100);
  const legPct = Math.round((legs / grandTotal) * 100);

  // Heat map: rank zones by percentage, assign intensity
  const zones = [
    { id: 'head', pct: headPct, avg: head },
    { id: 'body', pct: bodyPct, avg: body },
    { id: 'legs', pct: legPct, avg: legs }
  ];
  const sortedZones = [...zones].sort((a, b) => b.pct - a.pct);

  const getHeatColor = (id) => {
    const rank = sortedZones.findIndex(z => z.id === id);
    if (rank === 0) return { r: 239, g: 68, b: 68 };   // Red (highest)
    if (rank === 1) return { r: 249, g: 115, b: 22 };  // Orange
    return { r: 234, g: 179, b: 8 };                    // Yellow (lowest)
  };

  const getStyle = (id, pct) => {
    const color = getHeatColor(id);
    const opacity = 0.4 + (pct / 100) * 0.6;
    const glowSize = pct > 50 ? 25 : 10;
    return {
      fill: `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`,
      filter: `drop-shadow(0 0 ${glowSize}px rgba(${color.r}, ${color.g}, ${color.b}, 0.8))`,
      transition: 'all 1s ease'
    };
  };

  const getTextColor = (id) => {
    const c = getHeatColor(id);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  };

  // Bar width as percentage of max zone
  const maxAvg = Math.max(head, body, legs) || 1;

  const statRows = [
    { id: 'head', label: 'Head', pct: headPct, avg: head },
    { id: 'body', label: 'Body', pct: bodyPct, avg: body },
    { id: 'legs', label: 'Legs', pct: legPct, avg: legs },
  ];

  return (
    <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5 mb-4 overflow-hidden relative">
      {/* Header */}
      <div className="font-heading font-bold text-[15px] uppercase tracking-wider text-pulse-text-2 mb-5">
        Strike Distribution
      </div>

      {/* Body map + stats */}
      <div className="flex gap-6 items-start">
        {/* SVG mannequin */}
        <div className="flex-shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 200 400"
            className="h-56 w-auto"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <style>{`.muscle-line { fill: none; stroke: rgba(255,255,255,0.15); stroke-width: 1; stroke-linecap: round; opacity: 0.6; }`}</style>
            </defs>

            {/* HEAD */}
            <g style={getStyle('head', headPct)}>
              <ellipse cx="100" cy="50" rx="18" ry="22" />
              <circle cx="82" cy="50" r="3" />
              <circle cx="118" cy="50" r="3" />
            </g>

            {/* BODY */}
            <g style={getStyle('body', bodyPct)}>
              <rect x="90" y="70" width="20" height="15" />
              <path d="M 70,85 L 130,85 L 115,180 L 85,180 Z" />
              <path d="M 70,85 L 50,85 L 45,140 L 50,180 L 60,180 L 65,140 Z" />
              <path d="M 130,85 L 150,85 L 155,140 L 150,180 L 140,180 L 135,140 Z" />
              <rect x="42" y="180" width="22" height="28" rx="8" />
              <rect x="136" y="180" width="22" height="28" rx="8" />
              <path className="muscle-line" d="M 85,115 Q 100,125 115,115" />
              <line className="muscle-line" x1="100" y1="125" x2="100" y2="170" />
              <line className="muscle-line" x1="88" y1="145" x2="112" y2="145" />
              <line className="muscle-line" x1="90" y1="160" x2="110" y2="160" />
            </g>

            {/* LEGS */}
            <g style={getStyle('legs', legPct)}>
              <path d="M 85,180 L 115,180 L 120,240 L 100,250 L 80,240 Z" />
              <line className="muscle-line" x1="85" y1="185" x2="115" y2="185" />
              <path d="M 80,240 L 75,300 L 70,360 L 60,370 L 85,370 L 90,300 L 95,250 Z" />
              <path d="M 120,240 L 125,300 L 130,360 L 140,370 L 115,370 L 110,300 L 105,250 Z" />
              <path className="muscle-line" d="M 78,300 Q 82,305 87,300" />
              <path className="muscle-line" d="M 113,300 Q 118,305 122,300" />
            </g>
          </svg>
        </div>

        {/* Stats with bars */}
        <div className="flex-1 flex flex-col justify-center gap-5 pt-2">
          {statRows.map(({ id, label, pct, avg }) => (
            <div key={id}>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[13px] text-pulse-text-2">{label}</span>
                <span className="font-heading font-bold text-base" style={{ color: getTextColor(id) }}>
                  {pct}%
                </span>
              </div>
              <div className="h-1 bg-pulse-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${(avg / maxAvg) * 100}%`,
                    backgroundColor: getTextColor(id),
                  }}
                />
              </div>
              <div className="text-[11px] text-pulse-text-3 mt-1">{avg.toFixed(1)} / fight</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CombatDNAVisual;
