import os
import time
import random
import logging
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

# --- 1. INITIALIZATION ---
load_dotenv(dotenv_path=Path(__file__).parent / '.env')
DEFAULT_START_YEAR = 2010
CURRENT_YEAR = datetime.now().year
STOP_THRESHOLD = 10
MAX_WORKERS  = 5     # concurrent fight-page fetches per event
BASE_SLEEP   = 0.75  # seconds between requests (was 1.5)
MAX_RETRIES  = 3
BACKOFF_BASE = 2     # exponential backoff: 2s, 4s, 8s on retries


url = os.environ.get("REACT_APP_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    raise ValueError(f"❌ Error: .env file not loaded correctly.\nLooking at: {Path(__file__).parent / '.env'}\nMake sure REACT_APP_SUPABASE_URL and SUPABASE_SERVICE_KEY are inside.")

supabase_db: Client = create_client(url, key)

logging.basicConfig(filename=str(Path(__file__).parent / 'scrape_errors.log'), level=logging.ERROR,
                    format='%(asctime)s - %(levelname)s - %(message)s')

_thread_local = threading.local()

def get_thread_db():
    """Return a thread-local Supabase client. Creates one on first call per thread."""
    if not hasattr(_thread_local, 'db'):
        _thread_local.db = create_client(
            os.environ["REACT_APP_SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_KEY"]
        )
    return _thread_local.db


# --- 2. HELPER FUNCTIONS ---

def clean_string(text):
    if not text:
        return text
    # 1. Standardize "vs." to "vs"
    # 2. Replace non-breaking space (\xa0) with regular space
    # 3. Remove leading/trailing whitespace
    return text.replace(' vs. ', ' vs ').replace('\xa0', ' ').strip()

def fetch_page(url, session=None):
    """Fetch a URL with retry + exponential backoff.
    Pass a requests.Session for thread-local HTTP keep-alive reuse.
    """
    getter = session.get if session else requests.get
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = getter(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
            response.raise_for_status()
            time.sleep(BASE_SLEEP)
            return response.text
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 429:
                wait = BACKOFF_BASE ** attempt + random.uniform(0, 1)
                print(f"  429 rate-limited. Waiting {wait:.1f}s before retry {attempt}...")
                time.sleep(wait)
            elif attempt == MAX_RETRIES:
                logging.error(f"HTTP error after {MAX_RETRIES} attempts for {url}: {e}")
                return None
            else:
                time.sleep(BACKOFF_BASE ** attempt)
        except Exception as e:
            if attempt == MAX_RETRIES:
                logging.error(f"Failed to fetch {url} after {MAX_RETRIES} attempts: {e}")
                return None
            time.sleep(BACKOFF_BASE ** attempt)
    return None

def extract_fight_data(html_content, url, bout_display=None):
    if not html_content: return None
    soup = BeautifulSoup(html_content, "html.parser")

    event_block = soup.find("td", class_="decision-top2")
    event_lines = [line.strip() for line in event_block.text.splitlines() if line.strip()] if event_block else []
    event = event_lines[0] if event_lines else 'N/A'
    date = event_lines[1] if len(event_lines) > 1 else 'N/A'

    referee_block = soup.find("td", class_="decision-bottom2")
    referee = referee_block.get_text(strip=True).replace('REFEREE:', '').strip() if referee_block else 'N/A'

    # Use display name from the event page link (properly cased) when available.
    # Fallback to URL slug only if display name wasn't passed in.
    if bout_display and ' vs ' in bout_display:
        f1_name, f2_name = [f.strip() for f in bout_display.split(' vs ', 1)]
    else:
        fight_name_raw = url.split('/')[-1].replace('-', ' ').strip()
        try:
            f1_name, f2_name = [f.strip() for f in fight_name_raw.split(' vs ')]
        except ValueError:
            f1_name = f2_name = 'Unknown'

    data = []
    judge_tables = soup.find_all("table", style="border-spacing: 1px; width: 100%")
    for table in judge_tables:
        try:
            judge = table.find("a").get_text(strip=True).replace("\xa0", " ").strip()
        except AttributeError: continue

        for round_row in table.find_all("tr", class_="decision"):
            cols = round_row.find_all("td", class_="list")
            if len(cols) < 3 or not cols[1].text.strip() or cols[1].text.strip() == "-": continue

            bout_name = f"{f1_name} vs {f2_name}"
            common_fields = {
                'event': event.strip(),
                'bout': bout_name,
                'date': date.strip(),
                'judge': judge,
                'round': int(cols[0].text.strip()),
                'referee': referee
            }
            # Row for Fighter 1
            data.append({**common_fields, 'fighter': f1_name, 'score': cols[1].text.strip()})
            # Row for Fighter 2
            data.append({**common_fields, 'fighter': f2_name, 'score': cols[2].text.strip()})

    return {'data': data} if data else None


# --- 3. SUPABASE LOADING FUNCTION ---

def fetch_fight_page_and_insert(args):
    """Worker function for ThreadPoolExecutor.
    args: (base_url, b_link, b_name)
    Returns True if new data was inserted, False otherwise.
    """
    base_url, b_link, b_name = args

    if not hasattr(_thread_local, 'http_session'):
        _thread_local.http_session = requests.Session()
        _thread_local.http_session.headers.update({'User-Agent': 'Mozilla/5.0'})

    fight_url = base_url + b_link.strip()
    html = fetch_page(fight_url, session=_thread_local.http_session)
    if not html:
        return False

    res = extract_fight_data(html, fight_url, b_name)
    if res and res.get('data'):
        insert_judge_data_supabase(res['data'], db=get_thread_db())
        return True
    return False

def insert_judge_data_supabase(raw_data, db=None):
    if db is None:
        db = supabase_db
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
            db.table("judge_scores").upsert(
                clean_rows,
                on_conflict='bout,date,judge,fighter,round'
            ).execute()
            print(f"✅ Processed {len(clean_rows)} scorecard rows.")
        except Exception as e:
            print(f"❌ Supabase Sync Error: {e}")
            logging.error(f"UPSERT failed: {e}")

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
            # Capture (href, display_text) — display text has proper fighter name casing
            bouts = [
                (a.get('href'), clean_string(a.get_text(strip=True)))
                for a in bout_soup.find_all('a')
                if 'decision/' in a.get('href', '') and a.get_text(strip=True)
            ]

            new_fights_processed = 0
            new_bouts = []
            for b_link, b_name in bouts:
                if b_name in existing_bouts:
                    print(f"  ⏭️ Skipping existing bout: {b_name}")
                else:
                    new_bouts.append((base_url, b_link, b_name))

            if new_bouts:
                with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                    futures = {
                        executor.submit(fetch_fight_page_and_insert, args): args
                        for args in new_bouts
                    }
                    for future in as_completed(futures):
                        try:
                            if future.result():
                                new_fights_processed += 1
                        except Exception as e:
                            logging.error(f"Worker exception for {futures[future][1]}: {e}")

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