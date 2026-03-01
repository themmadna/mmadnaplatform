import React from 'react';
import { Target } from 'lucide-react';

const CombatDNAVisual = ({ dna, currentTheme }) => {
  if (!dna) return null;

  const head = dna.avgHeadStrikes || 0;
  const body = dna.avgBodyStrikes || 0;
  const legs = dna.avgLegStrikes || 0;
  const grandTotal = head + body + legs || 1;

  const headPct = Math.round((head / grandTotal) * 100);
  const bodyPct = Math.round((body / grandTotal) * 100);
  const legPct = Math.round((legs / grandTotal) * 100);

  // --- HEAT MAP LOGIC ---
  const zones = [
    { id: 'head', pct: headPct },
    { id: 'body', pct: bodyPct },
    { id: 'legs', pct: legPct }
  ];

  const sortedZones = [...zones].sort((a, b) => b.pct - a.pct);

  const getHeatColor = (id) => {
    const rank = sortedZones.findIndex(z => z.id === id);
    if (rank === 0) return { r: 239, g: 68, b: 68 };   // Red
    if (rank === 1) return { r: 249, g: 115, b: 22 };  // Orange
    if (rank === 2) return { r: 234, g: 179, b: 8 };   // Yellow
    return { r: 255, g: 255, b: 255 };
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

  const detailColor = currentTheme.text.includes('white') ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';

  return (
    // Changed: flex-col with p-6 padding to match stats card layout
    <div className={`flex flex-col p-6 ${currentTheme.card} rounded-2xl border mb-8 shadow-2xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-1000`}>
       
       {/* Ambient Background Light */}
       <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-white opacity-5 blur-[100px] rounded-full pointer-events-none`}></div>

       {/* --- HEADER SECTION (Left Aligned) --- */}
       <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4 relative z-10">
          <Target className={currentTheme.accent} size={24} />
          <div>
            <h2 className="text-xl font-black uppercase tracking-wider">Strike Location</h2>
            <p className="text-xs opacity-50">Target Distribution</p>
          </div>
       </div>
       
      {/* Content Container (Centered horizontally) */}
      <div className="flex justify-between items-center relative z-10 w-full max-w-lg mx-auto pt-4">
        
        {/* Left Side: HEAD & LEGS */}
        <div className="flex flex-col gap-32 h-full justify-center text-right pt-6">
            <div className="group">
                <div className="text-4xl font-black transition-all duration-500" style={{ color: getTextColor('head'), textShadow: `0 0 20px ${getTextColor('head')}` }}>{headPct}%</div>
                <div className="text-xs opacity-60 uppercase tracking-widest font-bold text-white">Head</div>
            </div>
            <div className="group">
                <div className="text-4xl font-black transition-all duration-500" style={{ color: getTextColor('legs'), textShadow: `0 0 20px ${getTextColor('legs')}` }}>{legPct}%</div>
                <div className="text-xs opacity-60 uppercase tracking-widest font-bold text-white">Legs</div>
            </div>
        </div>

        {/* --- ROBUST FIGHTER SVG (Mannequin Style) --- */}
        <svg 
            version="1.1" 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 200 400" 
            className="h-80 w-auto drop-shadow-2xl"
            style={{ overflow: 'visible' }} 
        >
            <defs>
              <style>{`.muscle-line { fill: none; stroke: ${detailColor}; stroke-width: 1; stroke-linecap: round; opacity: 0.6; }`}</style>
            </defs>

            {/* 1. HEAD ZONE */}
            <g id="head-zone" style={getStyle('head', headPct)}>
                <ellipse cx="100" cy="50" rx="18" ry="22" />
                <circle cx="82" cy="50" r="3" />
                <circle cx="118" cy="50" r="3" />
            </g>

            {/* 2. BODY ZONE (Torso + Arms + Gloves) */}
            <g id="body-zone" style={getStyle('body', bodyPct)}>
                 <rect x="90" y="70" width="20" height="15" />
                 
                 {/* Torso */}
                 <path d="M 70,85 L 130,85 L 115,180 L 85,180 Z" />
                 
                 {/* Arms */}
                 <path d="M 70,85 L 50,85 L 45,140 L 50,180 L 60,180 L 65,140 Z" />
                 <path d="M 130,85 L 150,85 L 155,140 L 150,180 L 140,180 L 135,140 Z" />

                 {/* Gloves */}
                 <rect x="42" y="180" width="22" height="28" rx="8" />
                 <rect x="136" y="180" width="22" height="28" rx="8" />

                 {/* Muscle Details */}
                 <path className="muscle-line" d="M 85,115 Q 100,125 115,115" />
                 <line className="muscle-line" x1="100" y1="125" x2="100" y2="170" />
                 <line className="muscle-line" x1="88" y1="145" x2="112" y2="145" />
                 <line className="muscle-line" x1="90" y1="160" x2="110" y2="160" />
            </g>

            {/* 3. LEG ZONE (Shorts + Legs) */}
            <g id="leg-zone" style={getStyle('legs', legPct)}>
                {/* Shorts */}
                <path d="M 85,180 L 115,180 L 120,240 L 100,250 L 80,240 Z" />
                <line className="muscle-line" x1="85" y1="185" x2="115" y2="185" />

                {/* Legs */}
                <path d="M 80,240 L 75,300 L 70,360 L 60,370 L 85,370 L 90,300 L 95,250 Z" />
                <path d="M 120,240 L 125,300 L 130,360 L 140,370 L 115,370 L 110,300 L 105,250 Z" />
                
                {/* Knees */}
                <path className="muscle-line" d="M 78,300 Q 82,305 87,300" />
                <path className="muscle-line" d="M 113,300 Q 118,305 122,300" />
            </g>
        </svg>

        {/* Right Side: BODY */}
        <div className="flex flex-col h-full justify-center">
            <div className="group">
                <div className="text-4xl font-black transition-all duration-500" style={{ color: getTextColor('body'), textShadow: `0 0 20px ${getTextColor('body')}` }}>{bodyPct}%</div>
                <div className="text-xs opacity-60 uppercase tracking-widest font-bold text-white">Body</div>
            </div>
        </div>

      </div>
    </div>
  );
};

export default CombatDNAVisual;