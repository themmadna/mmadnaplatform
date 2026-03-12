import { useState, useEffect, useRef } from 'react';
import { ThumbsUp, ThumbsDown, Star, ChevronLeft, ChevronRight, User, MapPin, Search, X, Activity, Swords, Zap, Dna, Sparkles, Settings2 } from 'lucide-react';
import { supabase } from './supabaseClient';
import { dataService } from './dataService';
import LoginPage from './Login';
import * as guestStorage from './guestStorage';
import CombatDNAVisual from './CombatDNAVisual';
import CombatScatterPlot from './components/CombatScatterPlot';
import FightDetailView from './components/FightDetailView';
import JudgingDNACard from './components/JudgingDNACard';
import JudgeDirectory from './components/JudgeDirectory';
import JudgeProfileView from './components/JudgeProfileView';
import JudgeComparison from './components/JudgeComparison';
import UserJudgeComparison from './components/UserJudgeComparison';

// --- CombatDNA Card (The 5 Metrics + Intensity) ---
const CombatDNACard = ({ dna, currentTheme, baselines }) => {

  if (!dna) return (
    <div className={`p-6 rounded-xl border border-dashed ${currentTheme.card} opacity-50 text-center animate-in fade-in`}>
      <Activity className="mx-auto mb-2 opacity-50" />
      <p className="text-sm">Rate more fights to generate your Combat DNA</p>
    </div>
  );

  const Comparison = ({ userVal, baseVal, suffix = '' }) => {
    const safeUser = Number(userVal) || 0;
    const safeBase = Number(baseVal) || 0;
    const diff = (safeUser - safeBase).toFixed(1);
    const isHigher = parseFloat(diff) > 0;
    
    return (
      <span className={`text-xs font-bold ml-2 ${isHigher ? currentTheme.accent : 'opacity-40'}`}>
        {isHigher ? '↑' : '↓'} {isHigher ? '+' : ''}{diff}{suffix}
      </span>
    );
  };

  const intensityScore = dna.intensityScore || 0; 
  
  const getIntensityLabel = (score) => {
      if (score > 12) return { text: "MAULER", color: "text-red-500" };
      if (score > 7) return { text: "ACTIVE GRAPPLER", color: "text-yellow-400" };
      return { text: "CONTROL FOCUSED", color: "text-blue-400" };
  };
  const intensityLabel = getIntensityLabel(intensityScore);

  return (
    <div className={`${currentTheme.card} p-6 ${currentTheme.rounded} mb-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700`}>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-center">
          <p className="text-xs opacity-50 uppercase tracking-widest mb-1">Strike Pace</p>
          <div className="text-2xl sm:text-3xl font-black mb-1">{dna.strikePace}</div>
          <p className="text-xs opacity-50 mb-2">combined strikes / min</p>
          <div className="bg-black/20 py-1 px-2 rounded-lg inline-block">
            <Comparison userVal={dna.strikePace} baseVal={baselines.strikePace} />
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-center">
          <p className="text-xs opacity-50 uppercase tracking-widest mb-1">Violence Index</p>
          <div className="text-2xl sm:text-3xl font-black mb-1">{dna.violenceIndex}</div>
          <p className="text-xs opacity-50 mb-2">(Kd + Sub Att) / min</p>
          <div className="bg-black/20 py-1 px-2 rounded-lg inline-block">
            <Comparison userVal={dna.violenceIndex} baseVal={baselines.violenceIndex} />
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* ENGAGEMENT STYLE + INTENSITY */}
        <div>
          <div className="flex justify-between text-sm mb-2 font-bold">
            <span className="flex items-center gap-2"><Swords size={14} /> Engagement Style</span>
            <div className="flex items-center">
              <span>{dna.engagementStyle}% Control</span>
              <Comparison userVal={dna.engagementStyle} baseVal={baselines.engagementStyle} suffix="%" />
            </div>
          </div>
          
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden relative mb-3" title="0% = Standup War, 100% = Grappling Clinic">
            <div className="absolute top-0 bottom-0 w-0.5 bg-white/30 z-10" style={{ left: `${baselines.engagementStyle}%` }}></div>
            <div className={`h-full ${currentTheme.primary} transition-all duration-1000`} style={{ width: `${dna.engagementStyle}%` }}></div>
          </div>

          {/* INTENSITY METRIC WITH COMPARISON */}
          <div className="flex items-center justify-between bg-white/5 rounded-lg p-2 px-3 border border-white/5">
             <div className="flex flex-col">
                 <span className="text-[10px] uppercase tracking-widest opacity-50">Grappling Intensity</span>
                 <span className={`text-xs font-bold ${intensityLabel.color}`}>{intensityLabel.text}</span>
             </div>
             
             <div className="flex items-center gap-3">
                 {/* The Comparison Badge */}
                 <div className="bg-black/20 py-1 px-2 rounded-lg">
                    <Comparison userVal={intensityScore} baseVal={baselines.intensityScore} />
                 </div>

                 <div className="text-right">
                     <span className="text-lg font-black">{intensityScore}</span>
                     <span className="text-[10px] opacity-40 ml-1">Work Rate</span>
                 </div>
             </div>
          </div>
        </div>

        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className={currentTheme.accent} />
            <span className="text-sm font-bold uppercase tracking-widest">Finish Profile</span>
          </div>
          <div className="flex justify-between items-center text-center">
            <div className="flex-1 border-r border-white/10">
              <div className="text-xl sm:text-2xl font-black">{dna.finishRate}%</div>
              <div className="text-xs opacity-50 mb-1">Finish Rate</div>
              <Comparison userVal={dna.finishRate} baseVal={baselines.finishRate} suffix="%" />
            </div>
            <div className="flex-1">
              <div className="text-xl sm:text-2xl font-black">{dna.avgFightTime}m</div>
              <div className="text-xs opacity-50 mb-1">Avg Duration</div>
              <Comparison userVal={dna.avgFightTime} baseVal={baselines.avgFightTime} suffix="m" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Dual-thumb Range Slider ---
const RangeSlider = ({ min, max, step, value, onChange }) => {
  const minPct = ((value.min - min) / (max - min)) * 100;
  const maxPct = ((value.max - min) / (max - min)) * 100;
  return (
    <div className="relative h-5 flex items-center">
      <div className="absolute inset-x-0 h-1 bg-gray-700 rounded-full" />
      <div className="absolute h-1 bg-red-500 rounded-full pointer-events-none"
        style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }} />
      <input type="range" min={min} max={max} step={step} value={value.min}
        onChange={(e) => { const v = +e.target.value; onChange({ ...value, min: Math.min(v, value.max) }); }}
        className="range-thumb"
        style={{ zIndex: value.min >= max ? 5 : 3 }}
      />
      <input type="range" min={min} max={max} step={step} value={value.max}
        onChange={(e) => { const v = +e.target.value; onChange({ ...value, max: Math.max(v, value.min) }); }}
        className="range-thumb"
        style={{ zIndex: 4 }}
      />
    </div>
  );
};

// Match an ESPN competition object to a fight.bout string by fuzzy last-name comparison.
// Eliminates the need for espn_competition_id to be pre-populated by the scraper.
function normPollName(n) {
  return (n || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
function boutMatchesComp(bout, comp) {
  const parts = (bout || '').split(/ vs /i);
  if (parts.length < 2) return false;
  const f1 = normPollName(parts[0]);
  const f2 = normPollName(parts[1]);
  const compNames = (comp.competitors || []).map(c => normPollName(c.athlete?.displayName || ''));
  const lastOf = n => n.split(' ').pop();
  const hits = (boutName, espnName) =>
    boutName === espnName || (lastOf(boutName) === lastOf(espnName) && lastOf(boutName).length > 3);
  return compNames.some(n => hits(f1, n)) && compNames.some(n => hits(f2, n));
}

// --- FightCard Component (Favorites First) ---
const FightCard = ({ fight, currentTheme, handleVote, showEvent = false, locked = false, onClick = null }) => {
  const likes = fight.ratings?.likes_count || 0;
  const favorites = fight.ratings?.favorites_count || 0;
  const dislikes = fight.ratings?.dislikes_count || 0;
  
  // Visual logic
  const isFav = fight.userVote === 'favorite';
  const isLike = fight.userVote === 'like';
  const isDislike = fight.userVote === 'dislike';

  const fighters = fight.bout ? fight.bout.split(/ vs /i) : ["Unknown", "Fighter"];

  return (
    <div
      className={`${currentTheme.card} ${currentTheme.rounded} overflow-hidden mb-6 shadow-sm transition-all relative group${onClick ? ' cursor-pointer hover:scale-[1.01]' : ''}`}
      onClick={onClick ? () => onClick(fight) : undefined}
    >
      
      <div className="p-4 bg-black/20 text-center relative">
        {/* Status badge */}
        {(() => {
          const isLiveFight = fight.fight_started_at && !fight.fight_ended_at;
          // ESPN poll sets fight_ended_at before scraper updates status to 'completed'
          const isCompleted = fight.status === 'completed' || !!fight.fight_ended_at;
          const isUpcomingFight = fight.status === 'upcoming' && !fight.fight_started_at;
          if (isLiveFight) return (
            <div className="flex justify-center mb-2">
              <span className="flex items-center gap-1.5 bg-red-600/20 text-red-400 text-[10px] px-2.5 py-1 border border-red-500/40 uppercase tracking-widest font-bold">
                <span className="w-1.5 h-1.5 bg-red-500 animate-pulse" />
                Live
              </span>
            </div>
          );
          if (isCompleted) return (
            <div className="flex justify-center mb-2">
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 border border-white/10 text-white/30 uppercase tracking-widest font-bold">
                ✓ Final
              </span>
            </div>
          );
          if (isUpcomingFight) return (
            <div className="flex justify-center mb-2">
              <span className="text-[10px] px-2 py-0.5 border border-[#D4AF37]/30 text-[#D4AF37]/60 uppercase tracking-widest font-bold">
                Upcoming
              </span>
            </div>
          );
          return null;
        })()}
        <h2 className="text-base sm:text-xl font-bold uppercase tracking-wide text-white">
          {fighters[0]} <span className="text-[#D4AF37]">VS</span> {fighters[1]}
        </h2>
        <p className={`text-xs uppercase tracking-widest mt-1 ${currentTheme.secondaryText}`}>
          {showEvent ? (
            <span>{fight.event_name} {fight.event_date ? `• ${fight.event_date}` : ''}</span>
          ) : (
            fight.weight_class || 'MAIN CARD'
          )}
        </p>
        {onClick && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-25 group-hover:opacity-60">
            <span className="text-[9px] uppercase tracking-widest font-bold hidden sm:block">Details</span>
            <ChevronRight size={14} />
          </div>
        )}
      </div>

      <div className="p-6">
        {/* BUTTONS ROW (Fav -> Like -> Dislike) */}
        <div className="flex gap-2">
          
          {/* 1. FAVORITE */}
          <button 
            disabled={locked}
            onClick={(e) => { e.stopPropagation(); handleVote(fight.id, 'favorite'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 ${currentTheme.rounded} transition-all border border-transparent
                ${locked ? 'opacity-40 cursor-not-allowed bg-gray-800' :
                  (isFav ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-white/5 hover:bg-yellow-500/20 hover:text-yellow-400')}`}
          >
             <Star size={18} className={isFav ? 'fill-current' : ''} />
             <span className="text-sm font-bold">{favorites}</span>
          </button>

          {/* 2. LIKE */}
          <button
            disabled={locked}
            onClick={(e) => { e.stopPropagation(); handleVote(fight.id, 'like'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 ${currentTheme.rounded} transition-all border border-transparent
                ${locked ? 'opacity-40 cursor-not-allowed bg-gray-800' :
                  (isLike ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10')}`}
          >
             <ThumbsUp size={18} className={isLike ? 'fill-current' : ''} />
             <span className="text-sm font-bold">{likes}</span>
          </button>

          {/* 3. DISLIKE */}
          <button
            disabled={locked}
            onClick={(e) => { e.stopPropagation(); handleVote(fight.id, 'dislike'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 ${currentTheme.rounded} transition-all border border-transparent
                ${locked ? 'opacity-40 cursor-not-allowed bg-gray-800' :
                  (isDislike ? 'bg-red-900/50 border-red-600 text-red-500' : 'bg-white/5 hover:bg-white/10')}`}
          >
             <ThumbsDown size={18} className={isDislike ? 'fill-current' : ''} />
             <span className="text-sm font-bold">{dislikes}</span>
          </button>

        </div>
        
        {locked && (
            <div className="text-center text-xs opacity-40 mt-2 uppercase tracking-widest">
                Voting opens at event start
            </div>
        )}
      </div>
    </div>
  );
};


// --- Main App Component ---
export default function UFCFightRating() {
  const [session, setSession] = useState(null);
  const [isGuest, setIsGuest] = useState(guestStorage.isGuest());
  const [currentView, setCurrentView] = useState('events');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [availableYears, setAvailableYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [events, setEvents] = useState([]);
  const [eventFights, setEventFights] = useState([]);
  const [loadingFights, setLoadingFights] = useState(false);
  const [selectedFight, setSelectedFight] = useState(null);
  const [previousView, setPreviousView] = useState('events');
  const [selectedJudge, setSelectedJudge] = useState(null);
  const [comparedJudge, setComparedJudge] = useState(null);
  const [userHistory, setUserHistory] = useState([]);
  const [combatDNA, setCombatDNA] = useState(null);
  const [dnaFilter, setDnaFilter] = useState('combined'); 

  // --- FILTER STATE ---
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    duration:  { min: 0,   max: 25  },
    pace:      { min: 0,   max: 60  },
    violence:  { min: 0.0, max: 2.0 },
    control:   { min: 0,   max: 100 },
    grappling: { min: 0.0, max: 20.0 },
  });
  const [displayLimit, setDisplayLimit] = useState(10); 

  const [comparisonData, setComparisonData] = useState([]);
  const [baselines, setBaselines] = useState({
    strikePace: 30.5, intensityScore: 4.03, violenceIndex: 0.15, engagementStyle: 45, finishRate: 48, avgFightTime: 10.5
  });

  const [recommendations, setRecommendations] = useState([]);
  const [activeProfileTab, setActiveProfileTab] = useState('favorite');
  const [dnaTab, setDnaTab] = useState('combat');
  const [judgingProfile, setJudgingProfile] = useState(null);
  const [scoredFights, setScoredFights] = useState(null);
  const savedScrollRef = useRef(0);
  const prevViewRef = useRef(null);
  const eventFightsRef = useRef([]);
  const [loading, setLoading] = useState(true);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const currentTheme = {
    bg: 'bg-[#0A0A0A]',
    card: 'bg-[#141414] border-l-4 border-[#D4AF37]',
    primary: 'bg-[#D4AF37]',
    text: 'text-white',
    accent: 'text-[#D4AF37]',
    font: 'font-oswald',
    rounded: 'rounded-none',
    headerBg: 'bg-black border-b-2 border-[#D4AF37]',
    statColor: 'text-[#D4AF37]',
    secondaryText: 'text-white/50',
    inputBg: 'bg-[#141414] border border-white/10 text-white placeholder-white/30',
    tabBg: 'bg-white/10',
    tabActive: 'bg-[#D4AF37] text-black',
    badge: 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30',
    borderAccent: 'border-[#D4AF37]',
  };

  // --- HELPER: Reset Filters to DNA Defaults ---
  const DEFAULT_FILTERS = {
    duration:  { min: 0,   max: 25  },
    pace:      { min: 0,   max: 60  },
    violence:  { min: 0.0, max: 2.0 },
    control:   { min: 0,   max: 100 },
    grappling: { min: 0.0, max: 20.0 },
  };

  const resetFiltersToDNA = () => {
    if (comparisonData && comparisonData.length >= 2) {
      // Q1 = 25th percentile, Q3 = 75th percentile of user's rated fights
      const pct = (arr, p) => {
        const sorted = arr.filter(v => v != null).sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * p)] ?? 0;
      };
      setFilters({
        duration:  { min: Math.floor(pct(comparisonData.map(d => d.duration), 0.25)),  max: Math.ceil(pct(comparisonData.map(d => d.duration), 0.75))   },
        pace:      { min: Math.floor(pct(comparisonData.map(d => d.pace),     0.25)),  max: Math.ceil(pct(comparisonData.map(d => d.pace),     0.75))   },
        violence:  { min: parseFloat(pct(comparisonData.map(d => d.violence), 0.25).toFixed(1)), max: parseFloat(pct(comparisonData.map(d => d.violence), 0.75).toFixed(1)) },
        control:   { min: Math.floor(pct(comparisonData.map(d => d.control),  0.25)),  max: Math.ceil(pct(comparisonData.map(d => d.control),  0.75))   },
        grappling: { min: parseFloat(pct(comparisonData.map(d => d.intensity),0.25).toFixed(1)), max: parseFloat(pct(comparisonData.map(d => d.intensity),0.75).toFixed(1)) },
      });
    }
  };

  // Scroll to top when entering fightDetail; restore position when leaving
  useEffect(() => {
    if (currentView === 'fightDetail') {
      window.scrollTo(0, 0);
    } else if (prevViewRef.current === 'fightDetail') {
      window.scrollTo(0, savedScrollRef.current);
    }
    prevViewRef.current = currentView;
  }, [currentView]);

  // Fetch judging profile once when user opens the DNA view (skip for guests)
  useEffect(() => {
    if (currentView !== 'dna' || judgingProfile || isGuest) return;
    dataService.getUserJudgingProfile().then(setJudgingProfile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, isGuest]);

  // Fetch scored fights list once when user opens the DNA view (skip for guests)
  useEffect(() => {
    if (currentView !== 'dna' || scoredFights !== null || isGuest) return;
    dataService.getScoredFights().then(data => setScoredFights(data || []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, isGuest]);

  // Keep ref in sync so the ESPN poll can read latest eventFights without re-triggering the effect
  useEffect(() => { eventFightsRef.current = eventFights; }, [eventFights]);

  // Poll ESPN for all upcoming fights when viewing today's event fight list.
  // One request per 60s covers the whole card — no need to be in a specific fight detail.
  useEffect(() => {
    if (currentView !== 'fights' || !selectedEvent) return;
    // Use local date — UFC events run Saturday US time which is already Sunday UTC
    const d = new Date();
    const today = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    if (selectedEvent.event_date !== today) return;

    const EDGE_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/record-fight-status`;
    const dateParam = today.replace(/-/g, '');
    const prevStatuses = {};
    let stopped = false;

    const callEdgeFn = async (fightId, status) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await fetch(EDGE_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY },
          body: JSON.stringify({ fight_id: fightId, status }),
        });
      } catch (e) {
        console.warn('[EventPoll] Edge Function call failed:', e);
      }
    };

    const poll = async () => {
      if (stopped) return;
      // No espn_competition_id required — name matching is the fallback
      const liveFights = eventFightsRef.current.filter(
        f => f.status === 'upcoming' && !f.fight_ended_at
      );
      if (liveFights.length === 0) return; // all done for now, keep interval alive
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${dateParam}`);
        const json = await res.json();
        for (const ev of json.events || []) {
          if (!ev.name?.toUpperCase().includes('UFC')) continue;
          for (const fight of liveFights) {
            // Match by competition ID if already known, else fall back to fighter name matching
            const comp = fight.espn_competition_id
              ? (ev.competitions || []).find(c => String(c.id) === String(fight.espn_competition_id))
              : (ev.competitions || []).find(c => boutMatchesComp(fight.bout, c));
            if (!comp) continue;
            // Cache the ESPN ID so future polls skip name matching
            if (!fight.espn_competition_id) {
              setEventFights(prev => prev.map(f => f.id === fight.id ? { ...f, espn_competition_id: String(comp.id) } : f));
            }
            const statusName = comp.status?.type?.name;
            if (statusName === prevStatuses[fight.id]) continue;
            prevStatuses[fight.id] = statusName;
            // STATUS_IN_PROGRESS_2/3/4/5 = round N in progress; STATUS_END_OF_ROUND = between rounds
            const isLiveStatus = statusName?.startsWith('STATUS_IN_PROGRESS') || statusName === 'STATUS_END_OF_ROUND';
            if (isLiveStatus && !fight.fight_started_at) {
              const now = new Date().toISOString();
              setEventFights(prev => prev.map(f => f.id === fight.id ? { ...f, fight_started_at: now } : f));
              await callEdgeFn(fight.id, 'in_progress');
            } else if (statusName === 'STATUS_FINAL' && !fight.fight_ended_at) {
              const now = new Date().toISOString();
              setEventFights(prev => prev.map(f => f.id === fight.id
                ? { ...f, fight_started_at: f.fight_started_at || now, fight_ended_at: now }
                : f
              ));
              await callEdgeFn(fight.id, 'final');
            }
          }
        }
      } catch (e) {
        console.warn('[EventPoll] ESPN fetch failed:', e);
      }
    };

    // Delay first poll so eventFights has time to load from Supabase before we check
    const t = setTimeout(poll, 3000);
    const intervalId = setInterval(poll, 60000);
    return () => { stopped = true; clearTimeout(t); clearInterval(intervalId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, selectedEvent?.event_name]);


  // --- INITIAL LOAD ONLY ---
  // Filters will now ONLY reset if you click the button or refresh the page.

  useEffect(() => {
    const init = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      await fetchYears();
      const realStats = await dataService.getGlobalBaselines();
      if (realStats) setBaselines(prev => ({...prev, ...realStats}));
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  const fetchYears = async () => {
    const { data } = await supabase.from('ufc_events').select('event_date');
    if (data) {
      const years = [...new Set(data.map(e => e.event_date.split('-')[0]))].sort((a, b) => b - a);
      setAvailableYears(years);
      if (years.length > 0) setSelectedYear(years[0]);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedYear === 'For You' && (session || isGuest)) {
        setFetchingEvents(true);
        const loadForYou = async () => {
              const likesCount = userHistory.filter(f => f.userVote === 'like' || f.userVote === 'favorite').length;
              let fights = [];
              if (!isGuest && likesCount >= 5 && combatDNA) {
                  fights = await dataService.getRecommendations(session.user.id, combatDNA) || [];
              } else {
                  const favs = await dataService.getCommunityFavorites();
                  fights = favs.map(f => ({ ...f, userVote: userHistory.find(v => v.id === f.id)?.userVote }));
              }
              if (fights.length > 0) {
                  const uniqueEvts = [...new Set(fights.map(f => f.event_name).filter(Boolean))];
                  const { data: evtData } = await supabase.from('ufc_events').select('event_name, event_date').in('event_name', uniqueEvts);
                  fights = fights.map(f => ({ ...f, event_date: evtData?.find(e => e.event_name === f.event_name)?.event_date || null }));
              }
              setRecommendations(fights);
              setFetchingEvents(false);
        };
        loadForYou();
    }
  }, [selectedYear, combatDNA, userHistory, session, isGuest]);

  useEffect(() => {
    if (!selectedYear || selectedYear === 'For You' || searchQuery) return;
    const fetchEventsByYear = async () => {
      setFetchingEvents(true);
      const { data } = await supabase.from('ufc_events').select('*').gte('event_date', `${selectedYear}-01-01`).lte('event_date', `${selectedYear}-12-31`).order('event_date', { ascending: false });
      setEvents(data || []);
      setFetchingEvents(false);
    };
    fetchEventsByYear();
  }, [selectedYear, searchQuery]);

  // --- UPDATED SEARCH LOGIC (With Array Fix) ---
  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (!searchQuery && !showFilters) { setSearchResults([]); return; }
      
      setFetchingEvents(true);
      const query = searchQuery.trim().toLowerCase();
      let filterIds = null;

      if (showFilters) {
          let statsQuery = supabase.from('fight_dna_metrics').select('fight_id');

          statsQuery = statsQuery.gte('metric_duration', filters.duration.min).lte('metric_duration', filters.duration.max);
          statsQuery = statsQuery.gte('metric_pace',     filters.pace.min    ).lte('metric_pace',     filters.pace.max    );
          statsQuery = statsQuery.gte('metric_violence', filters.violence.min ).lte('metric_violence', filters.violence.max );
          statsQuery = statsQuery.gte('metric_control',  filters.control.min  ).lte('metric_control',  filters.control.max  );
          statsQuery = statsQuery.gte('metric_intensity',filters.grappling.min).lte('metric_intensity',filters.grappling.max);

          const { data: metricResults, error: metricError } = await statsQuery;
          
          if (metricError) {
              console.error("Filter Error", metricError);
              setFetchingEvents(false);
              return;
          }

          if (!metricResults || metricResults.length === 0) {
              setSearchResults([]);
              setFetchingEvents(false);
              return;
          }
          filterIds = metricResults.map(m => m.fight_id);
      }

      let supabaseQuery = supabase
        .from('fights')
        .select(`*, fight_ratings (likes_count, dislikes_count, favorites_count)`)
        .limit(400); 

      if (query) {
        supabaseQuery = supabaseQuery.or(`bout.ilike.%${query}%,event_name.ilike.%${query}%`);
      }

      if (filterIds !== null) {
          supabaseQuery = supabaseQuery.in('id', filterIds);
      }

      const { data: fightMatches, error } = await supabaseQuery;
      
      if (error) { 
          console.error("Search Error", error); 
          setFetchingEvents(false); 
          return; 
      }

      if (fightMatches && fightMatches.length > 0) {
         let userVotes = [];
         if (session) {
           const { data } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', session.user.id);
           userVotes = data || [];
         }
         const guestVotes = isGuest ? guestStorage.getVotes() : {};
         const uniqueEvents = [...new Set(fightMatches.map(f => f.event_name))];
         const { data: eventData } = await supabase.from('ufc_events').select('event_name, event_date').in('event_name', uniqueEvents);

         let merged = fightMatches.map(f => ({
          ...f,
          ratings: (Array.isArray(f.fight_ratings) ? f.fight_ratings[0] : f.fight_ratings) || { likes_count: 0, dislikes_count: 0, favorites_count: 0 },
          event_date: eventData?.find(e => e.event_name === f.event_name)?.event_date || '0000-00-00',
          userVote: session
            ? userVotes?.find(v => v.fight_id === f.id)?.vote_type
            : guestVotes[String(f.id)],
        }));
        
        if (query && merged.some(f => f.bout && f.bout.toLowerCase().includes(query))) {
            merged = merged.filter(f => f.bout && f.bout.toLowerCase().includes(query));
        }
        
        merged.sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
        
        setDisplayLimit(10);
        setSearchResults(merged);

      } else { setSearchResults([]); }
      setFetchingEvents(false);
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery, session, isGuest, filters, showFilters]);

  const handleEventClick = async (event) => {
    setSelectedEvent(event);
    setCurrentView('fights');
    setEventFights([]);
    setLoadingFights(true);
    const { data: bouts } = await supabase.from('fights').select(`*, fight_ratings (likes_count, dislikes_count, favorites_count)`).eq('event_name', event.event_name).order('id', { ascending: true });
    if (bouts) {
      let userVotes = [];
      if (session) {
        const { data } = await supabase.from('user_votes').select('*').eq('user_id', session.user.id);
        userVotes = data || [];
      }
      const guestVotes = isGuest ? guestStorage.getVotes() : {};
      const merged = bouts.map(f => ({
        ...f,
        event_date: event.event_date,
        ratings: (Array.isArray(f.fight_ratings) ? f.fight_ratings[0] : f.fight_ratings) || { likes_count: 0, dislikes_count: 0, favorites_count: 0 },
        userVote: session
          ? userVotes.find(v => v.fight_id === f.id)?.vote_type
          : guestVotes[String(f.id)],
      }));
      setEventFights(merged);
    }
    setLoadingFights(false);
  };

  const handleFightClick = (fight) => {
    savedScrollRef.current = window.scrollY;
    setPreviousView(currentView);
    setSelectedFight({ ...fight, event_date: fight.event_date ?? selectedEvent?.event_date });
    setCurrentView('fightDetail');
  };

  // --- VOTING LOGIC ---
  const handleVote = async (fightId, clickedType) => {
    let targetList;

    if (currentView === 'profile') {
        targetList = userHistory;
    } else if (selectedYear === 'For You' && !searchQuery) {
        targetList = recommendations; 
    } else if (searchQuery || showFilters) { 
        targetList = searchResults; 
    } else {
        targetList = eventFights;
    }

    const fight = targetList.find(f => f.id === fightId);
    if (!fight) return;
    
    const oldVote = fight.userVote;
    const finalVote = oldVote === clickedType ? null : clickedType; 

    const updateList = (list) => list.map(f => {
      if (f.id === fightId) {
        let { likes_count, dislikes_count, favorites_count } = f.ratings || { likes_count: 0, dislikes_count: 0, favorites_count: 0 };
        
        if (oldVote === 'like') likes_count = Math.max(0, likes_count - 1);
        if (oldVote === 'dislike') dislikes_count = Math.max(0, dislikes_count - 1);
        if (oldVote === 'favorite') favorites_count = Math.max(0, favorites_count - 1);
        
        if (finalVote === 'like') likes_count++;
        if (finalVote === 'dislike') dislikes_count++;
        if (finalVote === 'favorite') favorites_count++;
        
        return { ...f, userVote: finalVote, ratings: { likes_count, dislikes_count, favorites_count } };
      }
      return f;
    });

    if (searchQuery || showFilters) setSearchResults(updateList(searchResults));
    if (eventFights.length > 0) setEventFights(updateList(eventFights));
    if (selectedYear === 'For You') setRecommendations(prev => prev.filter(f => f.id !== fightId));
    
    let newUserHistory = updateList(userHistory);
    
    const existsInHistory = userHistory.some(f => f.id === fightId);
    if (!existsInHistory && finalVote !== null) {
        const newHistoryItem = { 
            ...fight, 
            userVote: finalVote,
            ratings: {
                likes_count: (fight.ratings?.likes_count || 0) + (finalVote === 'like' ? 1 : 0),
                dislikes_count: (fight.ratings?.dislikes_count || 0) + (finalVote === 'dislike' ? 1 : 0),
                favorites_count: (fight.ratings?.favorites_count || 0) + (finalVote === 'favorite' ? 1 : 0),
            }
        };
        newUserHistory = [newHistoryItem, ...newUserHistory];
    } else if (existsInHistory && finalVote === null) {
        newUserHistory = newUserHistory.filter(f => f.id !== fightId);
    }
    
    setUserHistory(newUserHistory);
    updateDnaAndCharts(newUserHistory, dnaFilter);

    if (isGuest) { guestStorage.setVote(fightId, finalVote); return; }

    try {
      if (oldVote && oldVote !== finalVote) await dataService.castVote(fightId, null);
      if (finalVote) await dataService.castVote(fightId, finalVote);
    } catch (err) { console.error(err); }
  };

  const updateDnaAndCharts = async (historyList, filterType) => {
      let filteredFights = [];
      if (filterType === 'favorites') filteredFights = historyList.filter(f => f.userVote === 'favorite');
      else if (filterType === 'likes') filteredFights = historyList.filter(f => f.userVote === 'like');
      else filteredFights = historyList.filter(f => f.userVote === 'like' || f.userVote === 'favorite');

      if (filteredFights.length > 0) {
          const { dna, chartData } = await dataService.getDNAAndChartData(filteredFights);
          setCombatDNA(dna);
          setComparisonData(chartData);
      } else {
          setCombatDNA(null);
          setComparisonData([]);
      }
  };

  useEffect(() => {
     if(userHistory.length > 0) updateDnaAndCharts(userHistory, dnaFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dnaFilter]);

  // Warn guests before closing/navigating away if they have unsaved activity.
  // Note: browsers enforce their own generic message — custom text is ignored.
  useEffect(() => {
    if (!isGuest) return;
    const hasActivity = userHistory.length > 0 ||
      Object.keys(guestStorage.getVotes()).length > 0 ||
      sessionStorage.getItem('ufc_guest_scores') !== null;
    if (!hasActivity) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isGuest, userHistory]);

  const handleSignOut = async () => { await supabase.auth.signOut(); setSession(null); setCurrentView('events'); };
  const handleGuestSignUp = () => {
    guestStorage.setGuest(false);
    setIsGuest(false);
    setUserHistory([]);
    setCombatDNA(null);
    setComparisonData([]);
  };

  const fetchUserHistory = async () => {
    if (isGuest) {
      const votes = guestStorage.getVotes();
      const fightIds = Object.keys(votes).map(Number).filter(Boolean);
      if (fightIds.length === 0) { setUserHistory([]); return; }
      const { data: historyFights } = await supabase
        .from('fights').select(`*, fight_ratings (likes_count, dislikes_count, favorites_count)`)
        .in('id', fightIds);
      if (!historyFights) { setUserHistory([]); return; }
      const uniqueEvents = [...new Set(historyFights.map(f => f.event_name))];
      const { data: eventData } = await supabase.from('ufc_events')
        .select('event_name, event_date').in('event_name', uniqueEvents);
      const merged = historyFights.map(f => ({
        ...f,
        ratings: (Array.isArray(f.fight_ratings) ? f.fight_ratings[0] : f.fight_ratings)
                 || { likes_count: 0, dislikes_count: 0, favorites_count: 0 },
        userVote: votes[String(f.id)],
        event_date: eventData?.find(e => e.event_name === f.event_name)?.event_date || null,
      }));
      setUserHistory(merged);
      updateDnaAndCharts(merged, dnaFilter);
      return;
    }
    if (!session?.user?.id) return;
    const { data: votes } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', session.user.id);
    if (!votes || votes.length === 0) { setUserHistory([]); return; }

    const { data: historyFights } = await supabase.from('fights').select(`*, fight_ratings (likes_count, dislikes_count, favorites_count)`).in('id', votes.map(v => v.fight_id));
    if (!historyFights) { setUserHistory([]); return; }

    const uniqueEvents = [...new Set(historyFights.map(f => f.event_name))];
    const { data: eventData } = await supabase.from('ufc_events').select('event_name, event_date').in('event_name', uniqueEvents);

    const merged = historyFights.map(f => ({
        ...f,
        ratings: (Array.isArray(f.fight_ratings) ? f.fight_ratings[0] : f.fight_ratings) || { likes_count: 0, dislikes_count: 0, favorites_count: 0 },
        userVote: votes.find(v => v.fight_id === f.id)?.vote_type,
        event_date: eventData?.find(e => e.event_name === f.event_name)?.event_date || null,
    }));
    setUserHistory(merged);
    updateDnaAndCharts(merged, dnaFilter);
  };

  useEffect(() => {
    fetchUserHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isGuest]);
  
  const isUpcoming = (dateString) => {
    if (!dateString) return false;
    const eventDate = new Date(dateString);
    const today = new Date();
    today.setHours(0,0,0,0);
    return eventDate >= today;
  };

  const isVotingLocked = (event) => {
    if (!event) return false;
    if (!event.start_time) return isUpcoming(event.event_date);
    const now = new Date();
    const startTime = new Date(event.start_time);
    return now < startTime;
  };

  if (!session && !isGuest) return (
    <LoginPage onGuestContinue={() => { guestStorage.setGuest(true); setIsGuest(true); }} />
  );
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin opacity-50" /></div>;

  return (
    <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} ${currentTheme.font} pb-20 transition-all duration-500`}>
      <header className={`sticky top-0 z-40 ${currentTheme.headerBg}`}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1
            className="text-2xl md:text-3xl font-bold uppercase tracking-widest cursor-pointer text-[#D4AF37]"
            onClick={() => { setCurrentView('events'); setSearchQuery(''); setShowFilters(false); }}
          >
            MMA DNA
          </h1>
          <div className="flex gap-2">
            <button
              onClick={() => { setCurrentView('dna'); setSearchQuery(''); setShowFilters(false); }}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all ${['dna','userJudgeComparison'].includes(currentView) ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'border-white/20 text-white/60 hover:border-[#D4AF37]/60 hover:text-[#D4AF37]'}`}
            >
              DNA
            </button>
            <button
              onClick={() => { setCurrentView('judges'); setSearchQuery(''); setShowFilters(false); }}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all ${['judges','judgeProfile','judgeComparison'].includes(currentView) ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'border-white/20 text-white/60 hover:border-[#D4AF37]/60 hover:text-[#D4AF37]'}`}
            >
              Judges
            </button>
            <button
              onClick={() => { setCurrentView('profile'); setSearchQuery(''); setShowFilters(false); }}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all ${currentView === 'profile' ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'border-white/20 text-white/60 hover:border-[#D4AF37]/60 hover:text-[#D4AF37]'}`}
            >
              <User size={14} />
            </button>
          </div>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 pt-6">

        {isGuest && (
          <div className={`bg-yellow-500/10 border border-yellow-500/30 ${currentTheme.rounded} p-3 mb-4 flex items-center justify-between`}>
            <span className="text-yellow-400 text-xs">Guest mode — votes &amp; scores saved on this device only.</span>
            <button onClick={handleGuestSignUp} className="text-yellow-400 font-bold text-xs underline ml-2">Sign Up</button>
          </div>
        )}

        {currentView === 'events' && (
          <>
            <div className="relative mb-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" size={20} />
              <input 
                  type="text" 
                  placeholder="Search fighters or filters..." 
                  value={searchQuery} 
                  onChange={(e) => setSearchQuery(e.target.value)} 
                  className={`w-full py-4 pl-12 pr-12 ${currentTheme.rounded} ${currentTheme.inputBg} focus:outline-none focus:ring-2 focus:ring-current/20 transition-all shadow-sm`}
              />
              
              {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-12 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 p-2">
                      <X size={20} />
                  </button>
              )}

              <button 
                  onClick={() => setShowFilters(!showFilters)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all ${showFilters ? 'bg-red-600 text-white shadow-lg' : 'opacity-50 hover:opacity-100 hover:bg-white/10'}`}
              >
                  <Settings2 size={18} />
              </button>
            </div>

            {/* --- ADVANCED FILTERS PANEL --- */}
            {showFilters && (
                <div className={`p-4 ${currentTheme.rounded} mb-6 animate-in slide-in-from-top-2 ${currentTheme.card}`}>
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <Settings2 size={14} className={currentTheme.accent} />
                            <h3 className="text-xs font-bold uppercase tracking-widest opacity-70">Fight Finder</h3>
                            <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[10px] uppercase font-bold opacity-30 hover:opacity-70 transition-opacity">Reset</button>
                        </div>
                        {combatDNA && (
                            <button onClick={resetFiltersToDNA} className={`text-[10px] uppercase font-bold ${currentTheme.accent} hover:text-white transition-colors flex items-center gap-1`}>
                                <Dna size={10} /> Apply My Stats
                            </button>
                        )}
                    </div>

                    <div className="flex flex-col gap-5">
                        {/* DURATION */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Duration</span>
                                <span className="font-bold">{filters.duration.min} – {filters.duration.max} mins</span>
                            </div>
                            <RangeSlider min={0} max={25} step={1}
                                value={filters.duration}
                                onChange={(v) => setFilters({...filters, duration: v})}
                            />
                        </div>

                        {/* PACE */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Pace</span>
                                <span className="font-bold">{filters.pace.min} – {filters.pace.max} strikes/min</span>
                            </div>
                            <RangeSlider min={0} max={60} step={1}
                                value={filters.pace}
                                onChange={(v) => setFilters({...filters, pace: v})}
                            />
                        </div>

                        {/* VIOLENCE */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Violence Index</span>
                                <span className="font-bold">{filters.violence.min} – {filters.violence.max}</span>
                            </div>
                            <RangeSlider min={0} max={2} step={0.1}
                                value={filters.violence}
                                onChange={(v) => setFilters({...filters, violence: v})}
                            />
                            <div className="flex justify-between text-[10px] opacity-30 mt-1">
                                <span>Low</span><span>Bloodbath</span>
                            </div>
                        </div>

                        {/* CONTROL */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Control %</span>
                                <span className="font-bold">{filters.control.min} – {filters.control.max}%</span>
                            </div>
                            <RangeSlider min={0} max={100} step={5}
                                value={filters.control}
                                onChange={(v) => setFilters({...filters, control: v})}
                            />
                            <div className="flex justify-between text-[10px] opacity-30 mt-1">
                                <span>Standup War</span><span>Total Control</span>
                            </div>
                        </div>

                        {/* GRAPPLING / INTENSITY */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Grappling Intensity</span>
                                <span className="font-bold">{filters.grappling.min} – {filters.grappling.max}</span>
                            </div>
                            <RangeSlider min={0} max={20} step={0.5}
                                value={filters.grappling}
                                onChange={(v) => setFilters({...filters, grappling: v})}
                            />
                            <div className="flex justify-between text-[10px] opacity-30 mt-1">
                                <span>Lay & Pray</span><span>Mauler</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {(searchQuery || showFilters) && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
                <h3 className="text-sm font-bold opacity-50 mb-4 uppercase tracking-widest">
                    {fetchingEvents ? "Searching..." : `Found ${searchResults.length} Fights`}
                </h3>
                
                {searchResults.slice(0, displayLimit).map(f => (
                    <FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} showEvent={true} locked={isUpcoming(f.event_date)} onClick={handleFightClick} />
                ))}

                {!fetchingEvents && searchResults.length > displayLimit && (
                    <button 
                        onClick={() => setDisplayLimit(prev => prev + 10)}
                        className={`w-full py-4 ${currentTheme.rounded} border border-dashed border-current/20 hover:bg-current/5 hover:border-current/40 transition-all text-xs font-bold uppercase tracking-widest opacity-60 hover:opacity-100 flex items-center justify-center gap-2`}
                    >
                        Show More Results ({searchResults.length - displayLimit} remaining)
                    </button>
                )}

                {!fetchingEvents && searchResults.length === 0 && (
                    <div className="text-center py-20 opacity-40 italic">No fights match your criteria.</div>
                )}
              </div>
            )}

            {!searchQuery && !showFilters && (
              <>
                <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide items-center" style={{ maskImage: 'linear-gradient(to right, black 80%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)' }}>
                  <button 
                    onClick={() => setSelectedYear('For You')} 
                    className={`px-5 py-2 font-bold uppercase tracking-widest text-sm border transition-all flex items-center gap-2 whitespace-nowrap
                        ${selectedYear === 'For You'
                            ? 'bg-[#D4AF37] border-[#D4AF37] text-black'
                            : 'border-[#D4AF37]/30 text-[#D4AF37]/70 hover:border-[#D4AF37]/60 hover:text-[#D4AF37]'
                        }`}
                  >
                    <Sparkles size={14} />
                    For You
                  </button>

                  {availableYears.map(y => (
                    <button key={y} onClick={() => setSelectedYear(y)} className={`px-5 py-2 font-bold uppercase tracking-widest text-sm border transition-all whitespace-nowrap ${selectedYear === y ? 'bg-white text-black border-white' : 'border-white/20 text-white/50 hover:border-white/40 hover:text-white/80'}`}>{y}</button>
                  ))}
                </div>

                {selectedYear === 'For You' ? (
                      <div className="animate-in slide-in-from-right duration-500">
                          {fetchingEvents ? (
                             <p className="text-center opacity-40 py-10 italic">Curating your fight feed...</p>
                          ) : (
                             <>
                                {recommendations.length > 0 ? (
                                    <>
                                        <div className="mb-6 opacity-60 text-sm text-center italic">
                                            {userHistory.filter(f => f.userVote === 'like' || f.userVote === 'favorite').length < 5 
                                                ? "Community Favorites (Rate 5 fights to unlock DNA)" 
                                                : "Based on your Combat DNA"}
                                        </div>
                                        {recommendations.map(f => (
                                            <FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} showEvent={true} onClick={handleFightClick} />
                                        ))}
                                    </>
                                ) : (
                                    <div className="text-center py-20 opacity-40 italic">No recommendations found. Try rating more fights!</div>
                                )}
                             </>
                          )}
                      </div>
                ) : (
                    <div className="grid gap-4">
                      {fetchingEvents ? (<p className="text-center opacity-40 py-10 italic">Loading...</p>) : events.map(event => (
                        <button key={event.id} onClick={() => handleEventClick(event)} className={`${currentTheme.card} p-5 ${currentTheme.rounded} text-left hover:brightness-110 transition-all w-full`}>
                          <h3 className="text-lg font-bold uppercase tracking-wide flex items-center gap-3">
                            {event.event_name}
                            {isUpcoming(event.event_date) && (
                                <span className="text-[10px] px-2 py-0.5 border border-[#D4AF37]/40 text-[#D4AF37] uppercase tracking-widest font-bold">
                                    Upcoming
                                </span>
                            )}
                          </h3>
                          <div className={`flex flex-col gap-0.5 mt-1.5 text-xs ${currentTheme.secondaryText} uppercase tracking-wider`}>
                            <p>{event.event_date}</p>
                            {event.event_location && <p className="flex items-center gap-1"><MapPin size={10} /> {event.event_location}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                )}
              </>
            )}
          </>
        )}
        
        {/* --- 2. FIGHTS VIEW --- */}
        {currentView === 'fights' && !searchQuery && (
          <div className="animate-in fade-in">
            <button onClick={() => setCurrentView('events')} className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors"><ChevronLeft size={16} /> Events</button>
            <h2 className="text-2xl font-bold mb-1 uppercase tracking-wide border-l-4 border-[#D4AF37] pl-4">{selectedEvent?.event_name}</h2>
            <p className="text-xs text-white/40 mb-8 pl-5 uppercase tracking-widest">{selectedEvent?.event_date}{selectedEvent?.event_location ? ` · ${selectedEvent.event_location}` : ''}</p>
            
            {loadingFights ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-50">
                    <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-sm font-bold uppercase tracking-widest">Loading fights...</p>
                </div>
            ) : eventFights.length === 0 ? (
                <div className="text-center py-20 opacity-40 italic">No fights found for this event.</div>
            ) : (() => {
                const eventLocked = isVotingLocked(selectedEvent);
                return eventFights.map(f => (
                    <FightCard
                        key={f.id}
                        fight={f}
                        currentTheme={currentTheme}
                        handleVote={handleVote}
                        locked={eventLocked}
                        onClick={handleFightClick}
                    />
                ));
            })()}
          </div>
        )}

        {/* --- 3. FIGHT DETAIL VIEW --- */}
        {currentView === 'fightDetail' && selectedFight && (
          <FightDetailView
            fight={selectedFight}
            currentTheme={currentTheme}
            onBack={() => setCurrentView(previousView)}
            isGuest={isGuest}
          />
        )}

        {/* --- 4. COMBAT DNA VIEW --- */}
        {currentView === 'dna' && (
            <div className="animate-in slide-in-from-right pb-20">
               <div className="flex items-center gap-2 mb-6 opacity-60">
                   <Dna size={20} />
                   <span className="font-bold">DNA ANALYSIS</span>
               </div>

               {/* Top-level tab: Combat DNA / Judging DNA */}
               <div className={`flex ${currentTheme.tabBg} p-1 ${currentTheme.rounded} mb-6`}>
                 {[['combat', 'Combat DNA'], ['judging', 'Judging DNA']].map(([key, label]) => (
                   <button
                     key={key}
                     onClick={() => setDnaTab(key)}
                     className={`flex-1 py-2.5 ${currentTheme.rounded} text-xs font-bold uppercase tracking-wider transition-all
                       ${dnaTab === key ? currentTheme.tabActive : 'opacity-50 hover:opacity-80'}`}
                   >
                     {label}
                   </button>
                 ))}
               </div>

               {dnaTab === 'combat' && (
                 <>
                   <div className="flex justify-center mb-6">
                     <div className={`${currentTheme.tabBg} p-1 ${currentTheme.rounded} flex gap-1`}>
                       {['combined', 'likes', 'favorites'].map((type) => (
                         <button
                           key={type}
                           onClick={() => setDnaFilter(type)}
                           className={`px-3 sm:px-4 py-2 ${currentTheme.rounded} text-xs font-bold uppercase tracking-wider transition-all
                             ${dnaFilter === type
                               ? (type === 'favorites' ? 'bg-yellow-500 text-black' : currentTheme.tabActive)
                               : 'opacity-50 hover:opacity-80'}`}
                         >
                           {type === 'combined' ? 'All Data' : type}
                         </button>
                       ))}
                     </div>
                   </div>
                   <CombatDNACard dna={combatDNA} currentTheme={currentTheme} baselines={baselines} />
                   {comparisonData.length > 0 && <CombatScatterPlot data={comparisonData} baselines={baselines} currentTheme={currentTheme} />}
                   <CombatDNAVisual dna={combatDNA} currentTheme={currentTheme} />
                 </>
               )}

               {dnaTab === 'judging' && (
                 <JudgingDNACard
                   profile={judgingProfile}
                   currentTheme={currentTheme}
                   scoredFights={scoredFights}
                   onFightClick={handleFightClick}
                   onCompareWithJudge={(name) => { setSelectedJudge(name); setCurrentView('userJudgeComparison'); }}
                 />
               )}
            </div>
        )}

        {/* --- 4. JUDGES DIRECTORY / PROFILE --- */}
        {currentView === 'judges' && (
          <div className="pb-20">
            <JudgeDirectory
              currentTheme={currentTheme}
              onSelectJudge={(name) => { setSelectedJudge(name); setCurrentView('judgeProfile'); }}
            />
          </div>
        )}
        {currentView === 'judgeProfile' && selectedJudge && (
          <JudgeProfileView
            judgeName={selectedJudge}
            currentTheme={currentTheme}
            onBack={() => setCurrentView('judges')}
            onCompare={() => { setComparedJudge(null); setCurrentView('judgeComparison'); }}
          />
        )}
        {currentView === 'judgeComparison' && selectedJudge && (
          <JudgeComparison
            judge1Name={selectedJudge}
            currentTheme={currentTheme}
            onBack={() => setCurrentView('judgeProfile')}
            onViewProfile={(name) => { setSelectedJudge(name); setCurrentView('judgeProfile'); }}
          />
        )}

        {currentView === 'userJudgeComparison' && (
          <UserJudgeComparison
            currentTheme={currentTheme}
            onBack={() => setCurrentView('dna')}
            onViewJudge={(name) => { setSelectedJudge(name); setCurrentView('judgeProfile'); }}
            onFightClick={handleFightClick}
            userProfile={judgingProfile}
            initialJudge={selectedJudge}
          />
        )}

        {/* --- 5. PROFILE PAGE (Reordered) --- */}
        {currentView === 'profile' && (
          <div className="animate-in slide-in-from-right pb-20">
            <div className="flex items-center gap-2 mb-6 opacity-60">
                 <User size={20} />
                 <span className="font-bold">VOTING HISTORY</span>
             </div>

            <div className={`flex ${currentTheme.tabBg} p-1 ${currentTheme.rounded} mb-8`}>
              {['favorite', 'like', 'dislike'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveProfileTab(tab)}
                  className={`flex-1 py-3 ${currentTheme.rounded} font-bold text-xs sm:text-sm uppercase transition-all
                    ${activeProfileTab === tab
                        ? (tab === 'like' ? 'bg-blue-600 text-white' : tab === 'favorite' ? 'bg-yellow-500 text-black' : 'bg-red-600 text-white')
                        : 'opacity-40'}`}
                >
                  {tab === 'favorite' ? <Star size={10} className="inline mr-1 mb-1"/> : null}
                  {tab}s ({userHistory.filter(f => f.userVote === tab).length})
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {userHistory.filter(f => f.userVote === activeProfileTab).length === 0 ? (
                <div className="text-center py-20 opacity-40 italic">No {activeProfileTab}s yet.</div>
              ) : userHistory.filter(f => f.userVote === activeProfileTab).map(f => (
                <FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} showEvent={true} onClick={handleFightClick} />
              ))}
            </div>
            {isGuest ? (
              <button onClick={handleGuestSignUp} className="w-full mt-12 py-4 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded-xl font-bold hover:bg-yellow-500 hover:text-black transition-all">SIGN UP / LOG IN</button>
            ) : (
              <button onClick={handleSignOut} className="w-full mt-12 py-4 bg-red-600/10 text-red-500 border border-red-500/30 rounded-xl font-bold hover:bg-red-600 hover:text-white transition-all">SIGN OUT</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}