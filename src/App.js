import React, { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, Star, ChevronLeft, User, Palette, MapPin, Search, X, Activity, Swords, Zap, Dna, Sparkles, Settings2 } from 'lucide-react';
import { supabase } from './supabaseClient';
import { dataService } from './dataService';
import LoginPage from './Login';
import CombatDNAVisual from './CombatDNAVisual';
import CombatScatterPlot from './components/CombatScatterPlot';

// --- CombatDNA Card (The 5 Metrics + Intensity) ---
const CombatDNACard = ({ dna, currentTheme }) => {
  const [baselines, setBaselines] = useState({
    strikePace: 30.5,        
    grapplingIntensity: 5.5, 
    violenceIndex: 0.15,     
    engagementStyle: 45,     
    finishRate: 48,          
    avgFightTime: 10.5,
    intensityScore: 4.03     
  });

  useEffect(() => {
    const loadBaselines = async () => {
      const realStats = await dataService.getGlobalBaselines();
      if (realStats) setBaselines(prev => ({...prev, ...realStats}));
    };
    loadBaselines();
  }, []);

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
    <div className={`${currentTheme.card} p-6 rounded-2xl border mb-8 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-700`}>
      <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
        <Activity className={currentTheme.accent} size={24} />
        <div>
          <h2 className="text-xl font-black uppercase tracking-wider">Your Combat DNA</h2>
          <p className="text-xs opacity-50">Based on bout totals and compared with UFC averages</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-center">
          <p className="text-xs opacity-50 uppercase tracking-widest mb-1">Strike Pace</p>
          <div className="text-3xl font-black mb-1">{dna.strikePace}</div>
          <p className="text-xs opacity-50 mb-2">combined strikes / min</p>
          <div className="bg-black/20 py-1 px-2 rounded-lg inline-block">
            <Comparison userVal={dna.strikePace} baseVal={baselines.strikePace} />
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-center">
          <p className="text-xs opacity-50 uppercase tracking-widest mb-1">Violence Index</p>
          <div className="text-3xl font-black mb-1">{dna.violenceIndex}</div>
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
              <div className="text-2xl font-black">{dna.finishRate}%</div>
              <div className="text-xs opacity-50 mb-1">Finish Rate</div>
              <Comparison userVal={dna.finishRate} baseVal={baselines.finishRate} suffix="%" />
            </div>
            <div className="flex-1">
              <div className="text-2xl font-black">{dna.avgFightTime}m</div>
              <div className="text-xs opacity-50 mb-1">Avg Duration</div>
              <Comparison userVal={dna.avgFightTime} baseVal={baselines.avgFightTime} suffix="m" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- FightCard Component (Favorites First) ---
const FightCard = ({ fight, currentTheme, handleVote, showEvent = false, locked = false }) => {
  const likes = fight.ratings?.likes_count || 0;
  const favorites = fight.ratings?.favorites_count || 0;
  const dislikes = fight.ratings?.dislikes_count || 0;
  
  // Visual logic
  const isFav = fight.userVote === 'favorite';
  const isLike = fight.userVote === 'like';
  const isDislike = fight.userVote === 'dislike';

  const fighters = fight.bout ? fight.bout.split(/ vs /i) : ["Unknown", "Fighter"];

  return (
    <div className={`${currentTheme.card} rounded-xl overflow-hidden border mb-6 shadow-lg transition-all relative`}>
      
      {/* LOCKED OVERLAY */}
      {locked && (
        <div className="absolute inset-0 bg-black/5 z-10 pointer-events-none flex items-center justify-center">
        </div>
      )}

      <div className="p-4 bg-black/20 text-center">
        <h2 className={`text-xl font-bold ${currentTheme.text}`}>
          {fighters[0]} <span className={currentTheme.accent}>VS</span> {fighters[1]}
        </h2>
        <p className="text-xs opacity-50 uppercase tracking-widest mt-1">
          {showEvent ? (
            <span>{fight.event_name} {fight.event_date ? `• ${fight.event_date}` : ''}</span>
          ) : (
            fight.weight_class || 'MAIN CARD'
          )}
        </p>
      </div>

      <div className="p-6">
        {/* BUTTONS ROW (Fav -> Like -> Dislike) */}
        <div className="flex gap-2">
          
          {/* 1. FAVORITE */}
          <button 
            disabled={locked}
            onClick={() => handleVote(fight.id, 'favorite')} 
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all border border-transparent
                ${locked ? 'opacity-40 cursor-not-allowed bg-gray-800' : 
                  (isFav ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-white/5 hover:bg-yellow-500/20 hover:text-yellow-400')}`}
          >
             <Star size={18} className={isFav ? 'fill-current' : ''} />
             <span className="text-sm font-bold">{favorites}</span>
          </button>

          {/* 2. LIKE */}
          <button 
            disabled={locked}
            onClick={() => handleVote(fight.id, 'like')} 
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all border border-transparent
                ${locked ? 'opacity-40 cursor-not-allowed bg-gray-800' : 
                  (isLike ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10')}`}
          >
             <ThumbsUp size={18} className={isLike ? 'fill-current' : ''} />
             <span className="text-sm font-bold">{likes}</span>
          </button>

          {/* 3. DISLIKE */}
          <button 
            disabled={locked}
            onClick={() => handleVote(fight.id, 'dislike')} 
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all border border-transparent
                ${locked ? 'opacity-40 cursor-not-allowed bg-gray-800' : 
                  (isDislike ? 'bg-red-900/50 border-red-600 text-red-500' : 'bg-white/5 hover:bg-white/10')}`}
          >
             <ThumbsDown size={18} className={isDislike ? 'fill-current' : ''} />
             <span className="text-sm font-bold">{dislikes}</span>
          </button>

        </div>
        
        {locked && (
            <div className="text-center text-xs opacity-40 mt-2 uppercase tracking-widest">
                Voting opens at start time
            </div>
        )}
      </div>
    </div>
  );
};


// --- Main App Component ---
export default function UFCFightRating() {
  const [session, setSession] = useState(null);
  const [currentView, setCurrentView] = useState('events');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [availableYears, setAvailableYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [events, setEvents] = useState([]);
  const [eventFights, setEventFights] = useState([]);
  const [userHistory, setUserHistory] = useState([]);
  const [combatDNA, setCombatDNA] = useState(null);
  const [dnaFilter, setDnaFilter] = useState('combined'); 

  // --- FILTER STATE ---
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    maxDuration: 25, 
    minPace: 0,      
    minViolence: 0,   
    maxControl: 100,   // Default 100%
    minGrappling: 0   
  });
  const [displayLimit, setDisplayLimit] = useState(10); 

  const [comparisonData, setComparisonData] = useState([]);
  const [baselines, setBaselines] = useState({
    strikePace: 30.5, intensityScore: 4.03, violenceIndex: 0.15, engagementStyle: 45, finishRate: 48, avgFightTime: 10.5
  });

  const [recommendations, setRecommendations] = useState([]); 
  const [activeProfileTab, setActiveProfileTab] = useState('favorite');
  const [theme, setTheme] = useState(() => localStorage.getItem('ufc_app_theme') || 'modern');
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const themes = {
    modern: { name: 'Modern Dark', bg: 'bg-gray-900', card: 'bg-gray-800 border-gray-700', primary: 'bg-red-600', text: 'text-white', accent: 'text-red-400' },
    neon: { name: 'Neon Cyber', bg: 'bg-black', card: 'bg-black border-cyan-500', primary: 'bg-cyan-500', text: 'text-cyan-100', accent: 'text-pink-400' },
    ocean: { name: 'Ocean Blue', bg: 'bg-blue-950', card: 'bg-blue-900 border-teal-600', primary: 'bg-teal-600', text: 'text-cyan-50', accent: 'text-teal-300' },
    crimson: { 
        name: 'Crimson', 
        bg: 'bg-red-950', card: 'bg-red-900 border-red-500', primary: 'bg-red-600', text: 'text-white', accent: 'text-red-200'           
    }
  };
  const currentTheme = themes[theme] || themes.modern;

  useEffect(() => { localStorage.setItem('ufc_app_theme', theme); }, [theme]);

  // --- HELPER: Reset Filters to DNA Defaults ---
  const resetFiltersToDNA = () => {
    if (combatDNA) {
      setFilters({
        maxDuration: Math.ceil(combatDNA.avgFightTime / 5) * 5 || 25, 
        minPace: Math.floor(combatDNA.strikePace) || 0,
        minViolence: parseFloat((combatDNA.violenceIndex * 0.8).toFixed(2)) || 0,
        maxControl: combatDNA.engagementStyle < 40 ? 40 : 100,
        minGrappling: parseFloat((combatDNA.intensityScore * 0.8).toFixed(1)) || 0
      });
    } else {
      setFilters({ maxDuration: 25, minPace: 0, minViolence: 0, maxControl: 100, minGrappling: 0 });
    }
  };

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
    if (selectedYear === 'For You' && session) {
        setFetchingEvents(true);
        const loadForYou = async () => {
              const likesCount = userHistory.filter(f => f.userVote === 'like' || f.userVote === 'favorite').length;
              if (likesCount >= 5 && combatDNA) {
                  const recs = await dataService.getRecommendations(session.user.id, combatDNA);
                  if (recs) setRecommendations(recs);
              } else {
                  const favs = await dataService.getCommunityFavorites();
                  const favsWithVotes = favs.map(f => ({
                      ...f,
                      userVote: userHistory.find(v => v.id === f.id)?.userVote
                  }));
                  setRecommendations(favsWithVotes);
              }
              setFetchingEvents(false);
        };
        loadForYou();
    }
  }, [selectedYear, combatDNA, userHistory, session]);

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
          
          statsQuery = statsQuery.lte('metric_duration', filters.maxDuration);
          statsQuery = statsQuery.gte('metric_pace', filters.minPace);
          statsQuery = statsQuery.gte('metric_violence', filters.minViolence);
          
          // Max Control: Less Than
          statsQuery = statsQuery.lte('metric_control', filters.maxControl);
          
          // Grappling Intensity
          statsQuery = statsQuery.gte('metric_intensity', filters.minGrappling);

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

      if (fightMatches && fightMatches.length > 0 && session) {
         const { data: userVotes } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', session.user.id);
         const uniqueEvents = [...new Set(fightMatches.map(f => f.event_name))];
         const { data: eventData } = await supabase.from('ufc_events').select('event_name, event_date').in('event_name', uniqueEvents);

         let merged = fightMatches.map(f => ({
          ...f,
          // FIX 1: HANDLE RATINGS ARRAY (Force it to be an object)
          ratings: (Array.isArray(f.fight_ratings) ? f.fight_ratings[0] : f.fight_ratings) || { likes_count: 0, dislikes_count: 0, favorites_count: 0 },
          event_date: eventData?.find(e => e.event_name === f.event_name)?.event_date || '0000-00-00',
          userVote: userVotes?.find(v => v.fight_id === f.id)?.vote_type
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
  }, [searchQuery, session, filters, showFilters]);

  const handleEventClick = async (event) => {
    setSelectedEvent(event);
    setCurrentView('fights');
    setEventFights([]); 
    const { data: bouts } = await supabase.from('fights').select(`*, fight_ratings (likes_count, dislikes_count, favorites_count)`).eq('event_name', event.event_name);
    if (bouts && session) {
      const { data: userVotes } = await supabase.from('user_votes').select('*').eq('user_id', session.user.id);
      const merged = bouts.map(f => ({
        ...f,
        // FIX 2: HANDLE RATINGS ARRAY
        ratings: (Array.isArray(f.fight_ratings) ? f.fight_ratings[0] : f.fight_ratings) || { likes_count: 0, dislikes_count: 0, favorites_count: 0 },
        userVote: userVotes?.find(v => v.fight_id === f.id)?.vote_type
      }));
      setEventFights(merged);
    }
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
          const newDna = await dataService.getCombatDNA(filteredFights);
          setCombatDNA(newDna);
          const chartData = await dataService.getComparisonData(filteredFights);
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

  const handleSignOut = async () => { await supabase.auth.signOut(); setSession(null); setCurrentView('events'); };

  const fetchUserHistory = async () => {
    if (!session?.user?.id) return;
    const { data: votes } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', session.user.id);
    if (!votes || votes.length === 0) { setUserHistory([]); return; }
    
    const { data: historyFights } = await supabase.from('fights').select(`*, fight_ratings (likes_count, dislikes_count, favorites_count)`).in('id', votes.map(v => v.fight_id));
    if (!historyFights) { setUserHistory([]); return; }
    
    const merged = historyFights.map(f => ({
        ...f,
        // FIX 3: HANDLE RATINGS ARRAY (Force it to be an object)
        ratings: (Array.isArray(f.fight_ratings) ? f.fight_ratings[0] : f.fight_ratings) || { likes_count: 0, dislikes_count: 0, favorites_count: 0 },
        userVote: votes.find(v => v.fight_id === f.id)?.vote_type
    }));
    setUserHistory(merged);
    updateDnaAndCharts(merged, 'combined');
  };

  useEffect(() => { 
    fetchUserHistory(); 
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  
  const isVotingLocked = (event) => {
    if (!event || !event.start_time) return false; 
    const now = new Date();
    const startTime = new Date(event.start_time); 
    return now < startTime; 
  };
  
  const isUpcoming = (dateString) => {
    if (!dateString) return false;
    const eventDate = new Date(dateString);
    const today = new Date();
    today.setHours(0,0,0,0);
    return eventDate >= today;
  };

  if (!session) return <LoginPage />;
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;

  return (
    <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} p-4 pb-20 transition-all duration-500`}>
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-between items-center mb-8 pt-4 relative">
          <button onClick={() => setShowThemeSelector(!showThemeSelector)} className={`p-2 rounded-full border border-white/10 ${currentTheme.card}`}>
            <Palette size={24} className={currentTheme.accent} />
          </button>
          
          {showThemeSelector && (
            <div className={`absolute top-16 left-0 ${currentTheme.card} border rounded-lg p-2 z-50 shadow-2xl`}>
              {Object.keys(themes).map(t => (
                <button key={t} onClick={() => { setTheme(t); setShowThemeSelector(false); }} className="block w-full text-left px-4 py-2 hover:bg-white/10 rounded capitalize text-sm">
                  {themes[t].name}
                </button>
              ))}
            </div>
          )}

          {/* Reset Filters on Navigation */}
          <h1 className="text-3xl font-black italic tracking-tighter cursor-pointer" onClick={() => {setCurrentView('events'); setSearchQuery(''); setShowFilters(false);}}>MMA DNA</h1>
          
          <div className="flex gap-2">
            <button onClick={() => { setCurrentView('dna'); setSearchQuery(''); setShowFilters(false); }} className={`p-2 rounded-full border ${currentTheme.card} ${currentView === 'dna' ? 'border-white' : 'border-white/10'}`}>
                <Dna size={24} className={currentTheme.accent} />
            </button>

            <button onClick={() => { setCurrentView('profile'); setSearchQuery(''); setShowFilters(false); }} className={`p-2 rounded-full border ${currentTheme.card} ${currentView === 'profile' ? 'border-white' : 'border-white/10'}`}>
                <User size={24} className={currentTheme.accent} />
            </button>
          </div>
        </header>

        {currentView === 'events' && (
          <>
            <div className="relative mb-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" size={20} />
              <input 
                  type="text" 
                  placeholder="Search fighters or filters..." 
                  value={searchQuery} 
                  onChange={(e) => setSearchQuery(e.target.value)} 
                  className={`w-full py-4 pl-12 pr-12 rounded-2xl border ${currentTheme.card} focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all shadow-md`} 
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
                <div className={`p-4 rounded-xl border mb-6 animate-in slide-in-from-top-2 ${currentTheme.card}`}>
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <Settings2 size={14} className={currentTheme.accent} />
                            <h3 className="text-xs font-bold uppercase tracking-widest opacity-70">Fight Finder</h3>
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
                                <span className="opacity-50 font-bold uppercase tracking-wider">Max Duration</span>
                                <span className="font-bold">{filters.maxDuration} mins</span>
                            </div>
                            <input 
                                type="range" min="1" max="25" step="1"
                                value={filters.maxDuration}
                                onChange={(e) => setFilters({...filters, maxDuration: parseInt(e.target.value)})}
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                            />
                        </div>

                        {/* PACE */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Min Pace</span>
                                <span className="font-bold">{filters.minPace} strikes/min</span>
                            </div>
                            <input 
                                type="range" min="0" max="60" step="1"
                                value={filters.minPace}
                                onChange={(e) => setFilters({...filters, minPace: parseInt(e.target.value)})}
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                            />
                        </div>

                        {/* VIOLENCE */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Min Violence Index</span>
                                <span className="font-bold">{filters.minViolence}</span>
                            </div>
                            <input 
                                type="range" min="0" max="2" step="0.1"
                                value={filters.minViolence}
                                onChange={(e) => setFilters({...filters, minViolence: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                            />
                            <div className="flex justify-between text-[10px] opacity-30 mt-1">
                                <span>Low</span>
                                <span>Bloodbath</span>
                            </div>
                        </div>

                        {/* CONTROL */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Max Control %</span>
                                <span className="font-bold">{filters.maxControl}%</span>
                            </div>
                            <input 
                                type="range" min="0" max="100" step="5"
                                value={filters.maxControl}
                                onChange={(e) => setFilters({...filters, maxControl: parseInt(e.target.value)})}
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                            />
                            <div className="flex justify-between text-[10px] opacity-30 mt-1">
                                <span>Standup War</span>
                                <span>Total Control</span>
                            </div>
                        </div>

                        {/* GRAPPLING / INTENSITY */}
                        <div>
                            <div className="flex justify-between text-xs mb-2">
                                <span className="opacity-50 font-bold uppercase tracking-wider">Min Grappling Intensity</span>
                                <span className="font-bold">{filters.minGrappling}</span>
                            </div>
                            <input 
                                type="range" min="0" max="20" step="0.5"
                                value={filters.minGrappling}
                                onChange={(e) => setFilters({...filters, minGrappling: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                            />
                            <div className="flex justify-between text-[10px] opacity-30 mt-1">
                                <span>Lay & Pray</span>
                                <span>Mauler</span>
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
                    <FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} showEvent={true} />
                ))}

                {!fetchingEvents && searchResults.length > displayLimit && (
                    <button 
                        onClick={() => setDisplayLimit(prev => prev + 10)}
                        className={`w-full py-4 rounded-xl border border-dashed border-white/20 hover:bg-white/5 hover:border-white/40 transition-all text-xs font-bold uppercase tracking-widest opacity-60 hover:opacity-100 flex items-center justify-center gap-2`}
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
                <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide items-center">
                  <button 
                    onClick={() => setSelectedYear('For You')} 
                    className={`px-6 py-2 rounded-full font-bold border transition-all flex items-center gap-2 whitespace-nowrap
                        ${selectedYear === 'For You' 
                            ? 'bg-gradient-to-r from-yellow-600 to-yellow-800 border-transparent text-white shadow-lg shadow-yellow-900/50' 
                            : 'border-yellow-500/30 text-yellow-500/80 hover:bg-yellow-500/10'
                        }`}
                  >
                    <Sparkles size={16} className={selectedYear === 'For You' ? 'text-white' : 'text-yellow-500'} />
                    For You
                  </button>
                  
                  {availableYears.map(y => (
                    <button key={y} onClick={() => setSelectedYear(y)} className={`px-6 py-2 rounded-full font-bold border transition-all ${selectedYear === y ? `${currentTheme.primary} border-transparent text-white` : 'border-white/20 opacity-50'}`}>{y}</button>
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
                                            <FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} showEvent={true} />
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
                        <button key={event.id} onClick={() => handleEventClick(event)} className={`${currentTheme.card} p-6 rounded-xl border text-left hover:scale-[1.01] transition-transform`}>
                          <h3 className="text-xl font-bold flex items-center gap-3">
                            {event.event_name}
                            {isUpcoming(event.event_date) && (
                                <span className="bg-red-600/20 text-red-500 text-xs px-2 py-1 rounded-md border border-red-600/30 uppercase tracking-widest">
                                    Upcoming
                                </span>
                            )}
                          </h3>
                          <div className="flex flex-col gap-1 mt-1 opacity-50 text-sm">
                            <p>{event.event_date}</p>
                            {event.location && <p className="flex items-center gap-1 italic"><MapPin size={12} /> {event.location}</p>}
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
            <button onClick={() => setCurrentView('events')} className="flex items-center gap-2 mb-6 font-bold opacity-60"><ChevronLeft size={20} /> BACK TO EVENTS</button>
            <h2 className="text-2xl font-black mb-1 uppercase border-l-4 border-red-600 pl-4">{selectedEvent?.event_name}</h2>
            <p className="text-sm opacity-50 mb-8 pl-5 italic">{selectedEvent?.event_date} {selectedEvent?.location ? `• ${selectedEvent.location}` : ''}</p>
            
            {(() => {
                const eventLocked = isVotingLocked(selectedEvent);
                return eventFights.map(f => (
                    <FightCard 
                        key={f.id} 
                        fight={f} 
                        currentTheme={currentTheme} 
                        handleVote={handleVote} 
                        locked={eventLocked}
                    />
                ));
            })()}
          </div>
        )}

        {/* --- 3. COMBAT DNA VIEW --- */}
        {currentView === 'dna' && (
            <div className="animate-in slide-in-from-right pb-20">
               <div className="flex items-center gap-2 mb-6 opacity-60">
                   <Dna size={20} />
                   <span className="font-bold">COMBAT DNA ANALYSIS</span>
               </div>

               <div className="flex justify-center mb-6">
                    <div className="bg-white/10 p-1 rounded-xl flex gap-1">
                        {['combined', 'likes', 'favorites'].map((type) => (
                            <button
                                key={type}
                                onClick={() => setDnaFilter(type)}
                                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                                    ${dnaFilter === type 
                                        ? (type === 'favorites' ? 'bg-yellow-500 text-black' : 'bg-white text-black') 
                                        : 'text-white/50 hover:text-white'}`}
                            >
                                {type === 'combined' ? 'All Data' : type}
                            </button>
                        ))}
                    </div>
               </div>
               
               <CombatDNACard dna={combatDNA} currentTheme={currentTheme} />
               {comparisonData.length > 0 && <CombatScatterPlot data={comparisonData} baselines={baselines} currentTheme={currentTheme} />}
               <CombatDNAVisual dna={combatDNA} currentTheme={currentTheme} />
            </div>
        )}

        {/* --- 4. PROFILE PAGE (Reordered) --- */}
        {currentView === 'profile' && (
          <div className="animate-in slide-in-from-right pb-20">
            <div className="flex items-center gap-2 mb-6 opacity-60">
                 <User size={20} />
                 <span className="font-bold">VOTING HISTORY</span>
             </div>
            
            <div className="flex bg-gray-800/50 p-1 rounded-xl mb-8">
              {['favorite', 'like', 'dislike'].map(tab => (
                <button 
                  key={tab} 
                  onClick={() => setActiveProfileTab(tab)} 
                  className={`flex-1 py-3 rounded-lg font-bold text-xs sm:text-sm uppercase transition-all 
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
              {userHistory.filter(f => f.userVote === activeProfileTab).map(f => (
                <FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} showEvent={true} />
              ))}
            </div>
            <button onClick={handleSignOut} className="w-full mt-12 py-4 bg-red-600/10 text-red-500 border border-red-500/30 rounded-xl font-bold hover:bg-red-600 hover:text-white transition-all">SIGN OUT</button>
          </div>
        )}
      </div>
    </div>
  );
}