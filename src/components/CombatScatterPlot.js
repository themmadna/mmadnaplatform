import React, { useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Label, Cell } from 'recharts';
import { Settings2 } from 'lucide-react';

const CombatScatterPlot = ({ data, baselines, currentTheme }) => {
  const [xMetric, setXMetric] = useState('pace');
  const [yMetric, setYMetric] = useState('intensity');

  if (!data || data.length === 0) return null;

  // Configuration with explicit units
  const metrics = {
    pace: { 
        label: 'Strike Pace', 
        baseline: baselines.strikePace, 
        color: '#60A5FA', 
        unit: '/min'  // e.g. "12.5/min"
    },
    intensity: { 
        label: 'Grappling Intensity', 
        baseline: baselines.intensityScore, 
        color: '#FACC15', 
        unit: ''      // Score usually doesn't need a unit suffix
    },
    violence: { 
        label: 'Violence Index', 
        baseline: baselines.violenceIndex, 
        color: '#F87171', 
        unit: '/min' 
    },
    control: { 
        label: 'Control Time', 
        baseline: baselines.engagementStyle, 
        color: '#34D399', 
        unit: '%'     // <--- This ensures it shows as percentage
    }
  };

  const xConfig = metrics[xMetric];
  const yConfig = metrics[yMetric];

  // Calculate dynamic domains
  const xMax = Math.max(...data.map(d => d[xMetric]), xConfig.baseline) * 1.15;
  const yMax = Math.max(...data.map(d => d[yMetric]), yConfig.baseline) * 1.15;

  // Helper to safely round numbers
  const fmt = (num) => Number(num).toFixed(2);

  return (
    <div className={`p-6 rounded-2xl border ${currentTheme.card} mb-8 shadow-xl animate-in fade-in`}>
      
      {/* HEADER + CONTROLS */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
            <h2 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                Fight Map <Settings2 size={16} className="opacity-50" />
            </h2>
            <p className="text-xs opacity-50">Compare your favorite fights by metric</p>
        </div>

        {/* AXIS SELECTORS */}
        <div className="flex items-center gap-2 text-xs">
            <div className="flex flex-col">
                <label className="text-[10px] uppercase opacity-50 font-bold mb-1">X-Axis</label>
                <select 
                    value={xMetric} 
                    onChange={(e) => setXMetric(e.target.value)}
                    className="bg-black/30 border border-white/10 rounded px-2 py-1 text-white focus:outline-none focus:border-white/50 cursor-pointer"
                >
                    {Object.entries(metrics).map(([key, conf]) => (
                        <option key={key} value={key}>{conf.label}</option>
                    ))}
                </select>
            </div>
            <span className="opacity-30 mt-4">vs</span>
            <div className="flex flex-col">
                <label className="text-[10px] uppercase opacity-50 font-bold mb-1">Y-Axis</label>
                <select 
                    value={yMetric} 
                    onChange={(e) => setYMetric(e.target.value)}
                    className="bg-black/30 border border-white/10 rounded px-2 py-1 text-white focus:outline-none focus:border-white/50 cursor-pointer"
                >
                    {Object.entries(metrics).map(([key, conf]) => (
                        <option key={key} value={key}>{conf.label}</option>
                    ))}
                </select>
            </div>
        </div>
      </div>

      {/* CHART AREA */}
      <div className="h-80 w-full bg-black/20 rounded-xl border border-white/5 relative">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
            
            {/* DYNAMIC X-AXIS */}
            <XAxis 
              type="number" 
              dataKey={xMetric} 
              name={xConfig.label}
              domain={[0, xMax]}
              tick={{ fill: 'white', fontSize: 10, opacity: 0.5 }}
              tickLine={false}
              tickFormatter={(val) => fmt(val)}
              axisLine={{ stroke: 'white', opacity: 0.2 }}
            >
                {/* LABEL WITH UNIT */}
                <Label 
                    value={`${xConfig.label} ${xConfig.unit ? `(${xConfig.unit})` : ''}`} 
                    offset={0} 
                    position="insideBottom" 
                    style={{ fill: 'white', opacity: 0.5, fontSize: 10 }} 
                />
            </XAxis>

            {/* DYNAMIC Y-AXIS */}
            <YAxis 
              type="number" 
              dataKey={yMetric} 
              name={yConfig.label} 
              domain={[0, yMax]}
              tick={{ fill: 'white', fontSize: 10, opacity: 0.5 }}
              tickLine={false}
              tickFormatter={(val) => fmt(val)}
              axisLine={{ stroke: 'white', opacity: 0.2 }}
            >
                {/* LABEL WITH UNIT */}
                <Label 
                    value={`${yConfig.label} ${yConfig.unit ? `(${yConfig.unit})` : ''}`} 
                    angle={-90} 
                    position="insideLeft" 
                    style={{ fill: 'white', opacity: 0.5, fontSize: 10 }} 
                />
            </YAxis>

            {/* CROSSHAIR (AVERAGES) */}
            <ReferenceLine x={xConfig.baseline} stroke={xConfig.color} strokeDasharray="3 3" opacity={0.5}>
                <Label 
                    value={`AVG: ${fmt(xConfig.baseline)}${xConfig.unit}`} 
                    position="insideTopRight" 
                    fill={xConfig.color} 
                    fontSize={9} 
                    opacity={0.8} 
                />
            </ReferenceLine>
            
            <ReferenceLine y={yConfig.baseline} stroke={yConfig.color} strokeDasharray="3 3" opacity={0.5}>
                <Label 
                    value={`AVG: ${fmt(yConfig.baseline)}${yConfig.unit}`} 
                    position="insideTopRight" 
                    fill={yConfig.color} 
                    fontSize={9} 
                    opacity={0.8} 
                />
            </ReferenceLine>

            {/* TOOLTIP */}
            <Tooltip 
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                            <div className="bg-gray-900 border border-white/10 p-3 rounded-lg shadow-xl text-xs z-50">
                                <p className="font-bold text-white mb-2 text-sm">{d.fullName}</p>
                                <div className="space-y-1">
                                    <p style={{ color: xConfig.color }}>
                                        {/* UNIT ADDED HERE */}
                                        {xConfig.label}: {fmt(d[xMetric])}{xConfig.unit} 
                                        <span className="text-gray-500 ml-1">
                                            (Avg: {fmt(xConfig.baseline)}{xConfig.unit})
                                        </span>
                                    </p>
                                    <p style={{ color: yConfig.color }}>
                                        {/* UNIT ADDED HERE */}
                                        {yConfig.label}: {fmt(d[yMetric])}{yConfig.unit} 
                                        <span className="text-gray-500 ml-1">
                                            (Avg: {fmt(yConfig.baseline)}{yConfig.unit})
                                        </span>
                                    </p>
                                </div>
                            </div>
                        );
                    }
                    return null;
                }}
            />

            {/* THE FIGHT DOTS */}
            <Scatter name="Fights" data={data} fill="#fff">
                {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry[yMetric] > yConfig.baseline ? yConfig.color : '#4B5563'} />
                ))}
            </Scatter>

          </ScatterChart>
        </ResponsiveContainer>
        
        {/* Dynamic Context Labels */}
        {xMetric === 'pace' && yMetric === 'intensity' && (
             <div className="absolute top-4 right-4 text-[10px] text-white/20 font-black pointer-events-none">TOTAL WAR</div>
        )}
      </div>
    </div>
  );
};

export default CombatScatterPlot;