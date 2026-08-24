import requests
from supabase import create_client, Client

# Replace with your Supabase Project URL and Service Role Key (found in Project Settings > API)
SUPABASE_URL = "https://ntaoxvlujawgackfeuhq.supabase.co"
SUPABASE_SERVICE_KEY = ""

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Positions relevant for fantasy football
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}

# Official 2026 NFL Bye Weeks
BYE_WEEKS = {
    "CAR": 5, "KC": 5,
    "CIN": 6, "DET": 6, "MIA": 6, "MIN": 6,
    "BUF": 7, "JAX": 7, "LAC": 7, "WAS": 7,
    "HOU": 8, "NO": 8, "NYG": 8, "SF": 8,
    "PIT": 9, "TEN": 9,
    "CHI": 10, "DEN": 10, "PHI": 10, "TB": 10,
    "ATL": 11, "CLE": 11, "GB": 11, "LAR": 11, "NE": 11, "SEA": 11,
    "BAL": 13, "IND": 13, "LV": 13, "NYJ": 13,
    "ARI": 14, "DAL": 14
}

def sync_nfl_players():
    print("Fetching live NFL player dataset from Sleeper API...")
    try:
        response = requests.get("https://api.sleeper.app/v1/players/nfl", timeout=30)
    except Exception as e:
        print(f"Error connecting to Sleeper API: {e}")
        return

    if response.status_code != 200:
        print(f"Error fetching Sleeper API: {response.status_code}")
        return

    all_players = response.json()
    print(f"Total raw players retrieved: {len(all_players)}")

    # Fetch currently drafted player IDs from Supabase to preserve draft state if refreshed mid-draft
    try:
        drafted_response = supabase.table("players").select("id").eq("is_drafted", True).execute()
        drafted_ids = {str(row["id"]) for row in drafted_response.data} if drafted_response.data else set()
    except Exception as e:
        print(f"Notice: Could not fetch existing drafted players (Table may be empty or brand new): {e}")
        drafted_ids = set()

    formatted_players = []

    for player_id, p in all_players.items():
        # Safely handle position logic
        pos = p.get("position")
        fantasy_positions = p.get("fantasy_positions") or []
        
        if not pos and "DEF" in fantasy_positions:
            pos = "DEF"

        is_active = p.get("active")
        if is_active is None:
            is_active = True

        if pos in FANTASY_POSITIONS and is_active:
            first_name = p.get("first_name") or ""
            last_name = p.get("last_name") or ""
            name = f"{first_name} {last_name}".strip()
            nfl_team = p.get("team") or "FA"

            if pos == "DEF":
                name = name or nfl_team or str(player_id)

            if not name:
                continue

            # Safely handle integers that might be null or float strings
            dc_order = p.get("depth_chart_order")
            depth_chart_order = int(dc_order) if dc_order is not None else None

            # Calculate Bye Week based on our hard-coded 2026 dictionary, rather than relying on Sleeper
            bye_week = BYE_WEEKS.get(nfl_team, None)

            # Build the comprehensive player object matching all 15 database columns
            formatted_players.append({
                "id": str(player_id),
                "name": name,
                "position": pos,
                "nfl_team": nfl_team,
                "injury_status": p.get("injury_status"),
                "is_drafted": str(player_id) in drafted_ids,
                "depth_chart_position": p.get("depth_chart_position"),
                "depth_chart_order": depth_chart_order,
                "status": p.get("status"),
                "injury_notes": p.get("injury_notes"),
                "injury_start_date": p.get("injury_start_date"),
                "espn_id": str(p.get("espn_id")) if p.get("espn_id") is not None else None,
                "yahoo_id": str(p.get("yahoo_id")) if p.get("yahoo_id") is not None else None,
                "rotowire_id": str(p.get("rotowire_id")) if p.get("rotowire_id") is not None else None,
                "bye_week": bye_week
            })

    print(f"Filtered down to {len(formatted_players)} fantasy-relevant players.")

    # Upsert in batches of 500
    batch_size = 500
    total_batches = (len(formatted_players) // batch_size) + (1 if len(formatted_players) % batch_size != 0 else 0)

    for i in range(0, len(formatted_players), batch_size):
        batch = formatted_players[i:i + batch_size]
        
        # Sample debug print on the first batch to verify fields locally before uploading
        if i == 0 and len(batch) > 0:
            print("\n--- SAMPLE PLAYER PAYLOAD (First Item) ---")
            print(batch[0])
            print("------------------------------------------\n")
            
        supabase.table("players").upsert(batch, on_conflict="id").execute()
        print(f"Uploaded batch {(i // batch_size) + 1} of {total_batches}...")

    print("\nSync complete! Supabase player list is up to date with 2026 bye weeks, full depth charts, and injury notes.")

if __name__ == "__main__":
    sync_nfl_players()