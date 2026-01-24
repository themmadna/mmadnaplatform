// functioning profile with login and logout, likes and dislikes
// Different theme options are available


import React, { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, Star, Clock, Calendar, ChevronLeft, User, Palette, Filter } from 'lucide-react';
import { supabase } from './supabaseClient';
import { dataService } from './dataService';
import LoginPage from './Login';

// FightCard Component
const FightCard = ({ fight, showEvent = false, currentTheme, theme, handleVote, allEvents }) => {
  const getRatingPercentage = (likes, dislikes) => {
    const total = likes + dislikes;
    return total === 0 ? 0 : Math.round((likes / total) * 100);
  };

  const getEventForFight = (fightId) => {
    return allEvents.find(e => e.id === fight?.eventId);
  };

  const percentage = getRatingPercentage(fight.likes, fight.dislikes);
  const event = showEvent ? getEventForFight(fight.id) : null;

  return (
    <div className={`${currentTheme.card} rounded-xl overflow-hidden border shadow-2xl ${currentTheme.cardHover} transition-all duration-300`}>
      {showEvent && event && (
        <div className={`${theme === 'minimal' ? 'bg-gray-100' : 'bg-black/30'} px-4 py-2 text-sm ${currentTheme.textSecondary} flex items-center gap-2`}>
          <Calendar size={14} />
          <span>{event.name} - {event.date}</span>
        </div>
      )}
      <div className={`${theme === 'neon' ? 'bg-gradient-to-r from-purple-900 to-black' : theme === 'minimal' ? 'bg-gray-200' : theme === 'ocean' ? 'bg-gradient-to-r from-teal-800 to-blue-900' : 'bg-gradient-to-r from-gray-700 to-gray-800'} p-4`}>
        <div className="text-center">
          <h2 className={`text-2xl font-bold ${currentTheme.text} mb-1`}>
            {fight.fighter1} <span className={currentTheme.accent}>VS</span> {fight.fighter2}
          </h2>
          <p className={`${theme === 'minimal' ? 'text-gray-700' : currentTheme.text} text-sm`}>{fight.weightClass}</p>
        </div>
      </div>
      <div className="p-6">
        <div className={`flex items-center justify-center gap-6 mb-6 ${theme === 'minimal' ? 'text-gray-700' : currentTheme.text}`}>
          <div className="flex items-center gap-2">
            <Star size={18} className="text-yellow-500" />
            <span className="font-semibold">{fight.round}</span>
          </div>
          <div className={`w-px h-6 ${theme === 'minimal' ? 'bg-gray-300' : 'bg-gray-600'}`}></div>
          <div className="flex items-center gap-2">
            <Clock size={18} className={currentTheme.accent} />
            <span className="font-semibold">{fight.method}</span>
          </div>
        </div>
        <div className="mb-6">
          <div className={`flex justify-between text-sm ${currentTheme.textSecondary} mb-2`}>
            <span>{percentage}% liked this fight</span>
            <span>{fight.likes + fight.dislikes} votes</span>
          </div>
          <div className={`h-3 ${theme === 'minimal' ? 'bg-gray-200' : 'bg-gray-700'} rounded-full overflow-hidden`}>
            <div className={`h-full ${currentTheme.primary} transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
          </div>
        </div>
        <div className="flex gap-4">
          <button
            disabled={fight.isLoading}
            onClick={() => handleVote(fight.id, 'like')}
            className={`flex-1 flex items-center justify-center gap-3 py-4 rounded-lg font-semibold transition-all ${
              fight.userVote === 'like' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            } ${fight.isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <ThumbsUp size={24} />
            <span>{fight.likes}</span>
          </button>

          <button
            disabled={fight.isLoading}
            onClick={() => handleVote(fight.id, 'dislike')}
            className={`flex-1 flex items-center justify-center gap-3 py-4 rounded-lg font-semibold transition-all ${
              fight.userVote === 'dislike' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            } ${fight.isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <ThumbsDown size={24} />
            <span>{fight.dislikes}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// Main App Component
export default function UFCFightRating() {
  const [session, setSession] = useState(null);
  const [currentView, setCurrentView] = useState('events');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedYear, setSelectedYear] = useState('2024');
  const [profileTab, setProfileTab] = useState('liked');
  const [theme, setTheme] = useState('modern');
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [fights, setFights] = useState([
    { id: 1, eventId: 1, fighter1: "Alex Pereira", fighter2: "Khalil Rountree", weightClass: "Light Heavyweight Title", round: "Round 4", method: "TKO", likes: 2847, dislikes: 124, userVote: null, isLoading: false },
    { id: 2, eventId: 1, fighter1: "Julianna Peña", fighter2: "Raquel Pennington", weightClass: "Women's Bantamweight Title", round: "Decision", method: "Unanimous", likes: 1523, dislikes: 456, userVote: null, isLoading: false },
    { id: 3, eventId: 1, fighter1: "Roman Dolidze", fighter2: "Kevin Holland", weightClass: "Middleweight", round: "Round 1", method: "Submission", likes: 982, dislikes: 145, userVote: null, isLoading: false },
    { id: 4, eventId: 2, fighter1: "Sean O'Malley", fighter2: "Merab Dvalishvili", weightClass: "Bantamweight Title", round: "Decision", method: "Unanimous", likes: 1654, dislikes: 892, userVote: null, isLoading: false },
    { id: 5, eventId: 2, fighter1: "Alexa Grasso", fighter2: "Valentina Shevchenko", weightClass: "Women's Flyweight Title", round: "Decision", method: "Unanimous", likes: 2156, dislikes: 234, userVote: null, isLoading: false },
    { id: 6, eventId: 2, fighter1: "Diego Lopes", fighter2: "Brian Ortega", weightClass: "Featherweight", round: "Round 3", method: "Doctor Stoppage", likes: 1876, dislikes: 321, userVote: null, isLoading: false },
    { id: 7, eventId: 2, fighter1: "Daniel Zellhuber", fighter2: "Esteban Ribovics", weightClass: "Lightweight", round: "Decision", method: "Split", likes: 2543, dislikes: 178, userVote: null, isLoading: false },
    { id: 8, eventId: 3, fighter1: "Dricus Du Plessis", fighter2: "Israel Adesanya", weightClass: "Middleweight Title", round: "Round 4", method: "Submission", likes: 3210, dislikes: 432, userVote: null, isLoading: false },
    { id: 9, eventId: 3, fighter1: "Kai Kara-France", fighter2: "Steve Erceg", weightClass: "Flyweight", round: "Decision", method: "Unanimous", likes: 1543, dislikes: 287, userVote: null, isLoading: false },
    { id: 10, eventId: 3, fighter1: "Dan Hooker", fighter2: "Mateusz Gamrot", weightClass: "Lightweight", round: "Decision", method: "Split", likes: 2876, dislikes: 198, userVote: null, isLoading: false },
  ]);

  const allEvents = [
    { id: 1, name: "UFC 307", date: "Oct 5, 2024", location: "Salt Lake City, UT", fightCount: 3, year: 2024 },
    { id: 2, name: "UFC 306", date: "Sep 14, 2024", location: "Las Vegas, NV", fightCount: 4, year: 2024 },
    { id: 3, name: "UFC 305", date: "Aug 17, 2024", location: "Perth, Australia", fightCount: 3, year: 2024 },
    { id: 4, name: "UFC 296", date: "Dec 16, 2023", location: "Las Vegas, NV", fightCount: 0, year: 2023 }
  ];

  // Logic to get unique years for the filter
  const availableYears = [...new Set(allEvents.map(e => e.year.toString()))].sort((a, b) => b - a);

  useEffect(() => {
    const initSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (session) fetchUserVotes(session.user.id);
    };
    initSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserVotes(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchUserVotes = async (userId) => {
    const { data, error } = await supabase.from('user_votes').select('fight_id, vote_type').eq('user_id', userId);
    if (data && !error) {
      setFights(prev => prev.map(fight => {
        const savedVote = data.find(v => v.fight_id === fight.id);
        return savedVote ? { ...fight, userVote: savedVote.vote_type } : fight;
      }));
    }
  };

  if (!session) return <LoginPage />;

  const themes = {
    modern: { name: 'Modern Dark', bg: 'bg-gray-900', card: 'bg-gray-800 border-gray-700', cardHover: 'hover:border-red-600', primary: 'bg-red-600', text: 'text-white', textSecondary: 'text-gray-400', accent: 'text-red-400' },
    neon: { name: 'Neon Cyber', bg: 'bg-black', card: 'bg-black border-cyan-500', cardHover: 'hover:border-pink-500', primary: 'bg-cyan-500', text: 'text-cyan-100', textSecondary: 'text-purple-300', accent: 'text-pink-400' },
    minimal: { name: 'Minimal Light', bg: 'bg-gray-50', card: 'bg-white border-gray-300', cardHover: 'hover:border-blue-500', primary: 'bg-blue-600', text: 'text-gray-900', textSecondary: 'text-gray-600', accent: 'text-blue-600' },
    ocean: { name: 'Ocean Blue', bg: 'bg-blue-950', card: 'bg-blue-900 border-teal-600', cardHover: 'hover:border-cyan-400', primary: 'bg-teal-600', text: 'text-cyan-50', textSecondary: 'text-teal-300', accent: 'text-cyan-400' }
  };

  const currentTheme = themes[theme];
  const filteredEvents = allEvents.filter(e => e.year === parseInt(selectedYear));
  const likedFights = fights.filter(f => f.userVote === 'like');
  const dislikedFights = fights.filter(f => f.userVote === 'dislike');
  const eventFights = selectedEvent ? fights.filter(f => f.eventId === selectedEvent.id) : [];

  const handleVote = async (fightId, clickedVoteType) => {
    const currentFight = fights.find(f => f.id === fightId);
    if (currentFight?.isLoading) return;
    try {  
      const databaseVote = clickedVoteType === currentFight.userVote ? null : clickedVoteType;
      setFights(prev => prev.map(f => {
        if (f.id === fightId) {
          const newFight = { ...f, isLoading: true };
          if (f.userVote === 'like') newFight.likes--;
          if (f.userVote === 'dislike') newFight.dislikes--;
          newFight.userVote = databaseVote; 
          if (databaseVote === 'like') newFight.likes++;
          if (databaseVote === 'dislike') newFight.dislikes++;
          return newFight;
        }
        return f;
      }));
      await dataService.castVote(fightId, databaseVote);
    } catch (err) {
      alert("Error saving vote: " + err.message);
    } finally {
      setFights(prev => prev.map(f => f.id === fightId ? { ...f, isLoading: false } : f));
    }
  };

  return (
    <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} p-6 transition-colors duration-500`}>
      <div className="max-w-4xl mx-auto">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-8">
          <div className="relative">
            <button onClick={() => setShowThemeSelector(!showThemeSelector)} className={`p-2 rounded-full border ${currentTheme.card}`}>
              <Palette size={20} className={currentTheme.accent}/>
            </button>
            {showThemeSelector && (
              <div className={`absolute top-12 left-0 ${currentTheme.card} rounded-lg shadow-xl p-2 z-10 border min-w-[160px]`}>
                {Object.entries(themes).map(([key, t]) => (
                  <button key={key} onClick={() => { setTheme(key); setShowThemeSelector(false); }} className={`block w-full text-left px-4 py-2 rounded mb-1 ${theme === key ? 'bg-red-600 text-white' : currentTheme.text + ' hover:bg-gray-700'}`}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <h1 className="text-4xl font-black tracking-tighter cursor-pointer" onClick={() => setCurrentView('events')}>UFC RATINGS</h1>
          <button onClick={() => setCurrentView('profile')} className={`p-2 rounded-full border ${currentTheme.card}`}>
            <User size={20} className={currentTheme.accent}/>
          </button>
        </div>

        {/* YEAR FILTER - Only shows on Events view */}
        {currentView === 'events' && (
          <div className="flex items-center gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
            <div className={`p-2 rounded-lg ${currentTheme.card} flex items-center gap-2 border`}>
              <Filter size={16} className={currentTheme.accent} />
              <span className="text-xs font-bold uppercase tracking-wider opacity-60">Year</span>
            </div>
            {availableYears.map(year => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                className={`px-6 py-2 rounded-full font-bold transition-all border ${
                  selectedYear === year 
                    ? `${currentTheme.primary} text-white border-transparent` 
                    : `${currentTheme.card} text-gray-400 hover:border-gray-500`
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        )}

        {/* EVENTS LIST */}
        {currentView === 'events' && (
          <div className="space-y-4">
            {filteredEvents.length > 0 ? (
              filteredEvents.map(event => (
                <button 
                  key={event.id} 
                  onClick={() => { setSelectedEvent(event); setCurrentView('fights'); }} 
                  className={`w-full ${currentTheme.card} p-6 rounded-xl border ${currentTheme.cardHover} text-left transition-all shadow-lg`}
                >
                  <h3 className={`text-2xl font-bold ${currentTheme.text}`}>{event.name}</h3>
                  <p className={currentTheme.textSecondary}>{event.date} • {event.location}</p>
                  <div className={`mt-4 inline-block px-3 py-1 rounded-full text-xs font-bold ${currentTheme.primary} text-white`}>
                    {event.fightCount} Fights Available
                  </div>
                </button>
              ))
            ) : (
              <div className="text-center py-20 opacity-50 italic">No events found for {selectedYear}</div>
            )}
          </div>
        )}
        
        {/* FIGHTS LIST */}
        {currentView === 'fights' && (
          <div className="space-y-6">
            <button onClick={() => setCurrentView('events')} className={`flex items-center gap-2 ${currentTheme.accent} mb-4 hover:underline font-bold`}>
              <ChevronLeft size={20}/> Back to Events
            </button>
            <div className="mb-8">
              <h2 className="text-3xl font-bold">{selectedEvent?.name}</h2>
              <p className={currentTheme.textSecondary}>{selectedEvent?.location}</p>
            </div>
            {eventFights.map(fight => (
              <FightCard key={fight.id} fight={fight} allEvents={allEvents} handleVote={handleVote} theme={theme} currentTheme={currentTheme} />
            ))}
          </div>
        )}

        {/* PROFILE VIEW */}
        {currentView === 'profile' && (
          <div className="space-y-6">
            <button onClick={() => setCurrentView('events')} className={`flex items-center gap-2 ${currentTheme.accent} hover:underline font-bold`}>
              <ChevronLeft size={20}/> Back
            </button>
            <div className="flex gap-4">
              <button onClick={() => setProfileTab('liked')} className={`flex-1 py-3 rounded-lg font-bold transition-all ${profileTab === 'liked' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                Liked ({likedFights.length})
              </button>
              <button onClick={() => setProfileTab('disliked')} className={`flex-1 py-3 rounded-lg font-bold transition-all ${profileTab === 'disliked' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                Disliked ({dislikedFights.length})
              </button>
            </div>
            <div className="space-y-4">
              {(profileTab === 'liked' ? likedFights : dislikedFights).length === 0 ? (
                <p className={`text-center py-12 ${currentTheme.textSecondary} bg-black/20 rounded-xl`}>No fights {profileTab} yet. Start rating!</p>
              ) : (
                (profileTab === 'liked' ? likedFights : dislikedFights).map(fight => (
                  <FightCard key={fight.id} fight={fight} showEvent={true} allEvents={allEvents} handleVote={handleVote} theme={theme} currentTheme={currentTheme} />
                ))
              )}
            </div>
            <button onClick={() => supabase.auth.signOut()} className="w-full py-4 text-red-500 border-2 border-red-500 rounded-xl font-bold hover:bg-red-500 hover:text-white transition-all mt-8">
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}