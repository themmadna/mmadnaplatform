import os
import time
from datetime import datetime
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client
from dateutil import parser
from pathlib import Path # <--- Add this import

# --- 1. INITIALIZATION ---
# This forces the script to look for .env in the same folder as the script file
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

url = os.environ.get("REACT_APP_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

# Simple check to stop the script immediately if keys are missing
if not url or not key:
    raise ValueError(f"❌ Error: .env file not loaded correctly.\nLooking at: {env_path}\nMake sure SUPABASE_URL and SUPABASE_SERVICE_KEY are inside.")

supabase_db: Client = create_client(url, key)


# Track what we add today
stats_summary = {
    "new_events": 0,
    "new_fights": 0,
    "updated_fights": 0,
    "new_metadata": 0,
    "new_round_rows": 0
}

# --- 2. UTILITY FUNCTIONS ---
def get_texts(td): 
    return [p.get_text(strip=True) for p in td.find_all('p')]

def time_to_seconds(time_str):
    if not time_str or ":" not in time_str: return 0
    try:
        m, s = map(int, time_str.strip().split(":"))
        return m * 60 + s
    except: return 0

def safe_split(text):
    try:
        l, a = text.split(' of ')
        return int(l), int(a)
    except: return 0, 0

def clean_bout_name(text):
    if not text: return text
    # Standardizes 'vs.' to 'vs' and removes invisible non-breaking spaces (\xa0)
    return text.replace(' vs. ', ' vs ').replace('\xa0', ' ').strip()

# --- 3. CORE PARSING LOGIC ---

def parse_fight_meta_details(fight_url):
    try:
        res = requests.get(fight_url, timeout=10)
        soup = BeautifulSoup(res.text, 'html.parser')
        fighters = soup.select('div.b-fight-details__person')
        if len(fighters) < 2: return None

        f1_name = fighters[0].select_one('h3.b-fight-details__person-name').text.strip()
        f2_name = fighters[1].select_one('h3.b-fight-details__person-name').text.strip()
        r1 = fighters[0].select_one('i.b-fight-details__person-status').text.strip().upper()
        r2 = fighters[1].select_one('i.b-fight-details__person-status').text.strip().upper()

        winner = f1_name if r1 == "W" else (f2_name if r2 == "W" else None)
        details_div = soup.select_one("div.b-fight-details__fight")
        labels = details_div.select("i.b-fight-details__label")
        content = details_div.select("i.b-fight-details__text-item, i.b-fight-details__text-item_first")
        details = {l.text.strip().rstrip(":").lower().replace(" ", "_"): v.text.replace(l.text, "").strip() for l, v in zip(labels, content)}

        # --- THE FIX: Clean the event name string too ---
        raw_event_name = soup.select_one("body > section > div > h2 > a").text.strip()
        cleaned_event_name = clean_bout_name(raw_event_name)

        return {
            "event_name": cleaned_event_name,
            "bout": f"{clean_bout_name(f1_name)} vs {clean_bout_name(f2_name)}",
            "fighter1_name": clean_bout_name(f1_name),
            "fighter2_name": clean_bout_name(f2_name),
            "winner": clean_bout_name(winner) if winner else None,
            "result": "win" if (r1 == "W" or r2 == "W") else "draw",
            "weight_class": details_div.select_one("i.b-fight-details__fight-title").text.strip(),
            "method": details.get("method", ""),
            "round": details.get("round", ""),
            "time": details.get("time", ""),
            "time_format": details.get("time_format", ""),
            "referee": details.get("referee", ""),
            "fight_url": fight_url,
        }
    except: return None

def parse_base_stats_table(table, event_name, fight_name):
    tbody = table.find('tbody')
    rows = tbody.find_all(['thead', 'tr'], recursive=False)
    stats, round_num, i = [], 0, 0
    while i < len(rows):
        if rows[i].name == 'thead' and 'Round' in rows[i].text:
            round_num += 1
            i += 1
            tds = rows[i].find_all('td')
            if len(tds) == 10:
                # Extract raw text
                f1_raw = [td.find_all('p')[0].text.strip() for td in tds]
                f2_raw = [td.find_all('p')[1].text.strip() for td in tds]
                
                for f in [f1_raw, f2_raw]:
                    l_sig, a_sig = safe_split(f[2])
                    l_tot, a_tot = safe_split(f[4])
                    l_td, a_td = safe_split(f[5])
                    
                    # --- CLEANING STATION ---
                    stats.append({
                        "event_name": clean_bout_name(event_name),  
                        "bout": clean_bout_name(fight_name),        
                        "round": round_num, 
                        "fighter_name": clean_bout_name(f[0]),      
                        "kd": int(f[1]), 
                        "sig_strikes_landed": l_sig, 
                        "sig_strikes_attempted": a_sig, 
                        "total_strikes_landed": l_tot, 
                        "total_strikes_attempted": a_tot, 
                        "takedowns_landed": l_td, 
                        "takedowns_attempted": a_td, 
                        "sub_attempts": int(f[7]), 
                        "reversals": int(f[8]), 
                        "control_time": f[9], 
                        "control_time_sec": time_to_seconds(f[9])
                    })
        i += 1
    return stats

def parse_zone_stats_table(table, event_name, fight_name):
    tbody = table.find('tbody')
    rows = tbody.find_all(['thead', 'tr'], recursive=False)
    stats, round_num, i = [], 0, 0
    while i < len(rows):
        if rows[i].name == 'thead' and 'Round' in rows[i].text:
            round_num += 1
            i += 1
            tds = rows[i].find_all('td')
            if len(tds) >= 9:
                f1 = {
                    "bout": fight_name, 
                    "fighter_name": clean_bout_name(tds[0].find_all("p")[0].text.strip()), 
                    "round": round_num
                }
                f2 = {
                    "bout": fight_name, 
                    "fighter_name": clean_bout_name(tds[0].find_all("p")[1].text.strip()), 
                    "round": round_num
                }
                
                keys = ["sig_strikes_head", "sig_strikes_body", "sig_strikes_leg", "sig_strikes_distance", "sig_strikes_clinch", "sig_strikes_ground"]
                for offset, key in enumerate(keys, start=3):
                    l1, a1 = safe_split(tds[offset].find_all("p")[0].text.strip())
                    l2, a2 = safe_split(tds[offset].find_all("p")[1].text.strip())
                    f1[f"{key}_landed"], f1[f"{key}_attempted"], f2[f"{key}_landed"], f2[f"{key}_attempted"] = l1, a1, l2, a2
                
                stats.extend([f1, f2])
        i += 1
    return stats

# --- 4. NEW: UPCOMING SCRAPERS ---

def sync_upcoming_events():
    print("🔮 Phase 0: Syncing Upcoming Events (Next Event Only)...")
    res = requests.get("http://ufcstats.com/statistics/events/upcoming")
    soup = BeautifulSoup(res.text, 'html.parser')
    rows = soup.find('table', class_='b-statistics__table-events').find_all('tr', class_='b-statistics__table-row')
    
    # LOGIC CHANGE: Only process the FIRST valid row (The next event)
    # The first row is usually the header, so we look for the first one with a link
    
    found_next_event = False
    
    for row in rows:
        if found_next_event: break # Stop after finding the first one
        
        if not row.find('a'): continue 
        
        tds = row.find_all('td')
        e_name = clean_bout_name(tds[0].find('a').text.strip())
        e_url = tds[0].find('a')['href']
        e_date = tds[0].find('span', class_='b-statistics__date').text.strip()
        
        try:
            iso_date = datetime.strptime(e_date, "%B %d, %Y").date().isoformat()
        except:
            iso_date = None

        # Check if exists
        if supabase_db.table("ufc_events").select("id").eq("event_url", e_url).execute().data: 
            found_next_event = True # Mark found so we stop looping
            continue 
            
        print(f"📅 New Upcoming Event: {e_name}")
        supabase_db.table("ufc_events").insert({
            "event_name": e_name, 
            "event_url": e_url, 
            "event_date": iso_date, 
            "event_location": tds[1].text.strip()
        }).execute()
        stats_summary["new_events"] += 1
        found_next_event = True # Stop after inserting the one event

def sync_upcoming_fights():
    print("🔮 Phase 0.5: Syncing Upcoming Fights (Next Event Only)...")
    
    today = datetime.now().date().isoformat()
    
    # FETCH ONLY THE 1 NEAREST EVENT
    events = supabase_db.table("ufc_events")\
        .select("event_name, event_url, event_date")\
        .filter("event_date", "gte", today)\
        .order("event_date", desc=False)\
        .limit(1)\
        .execute()
    
    for event in events.data:
        # Check if we already have fights for this upcoming event
        if supabase_db.table("fights").select("id").eq("event_name", event['event_name']).execute().data: 
            print(f"Skipping {event['event_name']} (Already in DB)")
            continue 

        print(f"Processing Next Event: {event['event_name']}")
        res = requests.get(event['event_url'])
        soup = BeautifulSoup(res.text, 'html.parser')
        tbody = soup.find('tbody')
        if not tbody: continue
        
        rows = tbody.find_all('tr', class_='b-fight-details__table-row')
        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 2: continue 
            
            fighters = get_texts(cols[1]) 
            if len(fighters) < 2: continue

            # Check Col 1 for link first, then Col 0
            link_tag = cols[1].find('a')
            if not link_tag:
                 link_tag = cols[0].find('a')
            
            fight_url = link_tag['href'] if link_tag else None
            
            f1 = clean_bout_name(fighters[0])
            f2 = clean_bout_name(fighters[1])
            standardized_bout = f"{f1} vs {f2}"

            print(f"⚔️  Upcoming Fight: {standardized_bout}")
            
            supabase_db.table("fights").insert({
                'event_name': event['event_name'], 
                'bout': standardized_bout, 
                'fight_url': fight_url, 
                'status': 'upcoming' 
            }).execute()
            stats_summary["new_fights"] += 1


# --- 5. UPDATED: MAIN SCRAPERS ---

def sync_events():
    print("🚀 Phase 1: Syncing Completed Events...")
    res = requests.get("http://ufcstats.com/statistics/events/completed?page=all")
    soup = BeautifulSoup(res.text, 'html.parser')
    rows = soup.find('table', class_='b-statistics__table-events').find_all('tr', class_='b-statistics__table-row')
    for row in rows:
        if not row.find('a') or row.find('img'): continue 
        e_name = clean_bout_name(row.find_all('td')[0].find('a').text.strip())
        e_url = row.find_all('td')[0].find('a')['href']
        e_date = row.find_all('td')[0].find('span', class_='b-statistics__date').text.strip()
        iso_date = datetime.strptime(e_date, "%B %d, %Y").date().isoformat()
        
        # Check if exists
        if supabase_db.table("ufc_events").select("id").eq("event_url", e_url).execute().data: break 
        
        print(f"🏟️ New Completed Event: {e_name}")
        supabase_db.table("ufc_events").insert({"event_name": e_name, "event_url": e_url, "event_date": iso_date, "event_location": row.find_all('td')[1].text.strip()}).execute()
        stats_summary["new_events"] += 1

def sync_fights():
    print("🚀 Phase 2: Syncing Completed Fights...")
    # Fetch recent events
    events = supabase_db.table("ufc_events").select("event_name, event_url").order("event_date", desc=True).limit(10).execute()
    
    for event in events.data:
        # 1. Fetch ALL existing fights for this event
        existing_fights = supabase_db.table("fights").select("id, bout, status").eq("event_name", event['event_name']).execute().data
        
        # 2. Create a lookup map
        existing_map = {}
        for f in existing_fights:
            existing_map[f['bout']] = f
            if " vs " in f['bout']:
                p1, p2 = f['bout'].split(" vs ")
                existing_map[f"{p2} vs {p1}"] = f

        scraped_ids = [] 

        res = requests.get(event['event_url'])
        soup = BeautifulSoup(res.text, 'html.parser')
        tbody = soup.find('tbody')
        
        # Only parse rows if tbody exists
        if tbody:
            rows = tbody.find_all('tr', class_='b-fight-details__table-row')
            for row in rows:
                cols = row.find_all('td')
                if len(cols) < 10: continue
                
                fighters = get_texts(cols[1]) 
                if len(fighters) < 2: continue

                link_tag = cols[0].find('a')
                if not link_tag: continue

                f1 = clean_bout_name(fighters[0])
                f2 = clean_bout_name(fighters[1])
                standardized_bout = f"{f1} vs {f2}"
                fight_url = link_tag['href']
                
                # 3. Check map
                if standardized_bout in existing_map:
                    fight_record = existing_map[standardized_bout]
                    scraped_ids.append(fight_record['id']) 
                    
                    if fight_record.get('status') == 'upcoming':
                        print(f"🔄 Updating Status (Upcoming -> Completed): {standardized_bout}")
                        supabase_db.table("fights").update({
                            "status": "completed",
                            "fight_url": fight_url,
                            "bout": standardized_bout 
                        }).eq("id", fight_record['id']).execute()
                        stats_summary["updated_fights"] += 1
                else:
                    print(f"➕ Inserting New Completed: {standardized_bout}")
                    supabase_db.table("fights").insert({
                        'event_name': event['event_name'], 
                        'bout': standardized_bout, 
                        'fight_url': fight_url,
                        'status': 'completed' 
                    }).execute()
                    stats_summary["new_fights"] += 1

        # 4. AUTO-DELETE LOGIC (With Safety Switch)
        # We ONLY delete missing fights if we actually found at least one result.
        # If scraped_ids is empty, it means the event hasn't happened yet, so we touch nothing.
        if len(scraped_ids) > 0:
            for f in existing_fights:
                if f['status'] == 'upcoming' and f['id'] not in scraped_ids:
                    print(f"🚫 Deleting Cancelled Fight: {f['bout']}")
                    supabase_db.table("user_votes").delete().eq("fight_id", f['id']).execute()
                    supabase_db.table("fights").delete().eq("id", f['id']).execute()

def sync_meta():
    print("🚀 Phase 3: Syncing Metadata & Winners...")
    # Fetch fights that are 'completed' but missing metadata
    fights = supabase_db.table("fights").select("bout, fight_url").eq("status", "completed").order("id", desc=True).limit(50).execute()
    
    for f in fights.data:
        # Check if meta already exists to avoid duplicates
        if supabase_db.table("fight_meta_details").select("id").eq("fight_url", f['fight_url']).execute().data: 
            continue
            
        data = parse_fight_meta_details(f['fight_url'])
        if data:
            data['bout'] = clean_bout_name(data.get('bout', ''))
            
            # --- THE FIX ---
            # Remove 'status' from the dictionary because the fight_meta_details table 
            # doesn't have a 'status' column. (It only exists on the parent 'fights' table).
            data.pop('status', None) 

            # 1. Insert the detailed metadata
            supabase_db.table("fight_meta_details").insert(data).execute()
            
            # 2. Update the main 'fights' table with the winner
            if data.get('winner'):
                print(f"🏆 Updating Winner for {data['bout']}: {data['winner']}")
                supabase_db.table("fights").update({
                    "winner": data['winner']
                }).eq("fight_url", f['fight_url']).execute()
            
            stats_summary["new_metadata"] += 1
            time.sleep(1)

def sync_round_stats():
    print("🚀 Phase 4: Syncing Round Stats...")
    # Fetch tasks from your view or manually check missing stats
    # For simplicity, we use the View if you have it, or just check recent fights
    # Assuming 'fight_scraping_status' view exists:
    try:
        tasks = supabase_db.table("fight_scraping_status").select("bout, event_name, fight_url").filter("fight_status", "in", '("❌ MISSING", "⚠️ PARTIAL")').execute()
        
        for task in tasks.data:
            res = requests.get(task['fight_url'])
            if res.status_code != 200: continue
            soup = BeautifulSoup(res.text, 'html.parser')
            tables = soup.find_all('table', class_='b-fight-details__table js-fight-table')
            if len(tables) < 2: continue
            
            cleaned_bout = clean_bout_name(task['bout'])
            main = parse_base_stats_table(tables[0], task['event_name'], cleaned_bout)
            zone = parse_zone_stats_table(tables[1], task['event_name'], cleaned_bout)
            
            z_map = {(z["fighter_name"], z["round"]): z for z in zone}
            merged = [{**m, **z_map.get((m["fighter_name"], m["round"]), {})} for m in main]
            
            supabase_db.table("round_fight_stats").insert(merged).execute()
            stats_summary["new_round_rows"] += len(merged)
    except Exception as e:
        print(f"Skipping Round Stats (View might be missing): {e}")



# --- ADD THIS FUNCTION WITH YOUR OTHER SCRAPERS ---
def sync_event_times():
    print("⏰ Phase 5: Syncing Event Times from ESPN (Future Focused)...")
    
    # 1. Get today's date
    today = datetime.now().date().isoformat()
    
    # 2. Fetch ONLY future/upcoming events from your DB
    upcoming_events = supabase_db.table("ufc_events")\
        .select("*")\
        .gte("event_date", today)\
        .order("event_date", desc=False)\
        .execute()
        
    if not upcoming_events.data:
        print("   No upcoming events found in DB to sync.")
        return

    base_url = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"

    for db_event in upcoming_events.data:
        # Convert DB date (YYYY-MM-DD) to ESPN format (YYYYMMDD)
        date_param = db_event['event_date'].replace("-", "")
        
        print(f"   🔍 Querying ESPN for {db_event['event_name']} (Date: {db_event['event_date']})...")
        
        try:
            # 3. Ask ESPN specifically for THIS date
            res = requests.get(f"{base_url}?dates={date_param}").json()
            events = res.get('events', [])
            
            match_found = False
            for espn_event in events:
                # Get the exact UTC start time
                espn_time_str = espn_event.get('date', '')
                if not espn_time_str: continue

                # Optional: Strict Name Check (Useful if multiple cards are on the same day)
                # But usually, querying by date is unique enough for UFC.
                
                print(f"      ✅ Found match! Updating start time to: {espn_time_str}")
                
                # 4. Update the Database
                supabase_db.table("ufc_events").update({
                    "start_time": espn_time_str
                }).eq("id", db_event['id']).execute()
                
                match_found = True
                break # Move to next DB event
            
            if not match_found:
                print(f"      ⚠️ No scheduled data found on ESPN yet for this date.")

        except Exception as e:
            print(f"      ❌ Error syncing time: {e}")

# --- 6. EXECUTION ---
if __name__ == "__main__":
    start_time = time.time()
    
    # 1. Upcoming First
    sync_upcoming_events()
    sync_upcoming_fights()

    # 2. Completed/Updates Second
    sync_events()
    sync_fights()
    sync_meta()
    sync_round_stats()
    sync_event_times()
    
    duration = round(time.time() - start_time, 2)
    print("\n" + "="*30)
    print(f"📊 SCRAPE SUMMARY ({duration}s)")
    print(f"📅  New Events:     {stats_summary['new_events']}")
    print(f"🥊  New Fights:     {stats_summary['new_fights']}")
    print(f"🔄  Updated Fights: {stats_summary['updated_fights']}")
    print(f"📝  Meta Added:     {stats_summary['new_metadata']}")
    print(f"🔢  Round Rows:     {stats_summary['new_round_rows']}")
    print("="*30)
    print("🏁 Master Sync Complete.")