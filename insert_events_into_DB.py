import os
from dotenv import load_dotenv
from bs4 import BeautifulSoup
import requests
from supabase import create_client, Client
import supabase
from supabase_auth import datetime 


"""
Request: scrape_all_completed_events pulls raw HTML from the web.

Transform: The script cleans that HTML into a structured Python list.

Validate: insert_unique_events_supabase checks Supabase to see if the data is new.

Load: New events are committed to your ufc_events table.
"""


# Load variables and create the CLIENT object
load_dotenv()
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_ANON_KEY")

# We will call our client 'supabase_db' to avoid confusion with the library name
supabase_db: Client = create_client(url, key)


import requests
from bs4 import BeautifulSoup

def scrape_all_completed_events():

    # This function grabs all completed events from UFCStats.com and stores them in a list of dictionaries.

    url = "http://ufcstats.com/statistics/events/completed?page=all"
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')

    events_table = soup.find('table', class_='b-statistics__table-events')
    rows = events_table.find_all('tr', class_='b-statistics__table-row')

    events = []

    for row in rows:
        if not row.find('a'):
            continue  # Skip empty row
        if row.find('img'):
            continue  # Skip upcoming event row

        first_td = row.find_all('td')[0]
        second_td = row.find_all('td')[1]

        event_name = first_td.find('a').text.strip()
        event_url = first_td.find('a')['href']
        event_date = first_td.find('span', class_='b-statistics__date').text.strip()
        event_location = second_td.text.strip()

        events.append({
            'event_name': event_name,
            'event_url': event_url,
            'event_date': event_date,
            'event_location': event_location
        })

    return events

def insert_unique_events_supabase(events):

    # This function inserts each event only if it's not already in the database (based on event_url).

    for event in events:
        try:
            # Convert event_date to YYYY-MM-DD string
            parsed_date = datetime.strptime(event['event_date'], "%B %d, %Y").date().isoformat()

            # Check for duplicates by event URL
            existing = supabase_db.table("ufc_events").select("id").eq("event_url", event['event_url']).execute()
            if existing.data:
                print(f"⏭️ Skipped (already exists): {event['event_name']}")
                continue

            # Insert if not found
            data = {
                "event_name": event['event_name'],
                "event_url": event['event_url'],
                "event_date": parsed_date,
                "event_location": event['event_location']
            }

            supabase_db.table("ufc_events").insert(data).execute()
            print(f"✅ Inserted: {event['event_name']}")

        except Exception as e:
            print(f"❌ Failed to insert {event['event_name']}: {e}")


# Run the scraper
all_events = scrape_all_completed_events()
print(f"Total events scraped: {len(all_events)}")

insert_unique_events_supabase(all_events)