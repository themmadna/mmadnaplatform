# 🥊 UFC Ratings & Combat DNA

> **Discover what kind of fight fan you really are.**
> An analytics platform that generates a personalized "Combat DNA" profile based on the UFC bouts you rate.

![Project Status](https://img.shields.io/badge/Status-Active-green)
![Tech Stack](https://img.shields.io/badge/Stack-React%20|%20Supabase%20|%20Tailwind-blue)

## 📖 About The Project

Most MMA stats focus on the fighter (e.g., "Jon Jones lands 4.3 strikes/min"). **UFC Ratings** flips the script to focus on the **Fan**.

By liking or disliking specific fights, this application builds a unique "Combat DNA" profile for the user. It aggregates hundreds of data points—from strike locations to control time to knockdown frequency—to reveal your specific taste in violence.

Do you prefer high-volume brawls? Technical grappling clinics? Or chaotic first-round finishes? This app tells you the answer with data.

## ✨ Key Features

### 🧬 The Combat DNA Engine
Your profile is built on 5 custom "Bout-Level" metrics, calculated via complex SQL aggregations:
* **Strike Pace:** Combined significant strike volume per minute (both fighters).
* **Violence Index:** A custom metric tracking "danger events" (Knockdowns + Submission Attempts) per minute.
* **Engagement Style:** Analysis of where the fight takes place (Stand-up vs. Ground Control %).
* **Finish Profile:** Your preference for "Flash KOs" vs. "Deep Water Wars" (Avg Duration + Finish Rate).
* **Grappling Intensity:** Takedown attempts per fight.

### 🎯 Dynamic Strike Heatmap
* **Interactive SVG:** A custom-built fighter visualization that updates in real-time.
* **Heat Map Logic:** Dynamically colors the Head, Body, and Legs (Red/Orange/Yellow) based on the strike distribution of your favorite fights.
* **Glow Effects:** CSS filters generate a "radioactive" glow intensity proportional to the percentage of strikes absorbed in that zone.

### 📊 Live Baselines
* **Supabase Views:** The app compares your personal stats against a live "UFC Average" calculated from thousands of fights in the database.
* **Contextual Ratings:** Every stat shows a "vs Avg" comparison (e.g., `+5.3 strikes/min vs avg`) so you know exactly where you stand.

## 🛠️ Tech Stack

* **Frontend:** React.js, Tailwind CSS, Lucide React (Icons).
* **Backend:** Supabase (PostgreSQL, Auth, Realtime Database).
* **Visualization:** Custom SVG manipulation, CSS transitions.
* **Deployment:** Vercel.

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
