import os
import time
import logging
import argparse
from datetime import datetime
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
import pandas as pd
from supabase import create_client, Client

# --- 1. INITIALIZATION ---
load_dotenv()
DEFAULT_START_YEAR = 2010
CURRENT_YEAR = datetime.now().year 
STOP_THRESHOLD = 10 


url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_ANON_KEY")
supabase_db: Client = create_client(url, key)

logging.basicConfig(filename='scrape_errors.log', level=logging.ERROR, 
                    format='%(asctime)s - %(levelname)s - %(message)s')


# --- 2. HELPER FUNCTIONS ---

def clean_string(text):
    if not text:
        return text
    # 1. Standardize "vs." to "vs"
    # 2. Replace non-breaking space (\xa0) with regular space
    # 3. Remove leading/trailing whitespace
    return text.replace(' vs. ', ' vs ').replace('\xa0', ' ').strip()

def fetch_page(url):
    print(f"Fetching: {url}")
    try:
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        response.raise_for_status()
        time.sleep(1.5)
        return response.text
    except Exception as e:
        logging.error(f"Failed to fetch {url}: {e}")
        return None

def extract_fight_data(html_content, url):
    if not html_content: return None
    soup = BeautifulSoup(html_content, "html.parser")
    
    event_block = soup.find("td", class_="decision-top2")
    event_lines = [line.strip() for line in event_block.text.splitlines() if line.strip()] if event_block else []
    event = event_lines[0] if event_lines else 'N/A'
    date = event_lines[1] if len(event_lines) > 1 else 'N/A'
    
    referee_block = soup.find("td", class_="decision-bottom2")
    referee = referee_block.get_text(strip=True).replace('REFEREE:', '').strip() if referee_block else 'N/A'
    
    fight_name_raw = url.split('/')[-1].replace('-', ' ').strip()
    try:
        f1_url, f2_url = [f.strip() for f in fight_name_raw.split(' vs ')]
    except ValueError: 
        f1_url = f2_url = 'Unknown'
    
    data = []
    judge_tables = soup.find_all("table", style="border-spacing: 1px; width: 100%")
    for table in judge_tables:
        try:
            judge = table.find("a").get_text(strip=True).replace("\xa0", " ").strip()
        except AttributeError: continue
        
        for round_row in table.find_all("tr", class_="decision"):
            cols = round_row.find_all("td", class_="list")
            if len(cols) < 3 or not cols[1].text.strip() or cols[1].text.strip() == "-": continue
            
            bout_name = f"{f1_url} vs. {f2_url}"
            common_fields = {
                'event': event.strip(),
                'bout': bout_name,
                'date': date.strip(),
                'judge': judge,
                'round': cols[0].text.strip(),
                'referee': referee
            }
            # Row for Fighter 1
            data.append({**common_fields, 'fighter': f1_url, 'score': cols[1].text.strip()})
            # Row for Fighter 2
            data.append({**common_fields, 'fighter': f2_url, 'score': cols[2].text.strip()})
            
    return {'data': data} if data else None


# --- 3. SUPABASE LOADING FUNCTION ---

def insert_judge_data_supabase(raw_data):
    clean_rows = []
    for entry in raw_data:
        try:
            # 1. Standardize score to integer
            score_val = int(entry['score'])
            
            # 2. Standardize Date
            date_str = entry['date'].replace('.', '').strip()
            try:
                parsed_date = datetime.strptime(date_str, "%B %d, %Y").date().isoformat()
            except ValueError:
                parsed_date = datetime.strptime(date_str, "%b %d, %Y").date().isoformat()
            
            # 3. APPLY THE CLEANING STATION HERE
            # We use the clean_string helper you already defined in Section 2
            clean_rows.append({
                "event_name": clean_string(entry['event']), # Changed key to event_name and added cleaning
                "bout": clean_string(entry['bout']),
                "date": parsed_date,
                "fighter": clean_string(entry['fighter']),
                "judge": clean_string(entry['judge']),
                "round": entry['round'],
                "score": score_val,
                "referee": entry['referee'].strip()
            })
        except Exception as e:
            print(f"⚠️ Formatting error for row: {e}")

    if clean_rows:
        try:
            # Use UPSERT to match existing rows and prevent duplicates
            supabase_db.table("judge_scores").upsert(
                clean_rows, 
                on_conflict='bout,date,judge,fighter,round' # Add event_name here if it's part of your unique key
            ).execute()
            print(f"✅ Supabase Sync: Processed {len(clean_rows)} scorecard rows.")
        except Exception as e:
            print(f"❌ Supabase Sync Error: {e}")

# --- 4. MAIN ORCHESTRATOR (OPTIMIZED) ---

def scrapeDataFunction(start_year, end_year):
    url = "http://mmadecisions.com/decisions-by-event/"
    base_url = "http://mmadecisions.com/"
    
    main_html = fetch_page(url)
    if not main_html: return
    soup = BeautifulSoup(main_html, 'html.parser')
    year_cells = [y.text for y in soup.find('table', width="100%").find_all('td') if y.text.isdigit()]
    years_to_process = sorted([y for y in year_cells if start_year <= int(y) <= end_year], reverse=True)

    events_skipped_in_a_row = 0

    for y in years_to_process:
        print(f"\n--- Processing Year: {y} ---")
        year_html = fetch_page(f"{url}{y}/")
        if not year_html: continue
        year_soup = BeautifulSoup(year_html, 'html.parser')
        
        # Get all links and their text (Event Names)
        links = year_soup.find_all('a')
        ufc_events = [(a.get('href'), a.text.strip()) for a in links if 'UFC' in a.text]
        
        for e_link, e_name in ufc_events:
            print(f"\nChecking Event: {e_name}")
            
            # QUICK CHECK: Get all bouts already in DB for this event
            existing_res = supabase_db.table("judge_scores").select("bout").eq("event_name", e_name).execute()
            existing_bouts = set(row['bout'] for row in existing_res.data)
            
            event_html = fetch_page(base_url + e_link)
            if not event_html: continue
            bout_soup = BeautifulSoup(event_html, 'html.parser')
            bouts = [a.get('href') for a in bout_soup.find_all('a') if 'decision/' in a.get('href', '')]
            
            new_fights_processed = 0
            for b_link in bouts:
                # 1. Pre-calculate the bout name from the URL slug
                # Example slug: "Merab-Dvalishvili-vs-Cory-Sandhagen" -> "Merab Dvalishvili vs Cory Sandhagen"
                fight_slug = b_link.split('/')[-1].replace('-', ' ').strip()
                clean_bout_name = clean_string(fight_slug)
                
                # 2. SKIP if we already have this bout for this event
                if clean_bout_name in existing_bouts:
                    print(f"  ⏭️ Skipping existing bout: {clean_bout_name}")
                    continue
                
                # 3. Only fetch the page if it's a NEW fight
                res = extract_fight_data(fetch_page(base_url + b_link.strip()), base_url + b_link)
                
                if res and res.get('data'):
                    insert_judge_data_supabase(res['data'])
                    new_fights_processed += 1

            # Update skip logic
            if new_fights_processed == 0 and len(bouts) > 0:
                events_skipped_in_a_row += 1
                print(f" > No new bouts needed for this event. (Consecutive: {events_skipped_in_a_row})")
            elif new_fights_processed > 0:
                events_skipped_in_a_row = 0 

            # If we hit the threshold, it means we are deep into "already scraped" territory
            if events_skipped_in_a_row >= STOP_THRESHOLD:
                print(f"\nReached {STOP_THRESHOLD} consecutive existing events. Stopping scraper.")
                return

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=CURRENT_YEAR)
    args = parser.parse_args()

    # You can change this to skip the input prompt for automation
    confirm = input(f"Start incremental judge scrape from {args.start} to {args.end}? (yes/no): ")
    if confirm.lower() == 'yes':
        scrapeDataFunction(args.start, args.end)