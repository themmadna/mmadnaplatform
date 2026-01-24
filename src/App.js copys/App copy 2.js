// Has Dynamic year selection
// Defaults to 2026
// Has theme selection
// no bouts show up when selecting an event

import React, { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, Star, Clock, Calendar, ChevronLeft, User, Palette, Filter } from 'lucide-react';
import { supabase } from './supabaseClient';
import { dataService } from './dataService';
import LoginPage from './Login';

// --- FightCard Component ---
const FightCard = ({ fight, showEvent = false, currentTheme, theme, handleVote, events }) => {
  const getRatingPercentage = (likes, dislikes) => {
    const total = (likes || 0) + (dislikes || 0);
    return total === 0 ? 0 : Math.round((likes / total) * 100);
  };

  const getEventForFight = () => {
    return events.find(e => e.event_name?.trim() === fight?.event_name?.trim());
  };

  const percentage = getRatingPercentage(fight.likes, fight.dislikes);
  const event = showEvent ? getEventForFight() : null;

  return (
    <div className={`${currentTheme.card} rounded-xl overflow-hidden border shadow-2xl transition-all duration-300 mb-6`}>
      {showEvent && event && (
        <div className={`${theme === 'minimal' ? 'bg-gray-100' : 'bg-black/30'} px-4 py-2 text-sm ${currentTheme.textSecondary} flex items-center gap-2`}>
          <Calendar size={14} />
          <span>{event.event_name} - {event.event_date}</span>
        </div>
      )}
      <div className={`p-4 ${theme === 'neon' ? 'bg-gradient-to-r from-purple-900 to-black' : 'bg-black/20'}`}>
        <div className="text-center">
          <h2 className={`text-2xl font-bold ${currentTheme.text} mb-1`}>
            {fight.fighter1} <span className={currentTheme.accent}>VS</span> {fight.fighter2}
          </h2>
          <p className="text-sm opacity-70">{fight.weightClass}</p>
        </div>
      </div>
      <div className="p-6">
        <div className="flex justify-between text-sm mb-2 opacity-70">
          <span>{percentage}% liked</span>
          <span>{(fight.likes || 0) + (fight.dislikes || 0)} votes</span>
        </div>
        <div className="h-3 bg-gray-700 rounded-full overflow-hidden mb-6">
          <div className={`h-full ${currentTheme.primary} transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => handleVote(fight.id, 'like')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
              fight.userVote === 'like' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            <ThumbsUp size={20} /> {fight.likes || 0}
          </button>
          <button
            onClick={() => handleVote(fight.id, 'dislike')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
              fight.userVote === 'dislike' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            <ThumbsDown size={20} /> {fight.dislikes || 0}
          </button>
        </div>
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
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [profileTab, setProfileTab] = useState('liked');
  const [theme, setTheme] = useState('modern');
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [fights, setFights] = useState([]); 
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchingEvents, setFetchingEvents] = useState(false);

  const themes = {
    modern: { name: 'Modern Dark', bg: 'bg-gray-900', card: 'bg-gray-800 border-gray-700', primary: 'bg-red-600', text: 'text-white', accent: 'text-red-400' },
    neon: { name: 'Neon Cyber', bg: 'bg-black', card: 'bg-black border-cyan-500', primary: 'bg-cyan-500', text: 'text-cyan-100', accent: 'text-pink-400' },
    minimal: { name: 'Minimal Light', bg: 'bg-gray-50', card: 'bg-white border-gray-300', primary: 'bg-blue-600', text: 'text-gray-900', accent: 'text-blue-600' },
    ocean: { name: 'Ocean Blue', bg: 'bg-blue-950', card: 'bg-blue-900 border-teal-600', primary: 'bg-teal-600', text: 'text-cyan-50', accent: 'text-teal-300' }
  };

  const currentTheme = themes[theme] || themes.modern;

  useEffect(() => {
    const initApp = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      await fetchYears();
      await fetchAllFights(); 
      if (currentSession) fetchUserVotes(currentSession.user.id);
      setLoading(false);
    };
    initApp();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchYears = async () => {
    const { data } = await supabase.from('ufc_events').select('event_date');
    if (data) {
      const years = data.map(event => event.event_date.split('-')[0]);
      const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
      setAvailableYears(uniqueYears);
    }
  };

  const fetchAllFights = async () => {
    const { data } = await supabase.from('fights').select('*');
    if (data) setFights(data);
  };

  // FIXED: Clear and fetch events for the specific year
  useEffect(() => {
    const fetchEventsByYear = async () => {
      setFetchingEvents(true);
      setEvents([]); // Immediate clear to prevent 2025 leak in 2023 view

      const { data } = await supabase
        .from('ufc_events')
        .select('*')
        .gte('event_date', `${selectedYear}-01-01`)
        .lte('event_date', `${selectedYear}-12-31`)
        .order('event_date', { ascending: false });
      
      if (data) setEvents(data);
      setFetchingEvents(false);
    };
    if (selectedYear) fetchEventsByYear();
  }, [selectedYear]);

  const fetchUserVotes = async (userId) => {
    const { data } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', userId);
    if (data) {
      setFights(prev => prev.map(fight => {
        const savedVote = data.find(v => v.fight_id === fight.id);
        return savedVote ? { ...fight, userVote: savedVote.vote_type } : fight;
      }));
    }
  };

  const handleVote = async (fightId, clickedVoteType) => {
    const currentFight = fights.find(f => f.id === fightId);
    const databaseVote = clickedVoteType === currentFight.userVote ? null : clickedVoteType;
    
    setFights(prev => prev.map(f => {
      if (f.id === fightId) {
        let { likes, dislikes } = f;
        if (f.userVote === 'like') likes--;
        if (f.userVote === 'dislike') dislikes--;
        if (databaseVote === 'like') likes++;
        if (databaseVote === 'dislike') dislikes++;
        return { ...f, userVote: databaseVote, likes, dislikes };
      }
      return f;
    }));

    try {
      await dataService.castVote(fightId, databaseVote);
    } catch (err) {
      console.error("Vote failed", err);
    }
  };

  if (!session) return <LoginPage />;
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;

  const eventFights = selectedEvent 
    ? fights.filter(f => f.event_name?.trim() === selectedEvent.event_name?.trim()) 
    : [];

  const likedFights = fights.filter(f => f.userVote === 'like');
  const dislikedFights = fights.filter(f => f.userVote === 'dislike');

  return (
    <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} p-4 pb-20 transition-all`}>
      <div className="max-w-2xl mx-auto">
        
        <header className="flex justify-between items-center mb-8 pt-4 relative">
          <button onClick={() => setShowThemeSelector(!showThemeSelector)} className={`p-2 rounded-full border ${currentTheme.card}`}>
            <Palette size={20} className={currentTheme.accent} />
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

          <h1 className="text-3xl font-black italic tracking-tighter cursor-pointer" onClick={() => setCurrentView('events')}>UFC RATINGS</h1>
          
          <button onClick={() => setCurrentView('profile')} className={`p-2 rounded-full border ${currentTheme.card}`}>
            <User size={20} className={currentTheme.accent} />
          </button>
        </header>

        {currentView === 'events' && (
          <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
            {availableYears.map(year => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                className={`px-6 py-2 rounded-full font-bold border transition-all ${
                  selectedYear === year ? `${currentTheme.primary} text-white border-transparent` : 'bg-transparent border-white/20 opacity-50'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        )}

        {currentView === 'events' && (
          <div className="grid gap-4">
            {fetchingEvents ? (
              <p className="text-center opacity-50 py-10">Loading events for {selectedYear}...</p>
            ) : events.length > 0 ? (
              events.map(event => (
                <button key={event.id} onClick={() => { setSelectedEvent(event); setCurrentView('fights'); }} className={`${currentTheme.card} p-6 rounded-xl border text-left hover:scale-[1.01] transition-all`}>
                  <h3 className="text-xl font-bold">{event.event_name}</h3>
                  <p className="text-sm opacity-60">{event.event_date}</p>
                </button>
              ))
            ) : (
              <p className="text-center opacity-50 py-10">No events found for {selectedYear}</p>
            )}
          </div>
        )}

        {currentView === 'fights' && (
          <div className="animate-in fade-in duration-300">
            <button onClick={() => setCurrentView('events')} className="flex items-center gap-2 mb-6 font-bold opacity-70">
              <ChevronLeft size={20} /> BACK TO EVENTS
            </button>
            <h2 className="text-3xl font-black mb-8 uppercase border-l-4 border-red-600 pl-4">{selectedEvent?.event_name}</h2>
            {eventFights.length > 0 ? (
              eventFights.map(f => <FightCard key={f.id} fight={f} events={events} currentTheme={currentTheme} theme={theme} handleVote={handleVote} />)
            ) : (
              <p className="text-center opacity-50 italic py-12 border-2 border-dashed border-white/10 rounded-xl">No fights recorded for this event yet.</p>
            )}
          </div>
        )}

        {currentView === 'profile' && (
          <div className="space-y-6">
            <button onClick={() => setCurrentView('events')} className="flex items-center gap-2 mb-6 font-bold opacity-70">
              <ChevronLeft size={20} /> BACK
            </button>
            <div className="flex gap-2">
              <button onClick={() => setProfileTab('liked')} className={`flex-1 py-3 rounded-lg font-bold ${profileTab === 'liked' ? 'bg-green-600' : 'bg-gray-800 opacity-50'}`}>Liked ({likedFights.length})</button>
              <button onClick={() => setProfileTab('disliked')} className={`flex-1 py-3 rounded-lg font-bold ${profileTab === 'disliked' ? 'bg-red-600' : 'bg-gray-800 opacity-50'}`}>Disliked ({dislikedFights.length})</button>
            </div>
            {(profileTab === 'liked' ? likedFights : dislikedFights).map(f => (
              <FightCard key={f.id} fight={f} showEvent={true} events={events} currentTheme={currentTheme} theme={theme} handleVote={handleVote} />
            ))}
            <button onClick={() => supabase.auth.signOut()} className="w-full py-4 bg-red-600/10 text-red-500 border border-red-500 rounded-xl font-bold mt-12 hover:bg-red-600 hover:text-white transition-all">SIGN OUT</button>
          </div>
        )}
      </div>
    </div>
  );
}