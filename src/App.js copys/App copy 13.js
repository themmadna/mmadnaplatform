// working theme, theme will save
// working year selection
// shows bouts for an event that is clikced on
// can like or  dislike a bout
// likes and dislikes show up in profile
// database like and dislikes show up correctly
// shows event and date when looking at the fights you liked or disliked
// search bar for bouts
// dynamically changing like counter
// has dynamic Combat DNA in profile
// dna profile has new stats (new is violence, engegement, finish % avg fight duration)
// has fighter strike location on combat profile
// comnbat Dna has its own page now

import React, { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, ChevronLeft, User, Palette, MapPin, Search, X, Activity, Swords, Zap, Target, Dna } from 'lucide-react';
import { supabase } from './supabaseClient';
import { dataService } from './dataService';
import LoginPage from './Login';
import CombatDNAVisual from './CombatDNAVisual';

// --- CombatDNA Card (The 5 Metrics) ---
const CombatDNACard = ({ dna, currentTheme }) => {
  const [baselines, setBaselines] = useState({
    strikePace: 30.5,        
    grapplingIntensity: 5.5, 
    violenceIndex: 0.15,     
    engagementStyle: 45,     
    finishRate: 48,          
    avgFightTime: 10.5       
  });

  useEffect(() => {
    const loadBaselines = async () => {
      const realStats = await dataService.getGlobalBaselines();
      if (realStats) setBaselines(realStats);
    };
    loadBaselines();
  }, []);

  if (!dna) return (
    <div className={`p-6 rounded-xl border border-dashed ${currentTheme.card} opacity-50 text-center animate-in fade-in`}>
      <Activity className="mx-auto mb-2 opacity-50" />
      <p className="text-sm">Like more fights to generate your Combat DNA</p>
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

  return (
    <div className={`${currentTheme.card} p-6 rounded-2xl border mb-8 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-700`}>
      <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
        <Activity className={currentTheme.accent} size={24} />
        <div>
          <h2 className="text-xl font-black uppercase tracking-wider">Your Combat DNA</h2>
          <p className="text-xs opacity-50">Based on Bout Totals</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-center">
          <p className="text-xs opacity-50 uppercase tracking-widest mb-1">Strike Pace</p>
          <div className="text-3xl font-black mb-1">{dna.strikePace}</div>
          <p className="text-xs opacity-50 mb-2">combined / min</p>
          <div className="bg-black/20 py-1 px-2 rounded-lg inline-block">
            <Comparison userVal={dna.strikePace} baseVal={baselines.strikePace} />
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-center">
          <p className="text-xs opacity-50 uppercase tracking-widest mb-1">Violence Index</p>
          <div className="text-3xl font-black mb-1">{dna.violenceIndex}</div>
          <p className="text-xs opacity-50 mb-2">events / min</p>
          <div className="bg-black/20 py-1 px-2 rounded-lg inline-block">
            <Comparison userVal={dna.violenceIndex} baseVal={baselines.violenceIndex} />
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex justify-between text-sm mb-2 font-bold">
            <span className="flex items-center gap-2"><Swords size={14} /> Engagement Style (Control Time)</span>
            <div className="flex items-center">
              <span>{dna.engagementStyle}%</span>
              <Comparison userVal={dna.engagementStyle} baseVal={baselines.engagementStyle} suffix="%" />
            </div>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden relative" title="0% = Standup War, 100% = Grappling Clinic">
            <div className="absolute top-0 bottom-0 w-0.5 bg-white/30 z-10" style={{ left: `${baselines.engagementStyle}%` }}></div>
            <div className={`h-full ${currentTheme.primary} transition-all duration-1000`} style={{ width: `${dna.engagementStyle}%` }}></div>
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

// --- FightCard Component ---
const FightCard = ({ fight, currentTheme, handleVote, showEvent = false }) => {
  const likes = fight.ratings?.likes_count || 0;
  const dislikes = fight.ratings?.dislikes_count || 0;
  const totalVotes = likes + dislikes;
  const likePercentage = totalVotes === 0 ? 0 : Math.round((likes / totalVotes) * 100);
  const fighters = fight.bout ? fight.bout.split(/ vs /i) : ["Unknown", "Fighter"];

  return (
    <div className={`${currentTheme.card} rounded-xl overflow-hidden border mb-6 shadow-lg transition-all`}>
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
        <div className="flex justify-between text-xs mb-2 opacity-60">
          <span>{likePercentage}% liked</span>
          <span>{totalVotes} votes</span>
        </div>
        <div className="h-1.5 w-full bg-gray-700 rounded-full mb-6 relative overflow-hidden">
          <div className={`h-full ${currentTheme.primary} transition-all duration-500 absolute left-0 top-0`} style={{ width: `${likePercentage}%` }}></div>
        </div>
        <div className="flex gap-4">
          <button onClick={() => handleVote(fight.id, 'like')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${fight.userVote === 'like' ? 'bg-green-600 text-white' : 'bg-gray-800 hover:bg-gray-700'}`}>
            <ThumbsUp size={18} /> {likes}
          </button>
          <button onClick={() => handleVote(fight.id, 'dislike')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${fight.userVote === 'dislike' ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-700'}`}>
            <ThumbsDown size={18} /> {dislikes}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Main App Component ---
export default function UFCFightRating() {
  const [session, setSession] = useState(null);
  const [currentView, setCurrentView] = useState('events'); // 'events', 'fights', 'profile', 'dna'
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [availableYears, setAvailableYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [events, setEvents] = useState([]);
  const [eventFights, setEventFights] = useState([]);
  const [userHistory, setUserHistory] = useState([]);
  const [combatDNA, setCombatDNA] = useState(null);
  const [activeProfileTab, setActiveProfileTab] = useState('like');
  
  // Theme State
  const [theme, setTheme] = useState(() => localStorage.getItem('ufc_app_theme') || 'modern');
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const themes = {
    modern: { name: 'Modern Dark', bg: 'bg-gray-900', card: 'bg-gray-800 border-gray-700', primary: 'bg-red-600', text: 'text-white', accent: 'text-red-400' },
    neon: { name: 'Neon Cyber', bg: 'bg-black', card: 'bg-black border-cyan-500', primary: 'bg-cyan-500', text: 'text-cyan-100', accent: 'text-pink-400' },
    ocean: { name: 'Ocean Blue', bg: 'bg-blue-950', card: 'bg-blue-900 border-teal-600', primary: 'bg-teal-600', text: 'text-cyan-50', accent: 'text-teal-300' }
  };
  const currentTheme = themes[theme] || themes.modern;

  useEffect(() => { localStorage.setItem('ufc_app_theme', theme); }, [theme]);

  useEffect(() => {
    const init = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      await fetchYears();
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

  // Browse Events Logic
  useEffect(() => {
    if (!selectedYear || searchQuery) return;
    const fetchEventsByYear = async () => {
      setFetchingEvents(true);
      const { data } = await supabase.from('ufc_events').select('*').gte('event_date', `${selectedYear}-01-01`).lte('event_date', `${selectedYear}-12-31`).order('event_date', { ascending: false });
      setEvents(data || []);
      setFetchingEvents(false);
    };
    fetchEventsByYear();
  }, [selectedYear, searchQuery]);

  // Search Logic
  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (!searchQuery) { setSearchResults([]); return; }
      setFetchingEvents(true);
      const query = searchQuery.trim().toLowerCase();
      const { data: fightMatches } = await supabase.from('fights').select(`*, fight_ratings (likes_count, dislikes_count)`).or(`bout.ilike.%${query}%,event_name.ilike.%${query}%`).limit(100);

      if (fightMatches && fightMatches.length > 0 && session) {
        const { data: userVotes } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', session.user.id);
        const uniqueEvents = [...new Set(fightMatches.map(f => f.event_name))];
        const { data: eventData } = await supabase.from('ufc_events').select('event_name, event_date').in('event_name', uniqueEvents);

        let merged = fightMatches.map(f => ({
          ...f,
          ratings: f.fight_ratings || { likes_count: 0, dislikes_count: 0 },
          event_date: eventData?.find(e => e.event_name === f.event_name)?.event_date || '0000-00-00',
          userVote: userVotes?.find(v => v.fight_id === f.id)?.vote_type
        }));
        if (merged.some(f => f.bout && f.bout.toLowerCase().includes(query))) {
            merged = merged.filter(f => f.bout && f.bout.toLowerCase().includes(query));
        }
        merged.sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
        setSearchResults(merged);
      } else { setSearchResults([]); }
      setFetchingEvents(false);
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery, session]);

  const handleEventClick = async (event) => {
    setSelectedEvent(event);
    setCurrentView('fights');
    setEventFights([]); 
    const { data: bouts } = await supabase.from('fights').select(`*, fight_ratings (likes_count, dislikes_count)`).eq('event_name', event.event_name);
    if (bouts && session) {
      const { data: userVotes } = await supabase.from('user_votes').select('*').eq('user_id', session.user.id);
      const merged = bouts.map(f => ({
        ...f,
        ratings: f.fight_ratings || { likes_count: 0, dislikes_count: 0 },
        userVote: userVotes?.find(v => v.fight_id === f.id)?.vote_type
      }));
      setEventFights(merged);
    }
  };

  const handleVote = async (fightId, clickedType) => {
    let targetList;
    if (currentView === 'profile') targetList = userHistory;
    else if (searchQuery) targetList = searchResults;
    else targetList = eventFights;

    const fight = targetList.find(f => f.id === fightId);
    if (!fight) return;
    
    const oldVote = fight.userVote;
    const isSwitching = oldVote !== null && oldVote !== clickedType;
    const finalVote = oldVote === clickedType ? null : clickedType;

    const updateList = (list) => list.map(f => {
      if (f.id === fightId) {
        let { likes_count, dislikes_count } = f.ratings || { likes_count: 0, dislikes_count: 0 };
        if (oldVote === 'like') likes_count = Math.max(0, likes_count - 1);
        if (oldVote === 'dislike') dislikes_count = Math.max(0, dislikes_count - 1);
        if (finalVote === 'like') likes_count++;
        if (finalVote === 'dislike') dislikes_count++;
        return { ...f, userVote: finalVote, ratings: { likes_count, dislikes_count } };
      }
      return f;
    });

    if (searchQuery) setSearchResults(updateList(searchResults));
    if (eventFights.length > 0) setEventFights(updateList(eventFights));
    const newUserHistory = updateList(userHistory);
    setUserHistory(newUserHistory);

    // Update DNA in background if we liked a fight
    if (finalVote === 'like' || oldVote === 'like') {
       const likedFights = newUserHistory.filter(f => f.userVote === 'like');
       if (likedFights.length > 0) {
          dataService.getCombatDNA(likedFights).then(dna => setCombatDNA(dna));
       } else { setCombatDNA(null); }
    }

    try {
      if (isSwitching) await dataService.castVote(fightId, null);
      await dataService.castVote(fightId, finalVote);
    } catch (err) { console.error(err); }
  };

  const handleSignOut = async () => { await supabase.auth.signOut(); setSession(null); setCurrentView('events'); };

  const fetchUserHistory = async () => {
    if (!session?.user?.id) return;
    const { data: votes } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', session.user.id);
    if (!votes || votes.length === 0) { setUserHistory([]); return; }
    
    const { data: historyFights } = await supabase.from('fights').select(`*, fight_ratings (likes_count, dislikes_count)`).in('id', votes.map(v => v.fight_id));
    if (!historyFights) { setUserHistory([]); return; }
    
    const uniqueEventNames = [...new Set(historyFights.map(f => f.event_name))];
    const { data: eventDates } = await supabase.from('ufc_events').select('event_name, event_date').in('event_name', uniqueEventNames);
    
    const merged = historyFights.map(f => {
      const eventInfo = eventDates?.find(e => e.event_name === f.event_name);
      return {
        ...f,
        ratings: f.fight_ratings || { likes_count: 0, dislikes_count: 0 },
        event_date: eventInfo?.event_date || '',
        userVote: votes.find(v => v.fight_id === f.id)?.vote_type
      };
    });
    merged.sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
    setUserHistory(merged);

    const likedFights = merged.filter(f => f.userVote === 'like');
    if (likedFights.length > 0) {
      const dnaResults = await dataService.getCombatDNA(likedFights);
      setCombatDNA(dnaResults);
    } else {
      setCombatDNA(null);
    }
  };

  // Trigger Data Fetch when entering Profile or DNA view
  useEffect(() => { 
    if (currentView === 'profile' || currentView === 'dna') {
        fetchUserHistory(); 
    }
  }, [currentView]);

  if (!session) return <LoginPage />;
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;

  return (
    <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} p-4 pb-20 transition-all duration-500`}>
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-between items-center mb-8 pt-4 relative">
          {/* THEME SELECTOR */}
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

          {/* MAIN TITLE (Click to go home) */}
          <h1 className="text-3xl font-black italic tracking-tighter cursor-pointer" onClick={() => {setCurrentView('events'); setSearchQuery('');}}>UFC RATINGS</h1>
          
          {/* HEADER ICONS */}
          <div className="flex gap-2">
            {/* 1. DNA ICON (New Page) */}
            <button onClick={() => { setCurrentView('dna'); setSearchQuery(''); }} className={`p-2 rounded-full border ${currentTheme.card} ${currentView === 'dna' ? 'border-white' : 'border-white/10'}`}>
                <Dna size={24} className={currentTheme.accent} />
            </button>

            {/* 2. PROFILE ICON */}
            <button onClick={() => { setCurrentView('profile'); setSearchQuery(''); }} className={`p-2 rounded-full border ${currentTheme.card} ${currentView === 'profile' ? 'border-white' : 'border-white/10'}`}>
                <User size={24} className={currentTheme.accent} />
            </button>
          </div>
        </header>

        {/* --- 1. EVENTS VIEW --- */}
        {currentView === 'events' && (
          <>
            <div className="relative mb-6">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" size={20} />
              <input type="text" placeholder="Search fighters or events..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`w-full py-4 pl-12 pr-12 rounded-2xl border ${currentTheme.card} focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all shadow-md`} />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"><X size={20} /></button>}
            </div>

            {searchQuery && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-sm font-bold opacity-50 mb-4 uppercase tracking-widest">{fetchingEvents ? "Searching..." : `Found ${searchResults.length} Fights`}</h3>
                {searchResults.map(f => (<FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} showEvent={true} />))}
                {!fetchingEvents && searchResults.length === 0 && (<div className="text-center py-20 opacity-40 italic">No fights found.</div>)}
              </div>
            )}

            {!searchQuery && (
              <>
                <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                  {availableYears.map(y => (
                    <button key={y} onClick={() => setSelectedYear(y)} className={`px-6 py-2 rounded-full font-bold border transition-all ${selectedYear === y ? `${currentTheme.primary} border-transparent text-white` : 'border-white/20 opacity-50'}`}>{y}</button>
                  ))}
                </div>
                <div className="grid gap-4">
                  {fetchingEvents ? (<p className="text-center opacity-40 py-10 italic">Loading...</p>) : events.map(event => (
                    <button key={event.id} onClick={() => handleEventClick(event)} className={`${currentTheme.card} p-6 rounded-xl border text-left hover:scale-[1.01] transition-transform`}>
                      <h3 className="text-xl font-bold">{event.event_name}</h3>
                      <div className="flex flex-col gap-1 mt-1 opacity-50 text-sm">
                        <p>{event.event_date}</p>
                        {event.location && <p className="flex items-center gap-1 italic"><MapPin size={12} /> {event.location}</p>}
                      </div>
                    </button>
                  ))}
                </div>
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
            {eventFights.map(f => <FightCard key={f.id} fight={f} currentTheme={currentTheme} handleVote={handleVote} />)}
          </div>
        )}

        {/* --- 3. DNA PAGE (New View) --- */}
        {currentView === 'dna' && (
          <div className="animate-in slide-in-from-right pb-20">
             <div className="flex items-center gap-2 mb-6 opacity-60">
                 <Dna size={20} />
                 <span className="font-bold">DNA ANALYSIS</span>
             </div>
             
             {/* DNA Components live here now */}
             <CombatDNAVisual dna={combatDNA} currentTheme={currentTheme} />
             <CombatDNACard dna={combatDNA} currentTheme={currentTheme} />
          </div>
        )}

        {/* --- 4. PROFILE PAGE (Likes/Dislikes Only) --- */}
        {currentView === 'profile' && (
          <div className="animate-in slide-in-from-right pb-20">
            <div className="flex items-center gap-2 mb-6 opacity-60">
                 <User size={20} />
                 <span className="font-bold">VOTING HISTORY</span>
             </div>

            <div className="flex bg-gray-800/50 p-1 rounded-xl mb-8">
              {['like', 'dislike'].map(tab => (
                <button key={tab} onClick={() => setActiveProfileTab(tab)} className={`flex-1 py-3 rounded-lg font-bold uppercase transition-all ${activeProfileTab === tab ? (tab === 'like' ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'opacity-40'}`}>
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