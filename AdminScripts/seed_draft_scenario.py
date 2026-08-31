"""Load repeatable DraftBoard budget and roster-validation scenarios.

Set SUPABASE_URL and SUPABASE_SERVICE_KEY, then run:
  python seed_draft_scenario.py --list
  python seed_draft_scenario.py cash-crunch --apply
"""

import argparse
import os
import sys
from collections import defaultdict

from supabase import Client, create_client


STARTING_BUDGET = 200

# Each entry is a player position followed by that player's draft cost. The
# loader selects real undrafted players, so it remains valid after a sync.
SCENARIOS = {
    "cash-crunch": {
        "description": "11-player legal roster with $190 spent; one $10 pick remains to reach 12.",
        "picks": [
            ("QB", 40), ("RB", 30), ("RB", 25), ("WR", 20), ("WR", 15),
            ("WR", 15), ("TE", 10), ("DEF", 10), ("K", 10), ("QB", 10),
            ("RB", 5),
        ],
    },
    "missing-k": {
        "description": "11 players and $180 spent, but no kicker; a non-K pick at #12 must be rejected.",
        "picks": [
            ("QB", 35), ("RB", 28), ("RB", 22), ("WR", 20), ("WR", 17),
            ("WR", 15), ("TE", 12), ("DEF", 10), ("QB", 8), ("QB", 7),
            ("QB", 6),
        ],
    },
    "position-dead-end": {
        "description": "11 QBs and $165 spent; another QB makes it impossible to satisfy required positions by pick 12.",
        "picks": [("QB", 15)] * 11,
    },
    "max-roster": {
        "description": "A legal 14-player roster; every additional selection must be rejected at the roster limit.",
        "picks": [
            ("QB", 35), ("RB", 25), ("RB", 20), ("WR", 20), ("WR", 15),
            ("WR", 15), ("TE", 12), ("DEF", 8), ("K", 5), ("QB", 10),
            ("RB", 10), ("WR", 10), ("TE", 8), ("DEF", 7),
        ],
    },
}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", nargs="?", choices=SCENARIOS, help="Scenario to load")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    parser.add_argument("--apply", action="store_true", help="Apply changes; otherwise only show the planned seed")
    return parser.parse_args()


def get_client():
    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not service_key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY before loading a scenario.")
    return create_client(url, service_key)


def choose_players(client: Client, picks):
    response = client.table("players").select("id,name,position,nfl_team").execute()
    available_by_position = defaultdict(list)
    for player in response.data or []:
        available_by_position[(player.get("position") or "").upper()].append(player)

    selected_players = []
    for position, cost in picks:
        candidates = available_by_position[position]
        if not candidates:
            sys.exit(f"Not enough available {position} players to load this scenario.")
        selected_players.append((candidates.pop(0), cost))
    return selected_players


def get_active_team(client: Client):
    response = client.table("teams").select("id,manager_name,turn_order,completed").execute()
    teams = [team for team in response.data or [] if not team.get("completed")]
    teams.sort(key=lambda team: (team.get("turn_order") is None, team.get("turn_order") or 0, team["id"]))
    if not teams:
        sys.exit("Create at least one active team before loading a scenario.")
    return teams[0]


def print_plan(scenario_name, scenario, team, selected_players):
    total = sum(cost for _, cost in selected_players)
    print(f"Scenario: {scenario_name}")
    print(scenario["description"])
    print(f"Team: {team.get('manager_name') or 'Team ' + str(team['id'])}")
    print(f"Picks: {len(selected_players)}, spent: ${total}, remaining: ${STARTING_BUDGET - total}")
    for player, cost in selected_players:
        print(f"  ${cost:>3}  {player['position']:<3}  {player['name']} ({player.get('nfl_team') or 'FA'})")


def apply_scenario(client: Client, team, selected_players):
    client.table("draft_picks").delete().neq("id", 0).execute()
    client.table("players").update({"is_drafted": False}).neq("id", "").execute()

    picks = [
        {"player_id": player["id"], "team_id": team["id"], "cost": cost, "round_number": 1}
        for player, cost in selected_players
    ]
    client.table("draft_picks").insert(picks).execute()
    for player, _ in selected_players:
        client.table("players").update({"is_drafted": True}).eq("id", player["id"]).execute()

    client.table("draft_state").upsert({
        "id": 1,
        "current_turn_order": team.get("turn_order") or 1,
        "round_number": 1,
        "draft_started": True,
        "round_complete": False,
        "nominated_player_id": None,
        "last_winner_player_id": None,
        "last_winner_team_id": None,
        "last_winning_cost": None,
    }).execute()


def main():
    args = parse_args()
    if args.list:
        for name, scenario in SCENARIOS.items():
            print(f"{name}: {scenario['description']}")
        return
    if not args.scenario:
        sys.exit("Choose a scenario or pass --list.")

    client = get_client()
    scenario = SCENARIOS[args.scenario]
    team = get_active_team(client)
    selected_players = choose_players(client, scenario["picks"])
    print_plan(args.scenario, scenario, team, selected_players)
    if not args.apply:
        print("\nDry run only. Re-run with --apply to reset and load this scenario.")
        return

    apply_scenario(client, team, selected_players)
    print("\nScenario loaded. Refresh DraftBoard and use the Admin panel to test the next bid.")


if __name__ == "__main__":
    main()